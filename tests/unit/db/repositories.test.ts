import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// We mock the connection module so repository functions use our mock query
// ---------------------------------------------------------------------------

const mockQuery = vi.fn();
vi.mock('../../../src/db/connection.js', () => ({
  query: (...args: unknown[]) => mockQuery(...args),
  pool: {
    query: vi.fn(),
    connect: vi.fn(),
    end: vi.fn(),
    on: vi.fn(),
  },
  getClient: vi.fn(),
  withTransaction: vi.fn(),
  shutdown: vi.fn(),
}));

vi.mock('../../../src/db/redis.js', () => ({
  redis: { on: vi.fn(), get: vi.fn(), set: vi.fn() },
}));

import * as projectsRepo from '../../../src/db/repositories/projects.js';
import * as tasksRepo from '../../../src/db/repositories/tasks.js';
import * as contactsRepo from '../../../src/db/repositories/contacts.js';
import * as escalationsRepo from '../../../src/db/repositories/escalations.js';
import * as inboxEventsRepo from '../../../src/db/repositories/inbox-events.js';

// ---------------------------------------------------------------------------
// Test data factories
// ---------------------------------------------------------------------------

function makeProjectRow(overrides: Partial<projectsRepo.Project> = {}): projectsRepo.Project {
  return {
    id: 'proj-001',
    name: 'Texas Tree Tops',
    client: 'TTT Client',
    status: 'active',
    priority: 1,
    metadata: {},
    created_at: new Date('2025-01-01'),
    updated_at: new Date('2025-01-01'),
    ...overrides,
  };
}

function makeTaskRow(overrides: Partial<tasksRepo.Task> = {}): tasksRepo.Task {
  return {
    id: 'task-001',
    project_id: 'proj-001',
    source: 'notebook',
    source_ref: 'note-1',
    title: 'Update automations',
    description: null,
    status: 'open',
    priority: 1,
    due_date: '2025-03-20',
    agent_handled: false,
    escalated_to_bryson: false,
    escalation_reason: null,
    created_at: new Date('2025-01-01'),
    updated_at: new Date('2025-01-01'),
    ...overrides,
  };
}

function makeContactRow(
  overrides: Partial<contactsRepo.Contact> = {},
): contactsRepo.Contact {
  return {
    id: 'contact-001',
    name: 'Daniel',
    email: 'daniel@swre.com',
    phone: '+15551234567',
    imessage_handle: 'daniel@icloud.com',
    telegram_username: 'daniel_swre',
    type: 'client',
    project_ids: ['proj-swre'],
    is_vip: true,
    last_contact: null,
    notes: 'Key SWRE contact',
    created_at: new Date('2025-01-01'),
    ...overrides,
  };
}

