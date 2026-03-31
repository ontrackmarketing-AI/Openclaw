import { describe, it, expect, vi, beforeEach } from 'vitest';
import Anthropic from '@anthropic-ai/sdk';
import OpenAI from 'openai';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockProjectsGetAll = vi.fn();
vi.mock('../../src/db/repositories/projects.js', () => ({
  getAll: (...args: unknown[]) => mockProjectsGetAll(...args),
  getActive: vi.fn().mockResolvedValue([]),
  getById: vi.fn(),
  getByName: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
}));

const mockNotesCreate = vi.fn();
vi.mock('../../src/db/repositories/notes.js', () => ({
  create: (...args: unknown[]) => mockNotesCreate(...args),
  getAll: vi.fn().mockResolvedValue([]),
  getById: vi.fn(),
  getByProjectId: vi.fn().mockResolvedValue([]),
}));

const mockTasksCreate = vi.fn();
vi.mock('../../src/db/repositories/tasks.js', () => ({
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
vi.mock('../../src/db/qdrant.js', () => ({
  qdrant: { upsert: (...args: unknown[]) => mockQdrantUpsert(...args) },
  qdrantSwre: null,
  COLLECTIONS: ['bryson_notes'],
}));

const mockDbQuery = vi.fn().mockResolvedValue({ rows: [], rowCount: 0 });
vi.mock('../../src/db/connection.js', () => ({
  query: (...args: unknown[]) => mockDbQuery(...args),
  pool: { query: vi.fn(), on: vi.fn(), end: vi.fn() },
}));

vi.mock('../../src/db/redis.js', () => ({
  redis: {
    get: vi.fn().mockResolvedValue(null),
    set: vi.fn().mockResolvedValue('OK'),
    on: vi.fn(),
  },
}));

import { IngestionAgent } from '../../src/agents/ingestion/index.js';

// ---------------------------------------------------------------------------
// Test data
// ---------------------------------------------------------------------------

const sampleExtraction = {
  raw_text:
    'TTT - update GHL automations by EOW\nSWRE - follow up with Daniel re: listing photos\nNew campaign idea for HS',
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
      title: 'Design new lead generation campaign for Helium Solutions',
      project_ref: 'HS',
      priority_hint: 'low',
      due_hint: null,
    },
  ],
  decisions: [
    { text: 'Focus on GHL automations this week', project_ref: 'TTT' },
  ],
  questions: [
    { text: 'Should we raise OnTrack Marketing pricing?', project_ref: 'OTM' },
  ],
  project_refs: ['TTT', 'SWRE', 'HS', 'OTM'],
  unclear_items: [],
};

const testProjects = [
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
];

// ---------------------------------------------------------------------------
// Integration test
// ---------------------------------------------------------------------------

describe('Full Ingestion Pipeline', () => {
  let agent: IngestionAgent;
  let anthropicCreate: ReturnType<typeof vi.fn>;
  let openaiEmbeddingsCreate: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    agent = new IngestionAgent();

    // Wire up mocked Anthropic Vision API
    const anthropicInstance = (Anthropic as unknown as ReturnType<typeof vi.fn>).mock
      .results.at(-1)?.value;
    anthropicCreate = anthropicInstance?.messages?.create;

    // Wire up mocked OpenAI embeddings API
    const openaiInstance = (OpenAI as unknown as ReturnType<typeof vi.fn>).mock.results.at(
      -1,
    )?.value;
    openaiEmbeddingsCreate = openaiInstance?.embeddings?.create;
  });

  it('processes an image through the entire pipeline: Vision -> extraction -> matching -> DB -> Qdrant -> confirmation', async () => {
    // Step 1: Vision API returns structured extraction
    anthropicCreate.mockResolvedValueOnce({
      content: [{ type: 'text', text: JSON.stringify(sampleExtraction) }],
    });

    // Step 2: Project matching — return test projects
    mockProjectsGetAll.mockResolvedValue(testProjects);

    // Step 3: Store note in PostgreSQL
    const storedNote = {
      id: 'note-integration-001',
      project_id: 'proj-ttt',
      source: 'telegram',
      raw_text: sampleExtraction.raw_text,
      structured: sampleExtraction,
      image_path: null,
      qdrant_ids: null,
      created_at: new Date(),
    };
    mockNotesCreate.mockResolvedValue(storedNote);

    // Step 4: Create tasks
    let taskCounter = 0;
    mockTasksCreate.mockImplementation((input: any) => {
      taskCounter++;
      return Promise.resolve({
        id: `task-int-${taskCounter}`,
        ...input,
        status: 'open',
        description: null,
        agent_handled: false,
        escalated_to_bryson: false,
        escalation_reason: null,
        created_at: new Date(),
        updated_at: new Date(),
      });
    });

    // Step 5: OpenAI embeddings
    openaiEmbeddingsCreate.mockResolvedValue({
      data: [{ embedding: new Array(1536).fill(0.01), index: 0 }],
    });

    // Create a JPEG buffer (magic bytes)
    const imageBuffer = Buffer.from([
      0xff, 0xd8, 0xff, 0xe0, ...Array(200).fill(0x42),
    ]);

    // ------- Execute the full pipeline -------
    const result = await agent.processImage(imageBuffer, 'telegram');

    // ------- Assertions -------

    // Vision API was called
    expect(anthropicCreate).toHaveBeenCalledTimes(1);
    expect(anthropicCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        messages: expect.arrayContaining([
          expect.objectContaining({
            content: expect.arrayContaining([
              expect.objectContaining({
                type: 'image',
                source: expect.objectContaining({
                  type: 'base64',
                  media_type: 'image/jpeg',
                }),
              }),
            ]),
          }),
        ]),
      }),
    );

    // Project matching found matches
    expect(result.matchedProjects.length).toBeGreaterThanOrEqual(2);
    const matchedNames = result.matchedProjects.map((m) => m.projectName);
    expect(matchedNames).toContain('Texas Tree Tops');

    // Note was stored in PostgreSQL
    expect(mockNotesCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        source: 'telegram',
        raw_text: sampleExtraction.raw_text,
      }),
    );

    // Tasks were created (3 tasks from extraction)
    expect(mockTasksCreate).toHaveBeenCalledTimes(3);
    expect(mockTasksCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'Update GoHighLevel automations by end of week',
        priority: 1, // high -> 1
        source: 'notebook',
        source_ref: 'note-integration-001',
      }),
    );
    expect(mockTasksCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'Design new lead generation campaign for Helium Solutions',
        priority: 5, // low -> 5
      }),
    );

    // Embeddings were created
    expect(openaiEmbeddingsCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        model: 'text-embedding-3-small',
        input: expect.any(Array),
      }),
    );

    // Qdrant received the embedded chunks
    expect(mockQdrantUpsert).toHaveBeenCalledWith(
      'bryson_notes',
      expect.objectContaining({
        points: expect.arrayContaining([
          expect.objectContaining({
            vector: expect.any(Array),
            payload: expect.objectContaining({
              note_id: 'note-integration-001',
              project_id: expect.any(String),
            }),
          }),
        ]),
      }),
    );

    // DB was updated with qdrant_ids
    expect(mockDbQuery).toHaveBeenCalledWith(
      'UPDATE notes SET qdrant_ids = $1 WHERE id = $2',
      [expect.any(Array), 'note-integration-001'],
    );

    // Result structure is correct
    expect(result.noteId).toBe('note-integration-001');
    expect(result.taskCount).toBe(3);
    expect(result.decisionCount).toBe(1);
    expect(result.questionCount).toBe(1);
    expect(result.unclearCount).toBe(0);

    // Confirmation message is well-formed
    const confirmation = agent.formatConfirmation(result);
    expect(confirmation).toContain('Notebook Ingested');
    expect(confirmation).toContain('Tasks found:* 3');
    expect(confirmation).toContain('Decisions:* 1');
    expect(confirmation).toContain('Questions:* 1');
  });

  it('handles Vision API failure gracefully and preserves raw text', async () => {
    // Vision returns unparseable output
    anthropicCreate.mockResolvedValueOnce({
      content: [
        {
          type: 'text',
          text: 'I cannot read this image clearly, the handwriting is too faint.',
        },
      ],
    });

    mockProjectsGetAll.mockResolvedValue(testProjects);
    mockNotesCreate.mockResolvedValue({
      id: 'note-fail-001',
      project_id: null,
      source: 'telegram',
      raw_text: 'I cannot read this image clearly, the handwriting is too faint.',
      structured: null,
      image_path: null,
      qdrant_ids: null,
      created_at: new Date(),
    });

    openaiEmbeddingsCreate.mockResolvedValue({
      data: [{ embedding: new Array(1536).fill(0), index: 0 }],
    });

    const imageBuffer = Buffer.from([0xff, 0xd8, ...Array(100).fill(0)]);
    const result = await agent.processImage(imageBuffer, 'telegram');

    // Should still work, just with empty extraction
    expect(result.taskCount).toBe(0);
    expect(result.unclearCount).toBe(1);
    expect(result.noteId).toBe('note-fail-001');

    // Raw text should be preserved even on parse failure
    expect(mockNotesCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        raw_text: expect.stringContaining('cannot read this image'),
      }),
    );
  });

  it('handles partial project matching with unmatched refs', async () => {
    const extractionWithUnknown = {
      ...sampleExtraction,
      project_refs: ['TTT', 'UNKNOWN_CLIENT_XYZ'],
      tasks: [
        {
          title: 'Task for TTT',
          project_ref: 'TTT',
          priority_hint: 'high',
          due_hint: null,
        },
        {
          title: 'Task for unknown project',
          project_ref: 'UNKNOWN_CLIENT_XYZ',
          priority_hint: 'medium',
          due_hint: null,
        },
      ],
    };

    anthropicCreate.mockResolvedValueOnce({
      content: [{ type: 'text', text: JSON.stringify(extractionWithUnknown) }],
    });

    mockProjectsGetAll.mockResolvedValue(testProjects);
    mockNotesCreate.mockResolvedValue({
      id: 'note-partial-001',
      project_id: 'proj-ttt',
      source: 'telegram',
      raw_text: extractionWithUnknown.raw_text,
      structured: extractionWithUnknown,
      created_at: new Date(),
    });

    openaiEmbeddingsCreate.mockResolvedValue({
      data: [{ embedding: new Array(1536).fill(0), index: 0 }],
    });

    const imageBuffer = Buffer.from([0xff, 0xd8, ...Array(100).fill(0)]);
    const result = await agent.processImage(imageBuffer, 'telegram');

    // TTT should match, UNKNOWN should not
    expect(result.matchedProjects.some((m) => m.ref === 'TTT')).toBe(true);
    expect(result.unmatchedRefs).toContain('UNKNOWN_CLIENT_XYZ');

    // The process entry point should return partial status
    const agentResult = await agent.process({
      type: 'notebook_image',
      data: {
        imageBase64: imageBuffer.toString('base64'),
        source: 'telegram',
      },
    });

    // Reset mocks for the second call through process()
    anthropicCreate.mockResolvedValueOnce({
      content: [{ type: 'text', text: JSON.stringify(extractionWithUnknown) }],
    });
    mockProjectsGetAll.mockResolvedValue(testProjects);
    mockNotesCreate.mockResolvedValue({
      id: 'note-partial-002',
      project_id: 'proj-ttt',
      source: 'telegram',
      raw_text: extractionWithUnknown.raw_text,
      structured: extractionWithUnknown,
      created_at: new Date(),
    });
  });

  it('processes a PNG image with correct media type detection', async () => {
    anthropicCreate.mockResolvedValueOnce({
      content: [{ type: 'text', text: JSON.stringify(sampleExtraction) }],
    });

    mockProjectsGetAll.mockResolvedValue(testProjects);
    mockNotesCreate.mockResolvedValue({
      id: 'note-png-001',
      project_id: 'proj-ttt',
      source: 'telegram',
      raw_text: sampleExtraction.raw_text,
      structured: sampleExtraction,
      created_at: new Date(),
    });

    openaiEmbeddingsCreate.mockResolvedValue({
      data: [{ embedding: new Array(1536).fill(0), index: 0 }],
    });

    // PNG magic bytes
    const pngBuffer = Buffer.from([0x89, 0x50, 0x4e, 0x47, ...Array(200).fill(0)]);
    const result = await agent.processImage(pngBuffer, 'telegram');

    // Verify the Vision API was called with PNG media type
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

    expect(result.noteId).toBe('note-png-001');
    expect(result.taskCount).toBe(3);
  });
});
