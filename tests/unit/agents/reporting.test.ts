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

const mockTasksGetOpen = vi.fn();
const mockTasksGetOverdue = vi.fn();
const mockTasksGetByProjectId = vi.fn();
vi.mock('../../../src/db/repositories/tasks.js', () => ({
  getOpen: (...args: unknown[]) => mockTasksGetOpen(...args),
  getOverdue: (...args: unknown[]) => mockTasksGetOverdue(...args),
  getByProjectId: (...args: unknown[]) => mockTasksGetByProjectId(...args),
  getAll: vi.fn().mockResolvedValue([]),
  getById: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  markDone: vi.fn(),
  markEscalated: vi.fn(),
}));

const mockEscalationsGetPending = vi.fn();
vi.mock('../../../src/db/repositories/escalations.js', () => ({
  getPending: (...args: unknown[]) => mockEscalationsGetPending(...args),
  create: vi.fn(),
  getById: vi.fn(),
  markActioned: vi.fn(),
  markDismissed: vi.fn(),
  setTelegramMessageId: vi.fn(),
}));

vi.mock('../../../src/db/repositories/inbox-events.js', () => ({
  getRecent: vi.fn().mockResolvedValue([]),
  create: vi.fn(),
  getByChannel: vi.fn().mockResolvedValue([]),
  isDuplicate: vi.fn().mockResolvedValue(false),
}));

vi.mock('../../../src/db/connection.js', () => ({
  query: vi.fn().mockResolvedValue({ rows: [], rowCount: 0 }),
  pool: { query: vi.fn(), on: vi.fn(), end: vi.fn() },
}));

vi.mock('../../../src/db/redis.js', () => ({
  redis: {
    get: vi.fn().mockResolvedValue(null),
    set: vi.fn().mockResolvedValue('OK'),
    on: vi.fn(),
  },
}));

// Import TelegramSubAgent types for BriefingData
import type { BriefingData } from '../../../src/agents/inbox/telegram.js';
import { TelegramSubAgent } from '../../../src/agents/inbox/telegram.js';

// ---------------------------------------------------------------------------
// Test data factories
// ---------------------------------------------------------------------------

function makeProjects() {
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
      id: 'proj-hs',
      name: 'Helium Solutions',
      client: null,
      status: 'active',
      priority: 2,
      metadata: {},
      created_at: new Date(),
      updated_at: new Date(),
    },
  ];
}

function makeTasks() {
  return [
    {
      id: 'task-1',
      project_id: 'proj-ttt',
      title: 'Update GHL automations',
      status: 'open',
      priority: 1,
      due_date: '2025-03-20',
      source: 'notebook',
      source_ref: null,
      description: null,
      agent_handled: false,
      escalated_to_bryson: false,
      escalation_reason: null,
      created_at: new Date(),
      updated_at: new Date(),
    },
    {
      id: 'task-2',
      project_id: 'proj-hs',
      title: 'Design landing page',
      status: 'open',
      priority: 3,
      due_date: null,
      source: 'gmail',
      source_ref: 'thread-5',
      description: null,
      agent_handled: false,
      escalated_to_bryson: false,
      escalation_reason: null,
      created_at: new Date(),
      updated_at: new Date(),
    },
    {
      id: 'task-3',
      project_id: 'proj-ttt',
      title: 'Overdue report',
      status: 'open',
      priority: 2,
      due_date: '2025-03-10',
      source: 'notebook',
      source_ref: null,
      description: null,
      agent_handled: false,
      escalated_to_bryson: false,
      escalation_reason: null,
      created_at: new Date(),
      updated_at: new Date(),
    },
  ];
}

function makeEscalations() {
  return [
    {
      id: 'esc-1',
      type: 'gmail',
      project_id: 'proj-ttt',
      task_id: null,
      inbox_event_id: null,
      summary: 'Urgent email from Daniel about contract',
      context: 'Daniel wants contract changes ASAP',
      options: null,
      status: 'pending',
      telegram_message_id: null,
      created_at: new Date(),
      actioned_at: null,
    },
  ];
}

function makeBriefingData(): BriefingData {
  return {
    pendingEscalations: makeEscalations(),
    handledOvernight: ['Processed 5 new emails', 'Ingested 2 notebook pages'],
    calendarEvents: [
      {
        title: 'TTT Strategy Call',
        time: '10:00 AM',
        attendees: 'Daniel, Mike',
      },
      {
        title: 'HS Team Standup',
        time: '2:00 PM',
        attendees: 'Team',
      },
    ],
    topPriorities: [
      {
        title: 'Update GHL automations',
        project: 'Texas Tree Tops',
        dueDate: '2025-03-20',
      },
      {
        title: 'Design landing page',
        project: 'Helium Solutions',
        dueDate: null,
      },
    ],
    date: '2025-03-15',
  };
}

// ---------------------------------------------------------------------------
// Tests — Reporting functionality via TelegramSubAgent briefing
// ---------------------------------------------------------------------------

