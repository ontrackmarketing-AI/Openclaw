import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';

// ---------------------------------------------------------------------------
// Mocks — must be set up before importing the server
// ---------------------------------------------------------------------------

const mockProjectsGetAll = vi.fn();
const mockProjectsGetById = vi.fn();
const mockProjectsCreate = vi.fn();
const mockProjectsUpdate = vi.fn();
vi.mock('../../../src/db/repositories/projects.js', () => ({
  getAll: (...args: unknown[]) => mockProjectsGetAll(...args),
  getById: (...args: unknown[]) => mockProjectsGetById(...args),
  getByName: vi.fn(),
  getActive: vi.fn().mockResolvedValue([]),
  create: (...args: unknown[]) => mockProjectsCreate(...args),
  update: (...args: unknown[]) => mockProjectsUpdate(...args),
}));

const mockTasksGetAll = vi.fn();
const mockTasksGetOpen = vi.fn();
const mockTasksGetByProjectId = vi.fn();
const mockTasksGetById = vi.fn();
const mockTasksCreate = vi.fn();
const mockTasksUpdate = vi.fn();
vi.mock('../../../src/db/repositories/tasks.js', () => ({
  getAll: (...args: unknown[]) => mockTasksGetAll(...args),
  getOpen: (...args: unknown[]) => mockTasksGetOpen(...args),
  getByProjectId: (...args: unknown[]) => mockTasksGetByProjectId(...args),
  getById: (...args: unknown[]) => mockTasksGetById(...args),
  getOverdue: vi.fn().mockResolvedValue([]),
  create: (...args: unknown[]) => mockTasksCreate(...args),
  update: (...args: unknown[]) => mockTasksUpdate(...args),
  markDone: vi.fn(),
  markEscalated: vi.fn(),
}));

vi.mock('../../../src/db/repositories/escalations.js', () => ({
  create: vi.fn(),
  getPending: vi.fn().mockResolvedValue([]),
  getById: vi.fn(),
  markActioned: vi.fn(),
  markDismissed: vi.fn(),
  setTelegramMessageId: vi.fn(),
}));

vi.mock('../../../src/db/repositories/notes.js', () => ({
  create: vi.fn(),
  getAll: vi.fn().mockResolvedValue([]),
  getById: vi.fn(),
  getByProjectId: vi.fn().mockResolvedValue([]),
}));

vi.mock('../../../src/db/repositories/contacts.js', () => ({
  getAll: vi.fn().mockResolvedValue([]),
  getById: vi.fn(),
  getByEmail: vi.fn(),
  getVIPs: vi.fn().mockResolvedValue([]),
  create: vi.fn(),
  update: vi.fn(),
  findByAnyHandle: vi.fn(),
}));

vi.mock('../../../src/db/repositories/inbox-events.js', () => ({
  create: vi.fn(),
  getByChannel: vi.fn().mockResolvedValue([]),
  getRecent: vi.fn().mockResolvedValue([]),
  isDuplicate: vi.fn().mockResolvedValue(false),
}));

vi.mock('../../../src/db/connection.js', () => ({
  query: vi.fn().mockResolvedValue({ rows: [], rowCount: 0 }),
  pool: { query: vi.fn(), on: vi.fn(), end: vi.fn() },
}));

vi.mock('../../../src/db/redis.js', () => ({
  redis: { on: vi.fn(), get: vi.fn(), set: vi.fn() },
}));

// We need to stub out the repo barrel export so the routes find them
vi.mock('../../../src/db/repositories/index.js', async () => {
  const projects = await import('../../../src/db/repositories/projects.js');
  const tasks = await import('../../../src/db/repositories/tasks.js');
  const escalations = await import('../../../src/db/repositories/escalations.js');
  const notes = await import('../../../src/db/repositories/notes.js');
  const contacts = await import('../../../src/db/repositories/contacts.js');
  const inboxEvents = await import('../../../src/db/repositories/inbox-events.js');
  return {
    projectsRepo: projects,
    tasksRepo: tasks,
    escalationsRepo: escalations,
    notesRepo: notes,
    contactsRepo: contacts,
    inboxEventsRepo: inboxEvents,
    agentLogsRepo: {
      log: vi.fn(),
      getByAgent: vi.fn().mockResolvedValue([]),
      getRecent: vi.fn().mockResolvedValue([]),
    },
  };
});

