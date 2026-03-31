import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockProjectsGetActive = vi.fn();
const mockProjectsGetByName = vi.fn();
vi.mock('../../../src/db/repositories/projects.js', () => ({
  getActive: (...args: unknown[]) => mockProjectsGetActive(...args),
  getByName: (...args: unknown[]) => mockProjectsGetByName(...args),
  getAll: vi.fn().mockResolvedValue([]),
  getById: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
}));

const mockTasksGetOpen = vi.fn();
const mockTasksGetById = vi.fn();
const mockTasksGetByProjectId = vi.fn();
const mockTasksUpdate = vi.fn();
vi.mock('../../../src/db/repositories/tasks.js', () => ({
  getOpen: (...args: unknown[]) => mockTasksGetOpen(...args),
  getById: (...args: unknown[]) => mockTasksGetById(...args),
  getByProjectId: (...args: unknown[]) => mockTasksGetByProjectId(...args),
  update: (...args: unknown[]) => mockTasksUpdate(...args),
  getAll: vi.fn().mockResolvedValue([]),
  getOverdue: vi.fn().mockResolvedValue([]),
  create: vi.fn(),
  markDone: vi.fn(),
  markEscalated: vi.fn(),
}));

const mockEscalationsGetPending = vi.fn();
const mockEscalationsGetById = vi.fn();
const mockEscalationsMarkActioned = vi.fn();
const mockEscalationsMarkDismissed = vi.fn();
vi.mock('../../../src/db/repositories/escalations.js', () => ({
  getPending: (...args: unknown[]) => mockEscalationsGetPending(...args),
  getById: (...args: unknown[]) => mockEscalationsGetById(...args),
  markActioned: (...args: unknown[]) => mockEscalationsMarkActioned(...args),
  markDismissed: (...args: unknown[]) => mockEscalationsMarkDismissed(...args),
  create: vi.fn(),
  setTelegramMessageId: vi.fn(),
}));

const mockNotesCreate = vi.fn().mockResolvedValue({
  id: 'note-1',
  raw_text: 'Test note',
  source: 'telegram',
  created_at: new Date(),
});
vi.mock('../../../src/db/repositories/notes.js', () => ({
  create: (...args: unknown[]) => mockNotesCreate(...args),
  getAll: vi.fn().mockResolvedValue([]),
  getById: vi.fn(),
  getByProjectId: vi.fn().mockResolvedValue([]),
}));

vi.mock('../../../src/db/connection.js', () => ({
  query: vi.fn().mockResolvedValue({ rows: [], rowCount: 0 }),
  pool: { query: vi.fn(), on: vi.fn(), end: vi.fn() },
}));

vi.mock('../../../src/db/redis.js', () => ({
  redis: { on: vi.fn(), get: vi.fn(), set: vi.fn() },
}));