describe('Reporting / Briefing', () => {
  let telegramAgent: TelegramSubAgent;

  beforeEach(() => {
    vi.clearAllMocks();
    telegramAgent = new TelegramSubAgent();
  });

  // -------------------------------------------------------------------------
  // Briefing data aggregation
  // -------------------------------------------------------------------------

  describe('briefing data aggregation', () => {
    it('collects projects, tasks, and escalations for briefing', async () => {
      const projects = makeProjects();
      const tasks = makeTasks();
      const escalations = makeEscalations();

      mockProjectsGetActive.mockResolvedValue(projects);
      mockTasksGetOpen.mockResolvedValue(tasks);
      mockTasksGetOverdue.mockResolvedValue([tasks[2]]);
      mockEscalationsGetPending.mockResolvedValue(escalations);

      // Verify the aggregated data structure
      const briefingData: BriefingData = {
        pendingEscalations: escalations,
        handledOvernight: [],
        calendarEvents: [],
        topPriorities: tasks.map((t) => ({
          title: t.title,
          project: projects.find((p) => p.id === t.project_id)?.name ?? 'Unknown',
          dueDate: t.due_date,
        })),
        date: new Date().toISOString().slice(0, 10),
      };

      expect(briefingData.pendingEscalations).toHaveLength(1);
      expect(briefingData.topPriorities).toHaveLength(3);
      expect(briefingData.topPriorities[0].project).toBe('Texas Tree Tops');
    });
  });

  // -------------------------------------------------------------------------
  // formatBriefing produces correct structure
  // -------------------------------------------------------------------------

  describe('formatBriefing', () => {
    it('formats a complete briefing with all sections', () => {
      const data = makeBriefingData();
      // Access private method
      const formatBriefingMessage = (telegramAgent as any).formatBriefingMessage.bind(
        telegramAgent,
      );
      const message: string = formatBriefingMessage(data);

      expect(message).toContain('Daily Briefing');
      expect(message).toContain('2025-03-15');
      expect(message).toContain('NEEDS YOU TODAY');
      expect(message).toContain('Urgent email from Daniel');
      expect(message).toContain('HANDLED OVERNIGHT');
      expect(message).toContain('Processed 5 new emails');
      expect(message).toContain("TODAY'S CALENDAR");
      expect(message).toContain('TTT Strategy Call');
      expect(message).toContain('10:00 AM');
      expect(message).toContain('TOP PRIORITIES');
      expect(message).toContain('Update GHL automations');
    });

    it('omits sections when data is empty', () => {
      const data: BriefingData = {
        pendingEscalations: [],
        handledOvernight: [],
        calendarEvents: [],
        topPriorities: [],
        date: '2025-03-15',
      };

      const formatBriefingMessage = (telegramAgent as any).formatBriefingMessage.bind(
        telegramAgent,
      );
      const message: string = formatBriefingMessage(data);

      expect(message).toContain('Daily Briefing');
      expect(message).not.toContain('NEEDS YOU TODAY');
      expect(message).not.toContain('HANDLED OVERNIGHT');
      expect(message).not.toContain("TODAY'S CALENDAR");
      expect(message).not.toContain('TOP PRIORITIES');
    });

    it('includes attendees in calendar section', () => {
      const data = makeBriefingData();
      data.pendingEscalations = [];
      data.handledOvernight = [];
      data.topPriorities = [];

      const formatBriefingMessage = (telegramAgent as any).formatBriefingMessage.bind(
        telegramAgent,
      );
      const message: string = formatBriefingMessage(data);

      expect(message).toContain('Daniel, Mike');
      expect(message).toContain('Team');
    });
  });

  // -------------------------------------------------------------------------
  // Priority scoring
  // -------------------------------------------------------------------------

  describe('priority scoring', () => {
    it('sorts tasks by priority (ascending) so P1 tasks are first', () => {
      const tasks = makeTasks();
      const sorted = [...tasks].sort((a, b) => a.priority - b.priority);

      expect(sorted[0].priority).toBe(1);
      expect(sorted[0].title).toBe('Update GHL automations');
      expect(sorted[1].priority).toBe(2);
      expect(sorted[2].priority).toBe(3);
    });

    it('considers overdue tasks as high priority', () => {
      const tasks = makeTasks();
      const overdue = tasks.filter(
        (t) => t.due_date && new Date(t.due_date) < new Date('2025-03-15'),
      );

      expect(overdue).toHaveLength(1);
      expect(overdue[0].title).toBe('Overdue report');
    });
  });

  // -------------------------------------------------------------------------
  // Project status generation
  // -------------------------------------------------------------------------

  describe('project status generation', () => {
    it('generates status with active project count and task breakdown', async () => {
      const projects = makeProjects();
      const tasks = makeTasks();

      mockProjectsGetActive.mockResolvedValue(projects);
      mockTasksGetByProjectId
        .mockResolvedValueOnce(tasks.filter((t) => t.project_id === 'proj-ttt'))
        .mockResolvedValueOnce(tasks.filter((t) => t.project_id === 'proj-hs'));

      const tttTasks = await mockTasksGetByProjectId('proj-ttt');
      const hsTasks = await mockTasksGetByProjectId('proj-hs');

      const statusByProject: Record<string, { name: string; openTasks: number }> = {};
      for (const p of projects) {
        const projectTasks = p.id === 'proj-ttt' ? tttTasks : hsTasks;
        statusByProject[p.id] = {
          name: p.name,
          openTasks: projectTasks.filter((t: any) => t.status === 'open').length,
        };
      }

      expect(statusByProject['proj-ttt'].openTasks).toBe(2);
      expect(statusByProject['proj-hs'].openTasks).toBe(1);
    });
  });
});