function makeEscalationRow(
  overrides: Partial<escalationsRepo.Escalation> = {},
): escalationsRepo.Escalation {
  return {
    id: 'esc-001',
    type: 'gmail',
    project_id: 'proj-ttt',
    task_id: null,
    inbox_event_id: null,
    summary: 'Urgent email needs response',
    context: 'From Daniel at SWRE',
    options: null,
    status: 'pending',
    telegram_message_id: null,
    created_at: new Date('2025-01-01'),
    actioned_at: null,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Repository Functions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // -------------------------------------------------------------------------
  // Projects CRUD
  // -------------------------------------------------------------------------

  describe('projectsRepo', () => {
    it('getAll returns all projects ordered by priority', async () => {
      const rows = [
        makeProjectRow({ id: 'p1', priority: 1 }),
        makeProjectRow({ id: 'p2', priority: 2, name: 'Helium Solutions' }),
      ];
      mockQuery.mockResolvedValueOnce({ rows, rowCount: 2 });

      const result = await projectsRepo.getAll();

      expect(result).toHaveLength(2);
      expect(mockQuery).toHaveBeenCalledWith(
        'SELECT * FROM projects ORDER BY priority ASC, name ASC',
      );
    });

    it('getById returns project or null', async () => {
      const row = makeProjectRow();
      mockQuery.mockResolvedValueOnce({ rows: [row], rowCount: 1 });

      const result = await projectsRepo.getById('proj-001');

      expect(result).toEqual(row);
      expect(mockQuery).toHaveBeenCalledWith('SELECT * FROM projects WHERE id = $1', [
        'proj-001',
      ]);
    });

    it('getById returns null for nonexistent project', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 0 });

      const result = await projectsRepo.getById('nonexistent');

      expect(result).toBeNull();
    });

    it('getByName does case-insensitive search', async () => {
      const row = makeProjectRow();
      mockQuery.mockResolvedValueOnce({ rows: [row], rowCount: 1 });

      await projectsRepo.getByName('texas tree tops');

      expect(mockQuery).toHaveBeenCalledWith(
        'SELECT * FROM projects WHERE LOWER(name) = LOWER($1)',
        ['texas tree tops'],
      );
    });

    it('create inserts a new project with defaults', async () => {
      const row = makeProjectRow();
      mockQuery.mockResolvedValueOnce({ rows: [row], rowCount: 1 });

      const result = await projectsRepo.create({
        name: 'Texas Tree Tops',
        client: 'TTT Client',
      });

      expect(result.name).toBe('Texas Tree Tops');
      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO projects'),
        expect.arrayContaining(['Texas Tree Tops', 'TTT Client', 'active', 3]),
      );
    });

    it('update builds dynamic SET clause', async () => {
      const updated = makeProjectRow({ priority: 1, name: 'Updated Name' });
      mockQuery.mockResolvedValueOnce({ rows: [updated], rowCount: 1 });

      const result = await projectsRepo.update('proj-001', {
        name: 'Updated Name',
        priority: 1,
      });

      expect(result?.name).toBe('Updated Name');
      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining('UPDATE projects SET'),
        expect.arrayContaining(['Updated Name', 1, 'proj-001']),
      );
    });

    it('update returns existing project when no fields to update', async () => {
      const existing = makeProjectRow();
      mockQuery.mockResolvedValueOnce({ rows: [existing], rowCount: 1 });

      const result = await projectsRepo.update('proj-001', {});

      // Should fall through to getById
      expect(result).toEqual(existing);
    });

    it('getActive returns only active projects', async () => {
      const rows = [makeProjectRow()];
      mockQuery.mockResolvedValueOnce({ rows, rowCount: 1 });

      await projectsRepo.getActive();

      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining("status = 'active'"),
      );
    });
  });

  // -------------------------------------------------------------------------
  // Tasks CRUD
  // -------------------------------------------------------------------------

  describe('tasksRepo', () => {
    it('getAll returns tasks sorted by priority then creation date', async () => {
      const rows = [makeTaskRow()];
      mockQuery.mockResolvedValueOnce({ rows, rowCount: 1 });

      await tasksRepo.getAll();

      expect(mockQuery).toHaveBeenCalledWith(
        'SELECT * FROM tasks ORDER BY priority ASC, created_at DESC',
      );
    });

    it('getByProjectId filters by project', async () => {
      const rows = [makeTaskRow()];
      mockQuery.mockResolvedValueOnce({ rows, rowCount: 1 });

      const result = await tasksRepo.getByProjectId('proj-001');

      expect(result).toHaveLength(1);
      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining('project_id = $1'),
        ['proj-001'],
      );
    });

    it('getOpen returns only open tasks', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 0 });

      await tasksRepo.getOpen();

      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining("status = 'open'"),
      );
    });

    it('getOverdue returns overdue open tasks', async () => {
      const overdueTask = makeTaskRow({ due_date: '2025-01-01' });
      mockQuery.mockResolvedValueOnce({ rows: [overdueTask], rowCount: 1 });

      const result = await tasksRepo.getOverdue();

      expect(result).toHaveLength(1);
      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining('due_date < CURRENT_DATE'),
      );
    });

    it('create inserts task with default values', async () => {
      const row = makeTaskRow();
      mockQuery.mockResolvedValueOnce({ rows: [row], rowCount: 1 });

      const result = await tasksRepo.create({ title: 'Update automations' });

      expect(result.title).toBe('Update automations');
      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO tasks'),
        expect.arrayContaining([
          null, // project_id
          null, // source
          null, // source_ref
          'Update automations',
          null, // description
          'open', // status default
          3, // priority default
          null, // due_date
          false, // agent_handled
        ]),
      );
    });

    it('update builds dynamic query with multiple fields', async () => {
      const updated = makeTaskRow({ status: 'done', priority: 1 });
      mockQuery.mockResolvedValueOnce({ rows: [updated], rowCount: 1 });

      await tasksRepo.update('task-001', { status: 'done', priority: 1 });

      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining('UPDATE tasks SET'),
        expect.arrayContaining(['done', 1, 'task-001']),
      );
    });

    it('markDone sets status to done', async () => {
      const doneTask = makeTaskRow({ status: 'done' });
      mockQuery.mockResolvedValueOnce({ rows: [doneTask], rowCount: 1 });

      const result = await tasksRepo.markDone('task-001');

      expect(result?.status).toBe('done');
      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining("status = 'done'"),
        ['task-001'],
      );
    });

    it('markEscalated sets escalation fields', async () => {
      const escalated = makeTaskRow({ escalated_to_bryson: true, escalation_reason: 'Needs input' });
      mockQuery.mockResolvedValueOnce({ rows: [escalated], rowCount: 1 });

      const result = await tasksRepo.markEscalated('task-001', 'Needs input');

      expect(result?.escalated_to_bryson).toBe(true);
      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining('escalated_to_bryson = true'),
        ['task-001', 'Needs input'],
      );
    });
  });

  // -------------------------------------------------------------------------
  // Contacts — findByAnyHandle
  // -------------------------------------------------------------------------

  describe('contactsRepo', () => {
    it('findByAnyHandle matches by email', async () => {
      const contact = makeContactRow();
      mockQuery.mockResolvedValueOnce({ rows: [contact], rowCount: 1 });

      const result = await contactsRepo.findByAnyHandle('daniel@swre.com');

      expect(result).toEqual(contact);
      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining('LOWER(email) = LOWER($1)'),
        ['daniel@swre.com'],
      );
    });

    it('findByAnyHandle matches by phone', async () => {
      const contact = makeContactRow();
      mockQuery.mockResolvedValueOnce({ rows: [contact], rowCount: 1 });

      const result = await contactsRepo.findByAnyHandle('+15551234567');

      expect(result).toEqual(contact);
      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining('phone = $1'),
        ['+15551234567'],
      );
    });

    it('findByAnyHandle matches by imessage handle', async () => {
      const contact = makeContactRow();
      mockQuery.mockResolvedValueOnce({ rows: [contact], rowCount: 1 });

      const result = await contactsRepo.findByAnyHandle('daniel@icloud.com');
      expect(result).toEqual(contact);
    });

    it('findByAnyHandle matches by telegram username', async () => {
      const contact = makeContactRow();
      mockQuery.mockResolvedValueOnce({ rows: [contact], rowCount: 1 });

      const result = await contactsRepo.findByAnyHandle('daniel_swre');
      expect(result).toEqual(contact);
    });

    it('findByAnyHandle returns null when no match', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 0 });

      const result = await contactsRepo.findByAnyHandle('nobody@nowhere.com');
      expect(result).toBeNull();
    });

    it('getVIPs returns only VIP contacts', async () => {
      const vips = [makeContactRow({ is_vip: true })];
      mockQuery.mockResolvedValueOnce({ rows: vips, rowCount: 1 });

      const result = await contactsRepo.getVIPs();

      expect(result).toHaveLength(1);
      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining('is_vip = true'),
      );
    });

    it('create inserts contact with all fields', async () => {
      const contact = makeContactRow();
      mockQuery.mockResolvedValueOnce({ rows: [contact], rowCount: 1 });

      const result = await contactsRepo.create({
        name: 'Daniel',
        email: 'daniel@swre.com',
        is_vip: true,
      });

      expect(result.name).toBe('Daniel');
      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO contacts'),
        expect.arrayContaining(['Daniel', 'daniel@swre.com']),
      );
    });
  });

  // -------------------------------------------------------------------------
  // Escalations — status transitions
  // -------------------------------------------------------------------------

  describe('escalationsRepo', () => {
    it('create inserts a new escalation', async () => {
      const esc = makeEscalationRow();
      mockQuery.mockResolvedValueOnce({ rows: [esc], rowCount: 1 });

      const result = await escalationsRepo.create({
        type: 'gmail',
        summary: 'Urgent email needs response',
        context: 'From Daniel at SWRE',
        project_id: 'proj-ttt',
      });

      expect(result.summary).toBe('Urgent email needs response');
      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO escalations'),
        expect.any(Array),
      );
    });

    it('getPending returns only pending escalations', async () => {
      const rows = [makeEscalationRow()];
      mockQuery.mockResolvedValueOnce({ rows, rowCount: 1 });

      const result = await escalationsRepo.getPending();

      expect(result).toHaveLength(1);
      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining("status = 'pending'"),
      );
    });

    it('markActioned transitions status to actioned', async () => {
      const actioned = makeEscalationRow({
        status: 'actioned',
        actioned_at: new Date(),
      });
      mockQuery.mockResolvedValueOnce({ rows: [actioned], rowCount: 1 });

      const result = await escalationsRepo.markActioned('esc-001');

      expect(result?.status).toBe('actioned');
      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining("status = 'actioned'"),
        ['esc-001'],
      );
    });

    it('markDismissed transitions status to dismissed', async () => {
      const dismissed = makeEscalationRow({
        status: 'dismissed',
        actioned_at: new Date(),
      });
      mockQuery.mockResolvedValueOnce({ rows: [dismissed], rowCount: 1 });

      const result = await escalationsRepo.markDismissed('esc-001');

      expect(result?.status).toBe('dismissed');
      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining("status = 'dismissed'"),
        ['esc-001'],
      );
    });

    it('setTelegramMessageId updates the message ID', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 1 });

      await escalationsRepo.setTelegramMessageId('esc-001', '12345');

      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining('telegram_message_id = $1'),
        ['12345', 'esc-001'],
      );
    });

    it('getById returns null for nonexistent escalation', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 0 });

      const result = await escalationsRepo.getById('nonexistent');
      expect(result).toBeNull();
    });
  });

  // -------------------------------------------------------------------------
  // Inbox events — deduplication
  // -------------------------------------------------------------------------

  describe('inboxEventsRepo', () => {
    it('isDuplicate returns true when event exists', async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [{ exists: true }],
        rowCount: 1,
      });

      const result = await inboxEventsRepo.isDuplicate('gmail', 'thread-001');

      expect(result).toBe(true);
      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining('channel = $1 AND external_id = $2'),
        ['gmail', 'thread-001'],
      );
    });

    it('isDuplicate returns false when event does not exist', async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [{ exists: false }],
        rowCount: 1,
      });

      const result = await inboxEventsRepo.isDuplicate('gmail', 'thread-new');

      expect(result).toBe(false);
    });

    it('create stores a new inbox event', async () => {
      const row = {
        id: 'inbox-001',
        channel: 'gmail',
        external_id: 'thread-001',
        sender: 'test@example.com',
        contact_id: null,
        project_id: null,
        subject: 'Test Subject',
        body_summary: 'Test summary',
        intent: 'fyi',
        agent_action: 'logged',
        escalated: false,
        processed_at: new Date(),
      };
      mockQuery.mockResolvedValueOnce({ rows: [row], rowCount: 1 });

      const result = await inboxEventsRepo.create({
        channel: 'gmail',
        external_id: 'thread-001',
        sender: 'test@example.com',
        subject: 'Test Subject',
        body_summary: 'Test summary',
        intent: 'fyi',
        agent_action: 'logged',
      });

      expect(result.channel).toBe('gmail');
      expect(result.external_id).toBe('thread-001');
    });

    it('getRecent returns events ordered by processed_at desc', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 0 });

      await inboxEventsRepo.getRecent(10);

      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining('ORDER BY processed_at DESC LIMIT $1'),
        [10],
      );
    });
  });
});
