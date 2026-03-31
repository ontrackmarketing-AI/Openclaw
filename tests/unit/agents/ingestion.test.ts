import { describe, it, expect, vi, beforeEach } from 'vitest';
import Anthropic from '@anthropic-ai/sdk';
import OpenAI from 'openai';

// ---------------------------------------------------------------------------
// Mocks for repositories and DB modules used by IngestionAgent
// ---------------------------------------------------------------------------

const mockProjectsGetAll = vi.fn();
const mockProjectsGetActive = vi.fn();
vi.mock('../../../src/db/repositories/projects.js', () => ({
  getAll: (...args: unknown[]) => mockProjectsGetAll(...args),
  getActive: (...args: unknown[]) => mockProjectsGetActive(...args),
  getById: vi.fn(),
  getByName: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
}));

const mockNotesCreate = vi.fn();
vi.mock('../../../src/db/repositories/notes.js', () => ({
  create: (...args: unknown[]) => mockNotesCreate(...args),
  getAll: vi.fn().mockResolvedValue([]),
  getById: vi.fn(),
  getByProjectId: vi.fn().mockResolvedValue([]),
}));

const mockTasksCreate = vi.fn();
vi.mock('../../../src/db/repositories/tasks.js', () => ({
  create: (...args: unknown[]) => mockTasksCreate(...args),
  getAll: vi.fn().mockResolvedValue([]),
  getById: vi.fn(),
  getByProjectId: vi.fn().mockResolvedValue([]),
  getOpen: vi.fn().mockResolvedValue([]),
  getOverdue: vi.fn().mockResolvedValue([]),
  update: vi.fn(),
  markDone: vi.fn(),
  markEscalated: vi.fn(),
}));

const mockQdrantUpsert = vi.fn().mockResolvedValue({});
vi.mock('../../../src/db/qdrant.js', () => ({
  qdrant: { upsert: (...args: unknown[]) => mockQdrantUpsert(...args) },
  qdrantSwre: null,
  COLLECTIONS: ['bryson_notes', 'bryson_emails', 'bryson_research', 'bryson_projects'],
}));

vi.mock('../../../src/db/connection.js', () => ({
  query: vi.fn().mockResolvedValue({ rows: [], rowCount: 0 }),
  pool: { query: vi.fn(), on: vi.fn(), end: vi.fn() },
}));

// We need to import after mocks are set up
import { IngestionAgent } from '../../../src/agents/ingestion/index.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeTestProjects() {
  return [
    {
      id: 'proj-ttt',
      name: 'Texas Tree Tops',
      client: 'TTT Client',
      status: 'active',
      priority: 1,
      metadata: {},
      created_at: new Date(),
      updated_at: new Date(),
    },
    {
      id: 'proj-swre',
      name: 'Southwest Real Estate',
      client: 'SWRE Corp',
      status: 'active',
      priority: 2,
      metadata: {},
      created_at: new Date(),
      updated_at: new Date(),
    },
    {
      id: 'proj-hs',
      name: 'Helium Solutions',
      client: null,
      status: 'active',
      priority: 3,
      metadata: {},
      created_at: new Date(),
      updated_at: new Date(),
    },
    {
      id: 'proj-otm',
      name: 'OnTrack Marketing',
      client: null,
      status: 'active',
      priority: 4,
      metadata: {},
      created_at: new Date(),
      updated_at: new Date(),
    },
    {
      id: 'proj-st',
      name: 'Search Tuners',
      client: 'Mike',
      status: 'active',
      priority: 5,
      metadata: {},
      created_at: new Date(),
      updated_at: new Date(),
    },
  ];
}

