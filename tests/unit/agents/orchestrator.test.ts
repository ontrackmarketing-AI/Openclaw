import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockProjectsGetActive = vi.fn();
vi.mock('../../../src/db/repositories/projects.js', () => ({
  getActive: (...args: unknown[]) => mockProjectsGetActive(...args),
  getAll: vi.fn().mockResolvedValue([]),
  getById: vi.fn(),
  getByName: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
}));

const mockTasksGetByProjectId = vi.fn();
vi.mock('../../../src/db/repositories/tasks.js', () => ({
  getByProjectId: (...args: unknown[]) => mockTasksGetByProjectId(...args),
  getAll: vi.fn().mockResolvedValue([]),
  getById: vi.fn(),
  getOpen: vi.fn().mockResolvedValue([]),
  getOverdue: vi.fn().mockResolvedValue([]),
  create: vi.fn(),
  update: vi.fn(),
  markDone: vi.fn(),
  markEscalated: vi.fn(),
}));

const mockEscalationsCreate = vi.fn().mockResolvedValue({
  id: 'esc-1',
  type: 'test',
  summary: 'Test escalation',
  status: 'pending',
  created_at: new Date(),
});
const mockEscalationsGetPending = vi.fn().mockResolvedValue([]);
const mockEscalationsMarkActioned = vi.fn();
const mockEscalationsMarkDismissed = vi.fn();
vi.mock('../../../src/db/repositories/escalations.js', () => ({
  create: (...args: unknown[]) => mockEscalationsCreate(...args),
  getPending: (...args: unknown[]) => mockEscalationsGetPending(...args),
  getById: vi.fn(),
  markActioned: (...args: unknown[]) => mockEscalationsMarkActioned(...args),
  markDismissed: (...args: unknown[]) => mockEscalationsMarkDismissed(...args),
  setTelegramMessageId: vi.fn(),
}));

const mockInboxGetRecent = vi.fn().mockResolvedValue([]);
vi.mock('../../../src/db/repositories/inbox-events.js', () => ({
  getRecent: (...args: unknown[]) => mockInboxGetRecent(...args),
  create: vi.fn(),
  getByChannel: vi.fn().mockResolvedValue([]),
  isDuplicate: vi.fn().mockResolvedValue(false),
}));

const mockRedisGet = vi.fn().mockResolvedValue(null);
const mockRedisSet = vi.fn().mockResolvedValue('OK');
const mockRedisRpush = vi.fn().mockResolvedValue(1);
const mockRedisLpop = vi.fn().mockResolvedValue(null);
const mockRedisLlen = vi.fn().mockResolvedValue(0);
vi.mock('../../../src/db/redis.js', () => ({
  redis: {
    get: (...args: unknown[]) => mockRedisGet(...args),
    set: (...args: unknown[]) => mockRedisSet(...args),
    rpush: (...args: unknown[]) => mockRedisRpush(...args),
    lpop: (...args: unknown[]) => mockRedisLpop(...args),
    llen: (...args: unknown[]) => mockRedisLlen(...args),
    del: vi.fn().mockResolvedValue(1),
    incr: vi.fn().mockResolvedValue(1),
    expire: vi.fn().mockResolvedValue(1),
    on: vi.fn(),
    quit: vi.fn(),
  },
}));

vi.mock('../../../src/db/connection.js', () => ({
  query: vi.fn().mockResolvedValue({ rows: [], rowCount: 0 }),
  pool: { query: vi.fn(), on: vi.fn(), end: vi.fn() },
}));