import { createServer } from '../../../src/server/index.js';

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

const AUTH_HEADER = 'Bearer test-secret-token';
let app: Express;

beforeAll(() => {
  app = createServer();
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('API Routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // -------------------------------------------------------------------------
  // Health check
  // -------------------------------------------------------------------------

  describe('GET /health', () => {
    it('returns 200 with status ok', async () => {
      const res = await request(app).get('/health');

      expect(res.status).toBe(200);
      expect(res.body.status).toBe('ok');
      expect(res.body.service).toBe('openclaw');
      expect(res.body.timestamp).toBeDefined();
      expect(res.body.uptime).toBeDefined();
    });

    it('does not require authentication', async () => {
      const res = await request(app).get('/health');
      expect(res.status).toBe(200);
    });
  });

  // -------------------------------------------------------------------------
  // Auth middleware
  // -------------------------------------------------------------------------

  describe('Auth middleware', () => {
    it('rejects requests with missing Authorization header', async () => {
      const res = await request(app).get('/api/projects');

      expect(res.status).toBe(401);
      expect(res.body.error).toContain('Missing Authorization header');
    });

    it('rejects requests with malformed Authorization header', async () => {
      const res = await request(app)
        .get('/api/projects')
        .set('Authorization', 'Basic bad-token');

      expect(res.status).toBe(401);
      expect(res.body.error).toContain('Invalid Authorization format');
    });

    it('rejects requests with invalid token', async () => {
      const res = await request(app)
        .get('/api/projects')
        .set('Authorization', 'Bearer wrong-token');

      expect(res.status).toBe(403);
      expect(res.body.error).toContain('Invalid API key');
    });

    it('accepts requests with valid token', async () => {
      mockProjectsGetAll.mockResolvedValue([]);

      const res = await request(app)
        .get('/api/projects')
        .set('Authorization', AUTH_HEADER);

      expect(res.status).toBe(200);
    });
  });

  // -------------------------------------------------------------------------
  // Projects CRUD
  // -------------------------------------------------------------------------

  describe('Projects endpoints', () => {
    it('GET /api/projects returns all projects', async () => {
      const projects = [
        {
          id: 'p1',
          name: 'Texas Tree Tops',
          client: 'TTT',
          status: 'active',
          priority: 1,
        },
      ];
      mockProjectsGetAll.mockResolvedValue(projects);

      const res = await request(app)
        .get('/api/projects')
        .set('Authorization', AUTH_HEADER);

      expect(res.status).toBe(200);
      expect(res.body.data).toHaveLength(1);
      expect(res.body.data[0].name).toBe('Texas Tree Tops');
    });

    it('GET /api/projects/:id returns a specific project', async () => {
      const project = {
        id: 'p1',
        name: 'Texas Tree Tops',
        client: 'TTT',
        status: 'active',
        priority: 1,
      };
      mockProjectsGetById.mockResolvedValue(project);

      const res = await request(app)
        .get('/api/projects/p1')
        .set('Authorization', AUTH_HEADER);

      expect(res.status).toBe(200);
      expect(res.body.data.name).toBe('Texas Tree Tops');
    });

    it('GET /api/projects/:id returns 404 for nonexistent project', async () => {
      mockProjectsGetById.mockResolvedValue(null);

      const res = await request(app)
        .get('/api/projects/nonexistent')
        .set('Authorization', AUTH_HEADER);

      expect(res.status).toBe(404);
      expect(res.body.error).toContain('not found');
    });

    it('GET /api/projects returns 500 on database error', async () => {
      mockProjectsGetAll.mockRejectedValue(new Error('DB connection failed'));

      const res = await request(app)
        .get('/api/projects')
        .set('Authorization', AUTH_HEADER);

      expect(res.status).toBe(500);
    });
  });

  // -------------------------------------------------------------------------
  // Tasks CRUD
  // -------------------------------------------------------------------------

  describe('Tasks endpoints', () => {
    it('GET /api/tasks returns all tasks', async () => {
      const tasks = [
        {
          id: 't1',
          title: 'Update automations',
          status: 'open',
          priority: 1,
        },
      ];
      mockTasksGetAll.mockResolvedValue(tasks);

      const res = await request(app)
        .get('/api/tasks')
        .set('Authorization', AUTH_HEADER);

      expect(res.status).toBe(200);
      expect(res.body.data).toHaveLength(1);
    });

    it('GET /api/tasks?status=open returns only open tasks', async () => {
      mockTasksGetOpen.mockResolvedValue([
        { id: 't1', title: 'Open task', status: 'open' },
      ]);

      const res = await request(app)
        .get('/api/tasks?status=open')
        .set('Authorization', AUTH_HEADER);

      expect(res.status).toBe(200);
      expect(mockTasksGetOpen).toHaveBeenCalled();
    });

    it('GET /api/tasks?project_id=p1 filters by project', async () => {
      mockTasksGetByProjectId.mockResolvedValue([
        { id: 't1', title: 'Project task', project_id: 'p1' },
      ]);

      const res = await request(app)
        .get('/api/tasks?project_id=p1')
        .set('Authorization', AUTH_HEADER);

      expect(res.status).toBe(200);
      expect(mockTasksGetByProjectId).toHaveBeenCalledWith('p1');
    });

    it('POST /api/tasks creates a new task', async () => {
      const newTask = {
        id: 't-new',
        title: 'New task',
        status: 'open',
        priority: 3,
        project_id: null,
      };
      mockTasksCreate.mockResolvedValue(newTask);

      const res = await request(app)
        .post('/api/tasks')
        .set('Authorization', AUTH_HEADER)
        .send({ title: 'New task', priority: 3 });

      expect(res.status).toBe(201);
      expect(res.body.data.title).toBe('New task');
    });

    it('POST /api/tasks returns 400 when title is missing', async () => {
      const res = await request(app)
        .post('/api/tasks')
        .set('Authorization', AUTH_HEADER)
        .send({ priority: 3 });

      expect(res.status).toBe(400);
      expect(res.body.error).toContain('title is required');
    });

    it('PATCH /api/tasks/:id updates a task', async () => {
      const existing = {
        id: 't1',
        title: 'Old title',
        status: 'open',
        priority: 3,
      };
      const updated = { ...existing, status: 'done' };
      mockTasksGetById.mockResolvedValue(existing);
      mockTasksUpdate.mockResolvedValue(updated);

      const res = await request(app)
        .patch('/api/tasks/t1')
        .set('Authorization', AUTH_HEADER)
        .send({ status: 'done' });

      expect(res.status).toBe(200);
      expect(res.body.data.status).toBe('done');
    });

    it('PATCH /api/tasks/:id returns 404 for nonexistent task', async () => {
      mockTasksGetById.mockResolvedValue(null);

      const res = await request(app)
        .patch('/api/tasks/nonexistent')
        .set('Authorization', AUTH_HEADER)
        .send({ status: 'done' });

      expect(res.status).toBe(404);
    });
  });

  // -------------------------------------------------------------------------
  // 404 handler
  // -------------------------------------------------------------------------

  describe('404 handler', () => {
    it('returns 404 for unknown routes', async () => {
      const res = await request(app)
        .get('/api/unknown-route')
        .set('Authorization', AUTH_HEADER);

      expect(res.status).toBe(404);
      expect(res.body.error).toBe('Not found');
    });
  });
});