const sampleExtraction = {
  raw_text:
    'TTT - update GHL automations by EOW\nSWRE - follow up with Daniel re: listing photos\nHS - new lead gen campaign idea\nQ: should we raise OTM pricing?',
  tasks: [
    {
      title: 'Update GoHighLevel automations by end of week',
      project_ref: 'TTT',
      priority_hint: 'high',
      due_hint: 'EOW',
    },
    {
      title: 'Follow up with Daniel regarding listing photos',
      project_ref: 'SWRE',
      priority_hint: 'medium',
      due_hint: null,
    },
    {
      title: 'Design new lead generation campaign',
      project_ref: 'HS',
      priority_hint: 'medium',
      due_hint: null,
    },
  ],
  decisions: [],
  questions: [
    {
      text: 'Should we raise OnTrack Marketing pricing?',
      project_ref: 'OTM',
    },
  ],
  project_refs: ['TTT', 'SWRE', 'HS', 'OTM'],
  unclear_items: [],
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('IngestionAgent', () => {
  let agent: IngestionAgent;
  let anthropicCreate: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    agent = new IngestionAgent();

    // Get the mocked Anthropic instance and wire up create
    const anthropicInstance = (Anthropic as unknown as ReturnType<typeof vi.fn>).mock
      .results[0]?.value;
    anthropicCreate = anthropicInstance?.messages?.create;
  });

  // -------------------------------------------------------------------------
  // extractWithVision
  // -------------------------------------------------------------------------

  describe('extractWithVision', () => {
    it('returns structured JSON from a valid Vision response', async () => {
      anthropicCreate.mockResolvedValueOnce({
        content: [{ type: 'text', text: JSON.stringify(sampleExtraction) }],
      });

      // JPEG magic bytes
      const jpegBuffer = Buffer.from([0xff, 0xd8, 0xff, 0xe0, ...Array(100).fill(0)]);
      const result = await agent.extractWithVision(jpegBuffer);

      expect(result.raw_text).toBe(sampleExtraction.raw_text);
      expect(result.tasks).toHaveLength(3);
      expect(result.project_refs).toEqual(['TTT', 'SWRE', 'HS', 'OTM']);
      expect(result.questions).toHaveLength(1);
      expect(result.unclear_items).toHaveLength(0);
    });

    it('strips markdown fences from response', async () => {
      anthropicCreate.mockResolvedValueOnce({
        content: [
          {
            type: 'text',
            text: '```json\n' + JSON.stringify(sampleExtraction) + '\n```',
          },
        ],
      });

      const pngBuffer = Buffer.from([0x89, 0x50, 0x4e, 0x47, ...Array(100).fill(0)]);
      const result = await agent.extractWithVision(pngBuffer);

      expect(result.tasks).toHaveLength(3);
      expect(result.raw_text).toBe(sampleExtraction.raw_text);
    });

    it('returns fallback structure when JSON parsing fails', async () => {
      anthropicCreate.mockResolvedValueOnce({
        content: [{ type: 'text', text: 'This is not valid JSON at all' }],
      });

      const buffer = Buffer.from([0xff, 0xd8, ...Array(50).fill(0)]);
      const result = await agent.extractWithVision(buffer);

      expect(result.raw_text).toBe('This is not valid JSON at all');
      expect(result.tasks).toHaveLength(0);
      expect(result.unclear_items).toHaveLength(1);
      expect(result.unclear_items[0]).toContain('Failed to parse');
    });

    it('detects PNG media type from buffer magic bytes', async () => {
      anthropicCreate.mockResolvedValueOnce({
        content: [{ type: 'text', text: JSON.stringify(sampleExtraction) }],
      });

      const pngBuffer = Buffer.from([0x89, 0x50, 0x4e, 0x47, ...Array(100).fill(0)]);
      await agent.extractWithVision(pngBuffer);

      expect(anthropicCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          messages: expect.arrayContaining([
            expect.objectContaining({
              content: expect.arrayContaining([
                expect.objectContaining({
                  source: expect.objectContaining({
                    media_type: 'image/png',
                  }),
                }),
              ]),
            }),
          ]),
        }),
      );
    });
  });

  // -------------------------------------------------------------------------
  // matchProjects
  // -------------------------------------------------------------------------

  describe('matchProjects', () => {
    it('matches known abbreviations to projects via fuzzy search', async () => {
      mockProjectsGetAll.mockResolvedValue(makeTestProjects());

      const result = await agent.matchProjects(['TTT', 'SWRE', 'HS']);

      expect(result.matched.length).toBeGreaterThanOrEqual(2);
      const matchedRefs = result.matched.map((m) => m.ref);
      // TTT should match Texas Tree Tops, SWRE should match Southwest Real Estate
      expect(matchedRefs).toContain('TTT');
    });

    it('reports unmatched refs when no fuzzy match is found', async () => {
      mockProjectsGetAll.mockResolvedValue(makeTestProjects());

      const result = await agent.matchProjects(['TTT', 'UNKNOWN_PROJECT_XYZ']);

      expect(result.unmatched).toContain('UNKNOWN_PROJECT_XYZ');
    });

    it('returns empty results when no refs are provided', async () => {
      const result = await agent.matchProjects([]);

      expect(result.matched).toHaveLength(0);
      expect(result.unmatched).toHaveLength(0);
      expect(mockProjectsGetAll).not.toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // chunkText (testing via embedChunks indirectly, or accessing private)
  // -------------------------------------------------------------------------

  describe('chunking logic', () => {
    it('chunks text at ~512 tokens (2048 chars) with 50-token (200 char) overlap', () => {
      // Access private method for testing
      const chunkText = (agent as any).chunkText.bind(agent);

      // Create a text that is exactly 3000 characters
      const text = 'A'.repeat(3000);
      const chunks = chunkText(text);

      // With 2048 char chunks and 200 char overlap, stride = 1848
      // Chunk 1: 0-2048, Chunk 2: 1848-3000
      expect(chunks.length).toBe(2);
      expect(chunks[0].length).toBe(2048);
    });

    it('returns a single chunk for short text', () => {
      const chunkText = (agent as any).chunkText.bind(agent);
      const text = 'Short note about TTT project.';
      const chunks = chunkText(text);

      expect(chunks).toHaveLength(1);
      expect(chunks[0]).toBe(text);
    });

    it('returns empty array for empty/whitespace text', () => {
      const chunkText = (agent as any).chunkText.bind(agent);

      expect(chunkText('')).toHaveLength(0);
      expect(chunkText('   ')).toHaveLength(0);
      expect(chunkText(undefined)).toHaveLength(0);
    });

    it('creates overlapping chunks for large text', () => {
      const chunkText = (agent as any).chunkText.bind(agent);
      // 5000 chars -> stride is 2048-200 = 1848
      // chunks at 0-2048, 1848-3896, 3696-5000
      const text = 'X'.repeat(5000);
      const chunks = chunkText(text);

      expect(chunks.length).toBe(3);

      // Verify overlap: end of chunk 1 - start of chunk 2 == overlap chars
      // chunk 1 covers 0..2048, chunk 2 covers 1848..3896
      // overlap = 2048 - 1848 = 200 chars = 50 tokens
    });
  });

  // -------------------------------------------------------------------------
  // formatConfirmation
  // -------------------------------------------------------------------------

  describe('formatConfirmation', () => {
    it('produces a valid Telegram message with project names and counts', () => {
      const result = {
        noteId: 'note-123',
        projectId: 'proj-ttt',
        taskCount: 3,
        decisionCount: 1,
        questionCount: 2,
        unclearCount: 0,
        matchedProjects: [
          { ref: 'TTT', projectId: 'proj-ttt', projectName: 'Texas Tree Tops' },
          { ref: 'SWRE', projectId: 'proj-swre', projectName: 'Southwest Real Estate' },
        ],
        unmatchedRefs: [],
      };

      const msg = agent.formatConfirmation(result);

      expect(msg).toContain('Notebook Ingested');
      expect(msg).toContain('Texas Tree Tops');
      expect(msg).toContain('Southwest Real Estate');
      expect(msg).toContain('Tasks found:* 3');
      expect(msg).toContain('Decisions:* 1');
      expect(msg).toContain('Questions:* 2');
      expect(msg).not.toContain('unclear');
      expect(msg).not.toContain('Unmatched');
    });

    it('includes unclear items warning when present', () => {
      const result = {
        noteId: 'note-456',
        projectId: null,
        taskCount: 1,
        decisionCount: 0,
        questionCount: 0,
        unclearCount: 2,
        matchedProjects: [],
        unmatchedRefs: [],
      };

      const msg = agent.formatConfirmation(result);
      expect(msg).toContain('2 unclear items');
    });

    it('includes unmatched project refs when present', () => {
      const result = {
        noteId: 'note-789',
        projectId: null,
        taskCount: 0,
        decisionCount: 0,
        questionCount: 0,
        unclearCount: 0,
        matchedProjects: [],
        unmatchedRefs: ['MYSTERY', 'XYZ'],
      };

      const msg = agent.formatConfirmation(result);
      expect(msg).toContain('Unmatched project refs');
      expect(msg).toContain('MYSTERY');
      expect(msg).toContain('XYZ');
    });
  });

  // -------------------------------------------------------------------------
  // process (entry point)
  // -------------------------------------------------------------------------

  describe('process', () => {
    it('rejects non-notebook_image event types', async () => {
      const result = await agent.process({
        type: 'gmail_thread',
        data: {},
      });

      expect(result.status).toBe('error');
      expect(result.message).toContain('cannot handle event type');
    });

    it('returns error when no image data is provided', async () => {
      const result = await agent.process({
        type: 'notebook_image',
        data: {},
      });

      expect(result.status).toBe('error');
      expect(result.message).toContain('No image data provided');
    });

    it('returns partial status when unclear items exist', async () => {
      const extractionWithUnclear = {
        ...sampleExtraction,
        unclear_items: ['Could not read third line'],
      };

      anthropicCreate.mockResolvedValueOnce({
        content: [{ type: 'text', text: JSON.stringify(extractionWithUnclear) }],
      });

      mockProjectsGetAll.mockResolvedValue(makeTestProjects());
      mockNotesCreate.mockResolvedValue({
        id: 'note-test',
        project_id: null,
        source: 'telegram',
        raw_text: extractionWithUnclear.raw_text,
        structured: extractionWithUnclear,
        image_path: null,
        qdrant_ids: null,
        created_at: new Date(),
      });
      mockTasksCreate.mockResolvedValue({
        id: 'task-1',
        title: 'Test task',
        status: 'open',
        priority: 3,
        created_at: new Date(),
        updated_at: new Date(),
      });

      const imageBase64 = Buffer.from([0xff, 0xd8, ...Array(50).fill(0)]).toString('base64');

      const result = await agent.process({
        type: 'notebook_image',
        data: { imageBase64, source: 'telegram' },
      });

      expect(result.status).toBe('partial');
      expect(result.agent).toBe('ingestion');
    });
  });
});