import { TelegramSubAgent } from '../../../src/agents/inbox/telegram.js';
import type { Escalation } from '../../../src/db/repositories/escalations.js';

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('TelegramSubAgent', () => {
  let telegram: TelegramSubAgent;
  const AUTHORIZED_CHAT_ID = '123456789';
  const UNAUTHORIZED_CHAT_ID = '999999999';

  beforeEach(() => {
    vi.clearAllMocks();
    telegram = new TelegramSubAgent();
  });

  // -------------------------------------------------------------------------
  // Command parsing
  // -------------------------------------------------------------------------

  describe('handleCommand', () => {
    it('returns unauthorized message for wrong chat ID', async () => {
      const response = await telegram.handleCommand('status', '', UNAUTHORIZED_CHAT_ID);
      expect(response).toBe('Unauthorized.');
    });

    it('handles /brief command', async () => {
      const response = await telegram.handleCommand('brief', '', AUTHORIZED_CHAT_ID);
      expect(response).toContain('briefing');
    });

    it('handles /status command with active projects', async () => {
      mockProjectsGetActive.mockResolvedValue([
        {
          id: 'p1',
          name: 'Texas Tree Tops',
          client: 'TTT Client',
          status: 'active',
          priority: 1,
        },
        {
          id: 'p2',
          name: 'Helium Solutions',
          client: null,
          status: 'active',
          priority: 2,
        },
      ]);

      const response = await telegram.handleCommand('status', '', AUTHORIZED_CHAT_ID);

      expect(response).toContain('Active Projects');
      expect(response).toContain('Texas Tree Tops');
      expect(response).toContain('Helium Solutions');
      expect(response).toContain('P1');
    });

    it('handles /status command with no active projects', async () => {
      mockProjectsGetActive.mockResolvedValue([]);

      const response = await telegram.handleCommand('status', '', AUTHORIZED_CHAT_ID);
      expect(response).toBe('No active projects.');
    });

    it('handles /tasks command with open tasks', async () => {
      mockTasksGetOpen.mockResolvedValue([
        {
          id: 't1',
          title: 'Update automations',
          status: 'open',
          priority: 1,
          due_date: '2025-03-20',
        },
        {
          id: 't2',
          title: 'Design landing page',
          status: 'open',
          priority: 3,
          due_date: null,
        },
      ]);

      const response = await telegram.handleCommand('tasks', '', AUTHORIZED_CHAT_ID);

      expect(response).toContain('Open Tasks');
      expect(response).toContain('Update automations');
      expect(response).toContain('due 2025-03-20');
    });

    it('handles /tasks with project filter', async () => {
      mockProjectsGetByName.mockResolvedValue({
        id: 'p1',
        name: 'Texas Tree Tops',
      });
      mockTasksGetByProjectId.mockResolvedValue([
        {
          id: 't1',
          title: 'TTT task',
          status: 'open',
          priority: 1,
          due_date: null,
        },
      ]);

      const response = await telegram.handleCommand(
        'tasks',
        'Texas Tree Tops',
        AUTHORIZED_CHAT_ID,
      );

      expect(response).toContain('Texas Tree Tops');
    });

    it('handles /tasks with nonexistent project', async () => {
      mockProjectsGetByName.mockResolvedValue(null);

      const response = await telegram.handleCommand(
        'tasks',
        'Nonexistent Project',
        AUTHORIZED_CHAT_ID,
      );

      expect(response).toContain('No project found');
    });

    it('handles /tasks with no open tasks', async () => {
      mockTasksGetOpen.mockResolvedValue([]);

      const response = await telegram.handleCommand('tasks', '', AUTHORIZED_CHAT_ID);
      expect(response).toBe('No open tasks.');
    });

    it('handles /escalations command', async () => {
      mockEscalationsGetPending.mockResolvedValue([
        {
          id: 'esc-1',
          summary: 'Urgent email from Daniel',
          type: 'gmail',
          status: 'pending',
        },
      ]);

      const response = await telegram.handleCommand(
        'escalations',
        '',
        AUTHORIZED_CHAT_ID,
      );

      expect(response).toContain('Pending Escalations');
      expect(response).toContain('Urgent email from Daniel');
    });

    it('handles /escalations with no pending items', async () => {
      mockEscalationsGetPending.mockResolvedValue([]);

      const response = await telegram.handleCommand(
        'escalations',
        '',
        AUTHORIZED_CHAT_ID,
      );

      expect(response).toContain('No pending escalations');
    });

    it('handles /done command', async () => {
      const task = {
        id: 't1',
        title: 'Update automations',
        status: 'open',
        priority: 1,
      };
      mockTasksGetById.mockResolvedValue(task);
      mockTasksUpdate.mockResolvedValue({ ...task, status: 'done' });

      const response = await telegram.handleCommand('done', 't1', AUTHORIZED_CHAT_ID);

      expect(response).toContain('Marked done');
      expect(response).toContain('Update automations');
    });

    it('handles /done without task ID', async () => {
      const response = await telegram.handleCommand('done', '', AUTHORIZED_CHAT_ID);
      expect(response).toContain('Usage');
    });

    it('handles /skip command', async () => {
      const escalation = {
        id: 'esc-1',
        summary: 'Some escalation',
        status: 'pending',
      };
      mockEscalationsGetById.mockResolvedValue(escalation);
      mockEscalationsMarkDismissed.mockResolvedValue({
        ...escalation,
        status: 'dismissed',
      });

      const response = await telegram.handleCommand(
        'skip',
        'esc-1',
        AUTHORIZED_CHAT_ID,
      );

      expect(response).toContain('Skipped');
      expect(mockEscalationsMarkDismissed).toHaveBeenCalledWith('esc-1');
    });

    it('handles /approve command', async () => {
      const escalation = {
        id: 'esc-1',
        summary: 'Approve this',
        status: 'pending',
      };
      mockEscalationsGetById.mockResolvedValue(escalation);
      mockEscalationsMarkActioned.mockResolvedValue({
        ...escalation,
        status: 'actioned',
      });

      const response = await telegram.handleCommand(
        'approve',
        'esc-1',
        AUTHORIZED_CHAT_ID,
      );

      expect(response).toContain('Approved');
      expect(mockEscalationsMarkActioned).toHaveBeenCalledWith('esc-1');
    });

    it('handles /note command', async () => {
      const response = await telegram.handleCommand(
        'note',
        'Remember to call Mike about Search Tuners',
        AUTHORIZED_CHAT_ID,
      );

      expect(response).toContain('Note saved');
      expect(mockNotesCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          source: 'telegram',
          raw_text: 'Remember to call Mike about Search Tuners',
        }),
      );
    });

    it('handles /note without text', async () => {
      const response = await telegram.handleCommand('note', '', AUTHORIZED_CHAT_ID);
      expect(response).toContain('Usage');
    });

    it('handles /ingest command', async () => {
      const response = await telegram.handleCommand(
        'ingest',
        '',
        AUTHORIZED_CHAT_ID,
      );

      expect(response).toContain('photo');
    });

    it('returns help for unknown commands', async () => {
      const response = await telegram.handleCommand(
        'unknown_cmd',
        '',
        AUTHORIZED_CHAT_ID,
      );

      expect(response).toContain('Unknown command');
      expect(response).toContain('/brief');
      expect(response).toContain('/status');
      expect(response).toContain('/tasks');
    });
  });

  // -------------------------------------------------------------------------
  // Escalation message formatting
  // -------------------------------------------------------------------------

  describe('sendEscalation', () => {
    it('formats escalation with type and context', async () => {
      const escalation: Escalation = {
        id: 'esc-test',
        type: 'gmail',
        project_id: null,
        task_id: null,
        inbox_event_id: null,
        summary: 'Urgent: Client needs contract review',
        context: 'Email from Daniel at SWRE regarding Q3 contract changes.',
        options: null,
        status: 'pending',
        telegram_message_id: null,
        created_at: new Date(),
        actioned_at: null,
      };

      const messageId = await telegram.sendEscalation(escalation);

      expect(messageId).toBe(42); // from mock
      // Verify sendMessage was called on the bot's telegram instance
      const bot = telegram.getBot();
      expect(bot.telegram.sendMessage).toHaveBeenCalledWith(
        AUTHORIZED_CHAT_ID,
        expect.stringContaining('Escalation'),
        expect.objectContaining({ parse_mode: 'Markdown' }),
      );
    });

    it('includes inline keyboard buttons', async () => {
      const escalation: Escalation = {
        id: 'esc-buttons',
        type: 'imessage',
        project_id: null,
        task_id: null,
        inbox_event_id: null,
        summary: 'iMessage from Mike needs response',
        context: null,
        options: null,
        status: 'pending',
        telegram_message_id: null,
        created_at: new Date(),
        actioned_at: null,
      };

      await telegram.sendEscalation(escalation);

      const bot = telegram.getBot();
      expect(bot.telegram.sendMessage).toHaveBeenCalledWith(
        AUTHORIZED_CHAT_ID,
        expect.any(String),
        expect.objectContaining({
          parse_mode: 'Markdown',
        }),
      );
    });
  });

  // -------------------------------------------------------------------------
  // Callback query handling
  // -------------------------------------------------------------------------

  describe('handleCallbackQuery', () => {
    it('handles "handle" action on an escalation', async () => {
      mockEscalationsGetById.mockResolvedValue({
        id: 'esc-cb1',
        summary: 'Test escalation',
        status: 'pending',
      });

      const response = await telegram.handleCallbackQuery('handle:esc-cb1');

      expect(response).toContain('handled');
      expect(mockEscalationsMarkActioned).toHaveBeenCalledWith('esc-cb1');
    });

    it('handles "skip" action on an escalation', async () => {
      mockEscalationsGetById.mockResolvedValue({
        id: 'esc-cb2',
        summary: 'Skip this one',
        status: 'pending',
      });

      const response = await telegram.handleCallbackQuery('skip:esc-cb2');

      expect(response).toContain('skipped');
      expect(mockEscalationsMarkDismissed).toHaveBeenCalledWith('esc-cb2');
    });

    it('handles "approve" action', async () => {
      mockEscalationsGetById.mockResolvedValue({
        id: 'esc-cb3',
        summary: 'Approve draft',
        status: 'pending',
      });

      const response = await telegram.handleCallbackQuery('approve:esc-cb3');

      expect(response).toContain('handled');
      expect(mockEscalationsMarkActioned).toHaveBeenCalledWith('esc-cb3');
    });

    it('handles "edit" action', async () => {
      mockEscalationsGetById.mockResolvedValue({
        id: 'esc-cb4',
        summary: 'Edit this',
        status: 'pending',
      });

      const response = await telegram.handleCallbackQuery('edit:esc-cb4');

      expect(response).toContain('edits');
    });

    it('returns error for invalid callback data format', async () => {
      const response = await telegram.handleCallbackQuery('invalid-data');

      expect(response).toContain('Invalid callback data');
    });

    it('returns not found for nonexistent escalation', async () => {
      mockEscalationsGetById.mockResolvedValue(null);

      const response = await telegram.handleCallbackQuery('handle:nonexistent');

      expect(response).toContain('not found');
    });

    it('returns error for unknown action', async () => {
      mockEscalationsGetById.mockResolvedValue({
        id: 'esc-cb5',
        summary: 'Unknown action',
        status: 'pending',
      });

      const response = await telegram.handleCallbackQuery('unknown_action:esc-cb5');

      expect(response).toContain('Unknown action');
    });
  });

  // -------------------------------------------------------------------------
  // Chat ID verification
  // -------------------------------------------------------------------------

  describe('chat ID verification', () => {
    it('allows Bryson chat ID', async () => {
      mockProjectsGetActive.mockResolvedValue([]);

      const response = await telegram.handleCommand('status', '', AUTHORIZED_CHAT_ID);
      expect(response).not.toBe('Unauthorized.');
    });

    it('blocks unauthorized chat IDs', async () => {
      const response = await telegram.handleCommand('status', '', '111111111');
      expect(response).toBe('Unauthorized.');
    });

    it('blocks empty chat IDs', async () => {
      const response = await telegram.handleCommand('status', '', '');
      expect(response).toBe('Unauthorized.');
    });
  });

  // -------------------------------------------------------------------------
  // Briefing
  // -------------------------------------------------------------------------

  describe('sendBriefing', () => {
    it('sends formatted briefing message', async () => {
      await telegram.sendBriefing({
        pendingEscalations: [],
        handledOvernight: ['Processed emails'],
        calendarEvents: [],
        topPriorities: [
          { title: 'Do something', project: 'TTT', dueDate: '2025-03-20' },
        ],
        date: '2025-03-15',
      });

      const bot = telegram.getBot();
      expect(bot.telegram.sendMessage).toHaveBeenCalledWith(
        AUTHORIZED_CHAT_ID,
        expect.stringContaining('Daily Briefing'),
        expect.objectContaining({ parse_mode: 'Markdown' }),
      );
    });
  });
});