import { OrchestratorAgent } from '../../../src/agents/orchestrator/index.js';
import type { AgentEvent, AgentResult } from '../../../src/agents/base.js';

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('OrchestratorAgent', () => {
  let orchestrator: OrchestratorAgent;

  beforeEach(() => {
    vi.clearAllMocks();
    orchestrator = new OrchestratorAgent();
  });

  // -------------------------------------------------------------------------
  // Event routing
  // -------------------------------------------------------------------------

  describe('routeEvent', () => {
    it('routes notebook_image to ingestion agent', () => {
      expect(orchestrator.routeEvent({ type: 'notebook_image', data: {} })).toBe('ingestion');
    });

    it('routes gmail_thread to inbox agent', () => {
      expect(orchestrator.routeEvent({ type: 'gmail_thread', data: {} })).toBe('inbox');
    });

    it('routes imessage_message to inbox agent', () => {
      expect(orchestrator.routeEvent({ type: 'imessage_message', data: {} })).toBe('inbox');
    });

    it('routes telegram_command to inbox agent', () => {
      expect(orchestrator.routeEvent({ type: 'telegram_command', data: {} })).toBe('inbox');
    });

    it('routes telegram_callback to inbox agent', () => {
      expect(orchestrator.routeEvent({ type: 'telegram_callback', data: {} })).toBe('inbox');
    });

    it('routes research_request to research agent', () => {
      expect(orchestrator.routeEvent({ type: 'research_request', data: {} })).toBe('research');
    });

    it('routes calendar_check to scheduler agent', () => {
      expect(orchestrator.routeEvent({ type: 'calendar_check', data: {} })).toBe('scheduler');
    });

    it('routes briefing_request to reporting agent', () => {
      expect(orchestrator.routeEvent({ type: 'briefing_request', data: {} })).toBe('reporting');
    });

    it('routes project_status_request to reporting agent', () => {
      expect(
        orchestrator.routeEvent({ type: 'project_status_request', data: {} }),
      ).toBe('reporting');
    });

    it('routes scheduled_cycle to orchestrator', () => {
      expect(orchestrator.routeEvent({ type: 'scheduled_cycle', data: {} })).toBe('orchestrator');
    });

    it('routes escalation_response to orchestrator', () => {
      expect(
        orchestrator.routeEvent({ type: 'escalation_response', data: {} }),
      ).toBe('orchestrator');
    });

    it('defaults unknown event types to orchestrator', () => {
      expect(
        orchestrator.routeEvent({ type: 'some_unknown_type' as any, data: {} }),
      ).toBe('orchestrator');
    });
  });

  // -------------------------------------------------------------------------
  // Project context loading
  // -------------------------------------------------------------------------

  describe('loadProjectContext', () => {
    it('loads projects and their tasks, caches in Redis', async () => {
      const projects = [
        {
          id: 'proj-1',
          name: 'Texas Tree Tops',
          client: 'TTT',
          status: 'active',
          priority: 1,
          metadata: {},
          created_at: new Date(),
          updated_at: new Date(),
        },
        {
          id: 'proj-2',
          name: 'Helium Solutions',
          client: null,
          status: 'active',
          priority: 2,
          metadata: {},
          created_at: new Date(),
          updated_at: new Date(),
        },
      ];

      mockProjectsGetActive.mockResolvedValue(projects);
      mockTasksGetByProjectId.mockResolvedValue([
        {
          id: 'task-1',
          project_id: 'proj-1',
          title: 'Update automations',
          status: 'open',
          priority: 1,
        },
      ]);

      const ctx = await orchestrator.loadProjectContext();

      expect(ctx.projects).toHaveLength(2);
      expect(ctx.tasksByProject['proj-1']).toBeDefined();
      expect(ctx.tasksByProject['proj-2']).toBeDefined();
      expect(ctx.loadedAt).toBeDefined();

      // Should cache to Redis with TTL
      expect(mockRedisSet).toHaveBeenCalledWith(
        'cache:project_context',
        expect.any(String),
        'EX',
        3600,
      );
    });
  });

  describe('getProjectContext', () => {
    it('returns cached context when available', async () => {
      const cachedCtx = {
        projects: [{ id: 'proj-1', name: 'Cached Project' }],
        tasksByProject: {},
        loadedAt: new Date().toISOString(),
      };
      mockRedisGet.mockResolvedValueOnce(JSON.stringify(cachedCtx));

      const ctx = await orchestrator.getProjectContext();

      expect(ctx.projects).toHaveLength(1);
      expect(ctx.projects[0].name).toBe('Cached Project');
      expect(mockProjectsGetActive).not.toHaveBeenCalled();
    });

    it('loads fresh context when cache is empty', async () => {
      mockRedisGet.mockResolvedValueOnce(null);
      mockProjectsGetActive.mockResolvedValue([]);

      await orchestrator.getProjectContext();

      expect(mockProjectsGetActive).toHaveBeenCalled();
    });

    it('reloads context when cache is corrupt', async () => {
      mockRedisGet.mockResolvedValueOnce('not valid json {{{');
      mockProjectsGetActive.mockResolvedValue([]);

      await orchestrator.getProjectContext();

      expect(mockProjectsGetActive).toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // Escalation decisions (processResults)
  // -------------------------------------------------------------------------

  describe('processResults', () => {
    it('handles success status without side effects', async () => {
      const result: AgentResult = {
        status: 'success',
        agent: 'ingestion',
        message: 'Note ingested successfully',
      };

      await orchestrator.processResults(result);

      expect(mockEscalationsCreate).not.toHaveBeenCalled();
      expect(mockRedisRpush).not.toHaveBeenCalled();
    });

    it('queues follow-up for partial results', async () => {
      const result: AgentResult = {
        status: 'partial',
        agent: 'inbox',
        message: 'Processed 3 threads, 1 needs follow-up',
        data: { remaining: 1 },
      };

      await orchestrator.processResults(result);

      expect(mockRedisRpush).toHaveBeenCalledWith(
        'queue:follow_up',
        expect.stringContaining('"agent":"inbox"'),
      );
    });

    it('creates escalation for escalate status', async () => {
      const result: AgentResult = {
        status: 'escalate',
        agent: 'inbox',
        message: 'Urgent email needs attention',
        escalation: {
          summary: 'Client requesting contract changes ASAP',
          context: 'From Daniel at SWRE',
          projectId: 'proj-swre',
        },
      };

      await orchestrator.processResults(result);

      expect(mockEscalationsCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'inbox',
          summary: 'Client requesting contract changes ASAP',
          context: 'From Daniel at SWRE',
          project_id: 'proj-swre',
        }),
      );
    });

    it('logs error for error status without creating escalation', async () => {
      const result: AgentResult = {
        status: 'error',
        agent: 'ingestion',
        message: 'Vision API timeout',
      };

      await orchestrator.processResults(result);

      expect(mockEscalationsCreate).not.toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // process (entry point)
  // -------------------------------------------------------------------------

  describe('process', () => {
    it('handles escalation_response with dismiss action', async () => {
      const event: AgentEvent = {
        type: 'escalation_response',
        data: { escalationId: 'esc-123', action: 'dismiss' },
      };

      const result = await orchestrator.process(event);

      expect(result.status).toBe('success');
      expect(mockEscalationsMarkDismissed).toHaveBeenCalledWith('esc-123');
      expect(mockEscalationsMarkActioned).not.toHaveBeenCalled();
    });

    it('handles escalation_response with approve action', async () => {
      const event: AgentEvent = {
        type: 'escalation_response',
        data: { escalationId: 'esc-456', action: 'approve' },
      };

      const result = await orchestrator.process(event);

      expect(result.status).toBe('success');
      expect(mockEscalationsMarkActioned).toHaveBeenCalledWith('esc-456');
    });

    it('returns error when escalation_response missing required fields', async () => {
      const event: AgentEvent = {
        type: 'escalation_response',
        data: { escalationId: 'esc-789' },
      };

      const result = await orchestrator.process(event);

      expect(result.status).toBe('error');
      expect(result.message).toContain('escalationId and action');
    });

    it('returns error for unhandled event types', async () => {
      const event: AgentEvent = {
        type: 'notebook_image',
        data: {},
      };

      const result = await orchestrator.process(event);

      expect(result.status).toBe('error');
      expect(result.message).toContain('cannot directly process');
    });

    it('handles scheduled_cycle event', async () => {
      mockProjectsGetActive.mockResolvedValue([]);
      mockRedisLlen.mockResolvedValue(0);
      mockEscalationsGetPending.mockResolvedValue([]);
      mockInboxGetRecent.mockResolvedValue([]);

      const event: AgentEvent = {
        type: 'scheduled_cycle',
        data: {},
      };

      const result = await orchestrator.process(event);

      expect(result.status).toBe('success');
      expect(result.message).toContain('Cycle complete');
    });
  });

  // -------------------------------------------------------------------------
  // Scheduled cycle
  // -------------------------------------------------------------------------

  describe('runScheduledCycle', () => {
    it('processes ingestion queue items', async () => {
      mockProjectsGetActive.mockResolvedValue([]);
      mockRedisLlen
        .mockResolvedValueOnce(2) // ingestion queue
        .mockResolvedValueOnce(0); // follow-up queue
      mockRedisLpop
        .mockResolvedValueOnce('image-1.jpg')
        .mockResolvedValueOnce('image-2.jpg');
      mockEscalationsGetPending.mockResolvedValue([]);
      mockInboxGetRecent.mockResolvedValue([]);

      const result = await orchestrator.runScheduledCycle();

      expect(result.status).toBe('success');
      expect(result.data?.ingestionProcessed).toBe(2);
    });

    it('reports pending escalations in cycle result', async () => {
      mockProjectsGetActive.mockResolvedValue([]);
      mockRedisLlen.mockResolvedValue(0);
      mockEscalationsGetPending.mockResolvedValue([
        { id: 'esc-1', summary: 'Pending item', status: 'pending' },
        { id: 'esc-2', summary: 'Another pending', status: 'pending' },
      ]);
      mockInboxGetRecent.mockResolvedValue([]);

      const result = await orchestrator.runScheduledCycle();

      expect(result.data?.pendingEscalations).toBe(2);
    });

    it('returns error status when cycle fails', async () => {
      mockProjectsGetActive.mockRejectedValue(new Error('Database connection lost'));

      const result = await orchestrator.runScheduledCycle();

      expect(result.status).toBe('error');
      expect(result.message).toContain('Database connection lost');
    });
  });
});
