import { describe, it, expect, vi, beforeEach } from 'vitest';
import Anthropic from '@anthropic-ai/sdk';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockFindByAnyHandle = vi.fn();
vi.mock('../../../src/db/repositories/contacts.js', () => ({
  findByAnyHandle: (...args: unknown[]) => mockFindByAnyHandle(...args),
  getAll: vi.fn().mockResolvedValue([]),
  getById: vi.fn(),
  getByEmail: vi.fn(),
  getByPhone: vi.fn(),
  getVIPs: vi.fn().mockResolvedValue([]),
  create: vi.fn(),
  update: vi.fn(),
}));

const mockInboxCreate = vi.fn().mockResolvedValue({
  id: 'inbox-1',
  channel: 'gmail',
  external_id: 'thread-1',
  sender: 'test@example.com',
  contact_id: null,
  project_id: null,
  subject: 'Test',
  body_summary: 'Test summary',
  intent: 'fyi',
  agent_action: 'logged',
  escalated: false,
  processed_at: new Date(),
});
const mockIsDuplicate = vi.fn().mockResolvedValue(false);
vi.mock('../../../src/db/repositories/inbox-events.js', () => ({
  create: (...args: unknown[]) => mockInboxCreate(...args),
  isDuplicate: (...args: unknown[]) => mockIsDuplicate(...args),
  getByChannel: vi.fn().mockResolvedValue([]),
  getRecent: vi.fn().mockResolvedValue([]),
}));

const mockTasksCreate = vi.fn().mockResolvedValue({
  id: 'task-1',
  title: 'Follow up with client',
  status: 'open',
  priority: 2,
  project_id: null,
  source: 'gmail',
  source_ref: 'thread-1',
  description: null,
  due_date: null,
  agent_handled: false,
  escalated_to_bryson: false,
  escalation_reason: null,
  created_at: new Date(),
  updated_at: new Date(),
});
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

vi.mock('../../../src/db/connection.js', () => ({
  query: vi.fn().mockResolvedValue({ rows: [], rowCount: 0 }),
  pool: { query: vi.fn(), on: vi.fn(), end: vi.fn() },
}));

vi.mock('../../../src/db/redis.js', () => ({
  redis: {
    get: vi.fn().mockResolvedValue(null),
    set: vi.fn().mockResolvedValue('OK'),
    incr: vi.fn().mockResolvedValue(1),
    expire: vi.fn().mockResolvedValue(1),
    on: vi.fn(),
  },
}));

import { GmailSubAgent, type GmailThread } from '../../../src/agents/inbox/gmail.js';

// ---------------------------------------------------------------------------
// Test data
// ---------------------------------------------------------------------------

function makeThread(overrides: Partial<GmailThread> = {}): GmailThread {
  return {
    id: 'thread-001',
    subject: 'Q3 Campaign Proposal for Texas Tree Tops',
    sender: 'Daniel <daniel@swre.com>',
    senderEmail: 'daniel@swre.com',
    snippet: 'Hi Bryson, attached is the Q3 campaign proposal...',
    receivedAt: '2025-03-15T10:00:00Z',
    messages: [
      {
        id: 'msg-001',
        from: 'Daniel <daniel@swre.com>',
        to: 'bryson@heliumsolutions.com',
        date: '2025-03-15T10:00:00Z',
        body: 'Hi Bryson,\n\nAttached is the Q3 campaign proposal for Texas Tree Tops. Can you review and send me your feedback by Friday?\n\nThanks,\nDaniel',
      },
    ],
    ...overrides,
  };
}

function makeVipContact() {
  return {
    id: 'contact-daniel',
    name: 'Daniel',
    email: 'daniel@swre.com',
    phone: null,
    imessage_handle: null,
    telegram_username: null,
    type: 'client',
    project_ids: ['proj-swre'],
    is_vip: true,
    last_contact: null,
    notes: null,
    created_at: new Date(),
  };
}

function makeNonVipContact() {
  return {
    id: 'contact-vendor',
    name: 'Random Vendor',
    email: 'vendor@example.com',
    phone: null,
    imessage_handle: null,
    telegram_username: null,
    type: 'vendor',
    project_ids: null,
    is_vip: false,
    last_contact: null,
    notes: null,
    created_at: new Date(),
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('GmailSubAgent', () => {
  let gmail: GmailSubAgent;
  let anthropicCreate: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    gmail = new GmailSubAgent();

    const anthropicInstance = (Anthropic as unknown as ReturnType<typeof vi.fn>).mock
      .results.at(-1)?.value;
    anthropicCreate = anthropicInstance?.messages?.create;
  });

  // -------------------------------------------------------------------------
  // summarizeThread
  // -------------------------------------------------------------------------

  describe('summarizeThread', () => {
    it('returns a summary string from Claude', async () => {
      anthropicCreate.mockResolvedValueOnce({
        content: [
          {
            type: 'text',
            text: 'Daniel from SWRE sent a Q3 campaign proposal for TTT and wants feedback by Friday.',
          },
        ],
      });

      const summary = await gmail.summarizeThread(makeThread());

      expect(summary).toContain('Daniel');
      expect(summary).toContain('Q3');
      expect(anthropicCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          model: 'claude-sonnet-4-20250514',
          max_tokens: 1024,
        }),
      );
    });

    it('returns fallback message when Claude returns no text block', async () => {
      anthropicCreate.mockResolvedValueOnce({
        content: [{ type: 'tool_use', id: 't1', name: 'test', input: {} }],
      });

      const summary = await gmail.summarizeThread(makeThread());
      expect(summary).toBe('Unable to summarise thread.');
    });
  });

  // -------------------------------------------------------------------------
  // classifyIntent
  // -------------------------------------------------------------------------

  describe('classifyIntent', () => {
    it('returns "urgent" for VIP senders regardless of content', async () => {
      mockFindByAnyHandle.mockResolvedValueOnce(makeVipContact());

      const intent = await gmail.classifyIntent(
        'Just a quick heads up about next week.',
        'daniel@swre.com',
      );

      expect(intent).toBe('urgent');
      // Claude should NOT be called — VIP shortcircuits
      expect(anthropicCreate).not.toHaveBeenCalled();
    });

    it('classifies "fyi" for informational emails from non-VIP', async () => {
      mockFindByAnyHandle.mockResolvedValueOnce(makeNonVipContact());
      anthropicCreate.mockResolvedValueOnce({
        content: [{ type: 'text', text: 'fyi' }],
      });

      const intent = await gmail.classifyIntent(
        'Monthly newsletter update.',
        'vendor@example.com',
      );

      expect(intent).toBe('fyi');
    });

    it('classifies "reply_needed" correctly', async () => {
      mockFindByAnyHandle.mockResolvedValueOnce(null);
      anthropicCreate.mockResolvedValueOnce({
        content: [{ type: 'text', text: 'reply_needed' }],
      });

      const intent = await gmail.classifyIntent(
        'Client asked about pricing and is waiting for a response.',
        'unknown@example.com',
      );

      expect(intent).toBe('reply_needed');
    });

    it('classifies "action_needed" correctly', async () => {
      mockFindByAnyHandle.mockResolvedValueOnce(null);
      anthropicCreate.mockResolvedValueOnce({
        content: [{ type: 'text', text: 'action_needed' }],
      });

      const intent = await gmail.classifyIntent(
        'Please sign the contract and return it.',
        'legal@partner.com',
      );

      expect(intent).toBe('action_needed');
    });

    it('defaults to "fyi" for unrecognized labels', async () => {
      mockFindByAnyHandle.mockResolvedValueOnce(null);
      anthropicCreate.mockResolvedValueOnce({
        content: [{ type: 'text', text: 'maybe_important' }],
      });

      const intent = await gmail.classifyIntent(
        'Some email summary.',
        'someone@example.com',
      );

      expect(intent).toBe('fyi');
    });
  });

  // -------------------------------------------------------------------------
  // VIP detection
  // -------------------------------------------------------------------------

  describe('VIP detection', () => {
    it('detects VIP contacts by email handle', async () => {
      const vip = makeVipContact();
      mockFindByAnyHandle.mockResolvedValueOnce(vip);

      const intent = await gmail.classifyIntent(
        'Just saying hi.',
        'daniel@swre.com',
      );

      expect(intent).toBe('urgent');
      expect(mockFindByAnyHandle).toHaveBeenCalledWith('daniel@swre.com');
    });

    it('does not treat non-VIP contacts as urgent', async () => {
      mockFindByAnyHandle.mockResolvedValueOnce(makeNonVipContact());
      anthropicCreate.mockResolvedValueOnce({
        content: [{ type: 'text', text: 'fyi' }],
      });

      const intent = await gmail.classifyIntent(
        'Newsletter update.',
        'vendor@example.com',
      );

      expect(intent).toBe('fyi');
    });

    it('handles unknown contacts (null) gracefully', async () => {
      mockFindByAnyHandle.mockResolvedValueOnce(null);
      anthropicCreate.mockResolvedValueOnce({
        content: [{ type: 'text', text: 'reply_needed' }],
      });

      const intent = await gmail.classifyIntent(
        'Can we schedule a call?',
        'stranger@example.com',
      );

      expect(intent).toBe('reply_needed');
    });
  });

  // -------------------------------------------------------------------------
  // draftReply
  // -------------------------------------------------------------------------

  describe('draftReply', () => {
    it('composes a reply draft from Claude', async () => {
      const draftText =
        'Hi Daniel,\n\nThanks for sending over the Q3 proposal. I\'ll review it and get back to you by Friday.\n\nBest,\nBryson';
      anthropicCreate.mockResolvedValueOnce({
        content: [{ type: 'text', text: draftText }],
      });

      const draft = await gmail.draftReply(makeThread());

      expect(draft).toContain('Bryson');
      expect(draft).toContain('Friday');
    });

    it('includes project context when provided', async () => {
      anthropicCreate.mockResolvedValueOnce({
        content: [{ type: 'text', text: 'Draft reply with context.' }],
      });

      await gmail.draftReply(makeThread(), 'TTT is our top priority client.');

      expect(anthropicCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          system: expect.stringContaining('TTT is our top priority client'),
        }),
      );
    });

    it('returns fallback when Claude returns no text', async () => {
      anthropicCreate.mockResolvedValueOnce({
        content: [],
      });

      const draft = await gmail.draftReply(makeThread());
      expect(draft).toBe('Unable to draft reply.');
    });
  });

  // -------------------------------------------------------------------------
  // extractActionItems
  // -------------------------------------------------------------------------

  describe('extractActionItems', () => {
    it('extracts and creates tasks from email content', async () => {
      const actionItems = [
        { title: 'Review Q3 campaign proposal', priority: 2 },
        { title: 'Send feedback to Daniel by Friday', priority: 1 },
      ];

      anthropicCreate.mockResolvedValueOnce({
        content: [{ type: 'text', text: JSON.stringify(actionItems) }],
      });

      const tasks = await gmail.extractActionItems(makeThread(), 'proj-ttt');

      expect(mockTasksCreate).toHaveBeenCalledTimes(2);
      expect(mockTasksCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          title: 'Review Q3 campaign proposal',
          priority: 2,
          source: 'gmail',
          source_ref: 'thread-001',
          project_id: 'proj-ttt',
        }),
      );
    });

    it('returns empty array when no action items found', async () => {
      anthropicCreate.mockResolvedValueOnce({
        content: [{ type: 'text', text: '[]' }],
      });

      const tasks = await gmail.extractActionItems(makeThread());

      expect(tasks).toHaveLength(0);
      expect(mockTasksCreate).not.toHaveBeenCalled();
    });

    it('handles malformed JSON gracefully', async () => {
      anthropicCreate.mockResolvedValueOnce({
        content: [{ type: 'text', text: 'not json at all' }],
      });

      const tasks = await gmail.extractActionItems(makeThread());

      expect(tasks).toHaveLength(0);
    });

    it('strips markdown fences from action items response', async () => {
      const items = [{ title: 'Do something', priority: 3 }];
      anthropicCreate.mockResolvedValueOnce({
        content: [{ type: 'text', text: '```json\n' + JSON.stringify(items) + '\n```' }],
      });

      const tasks = await gmail.extractActionItems(makeThread());
      expect(mockTasksCreate).toHaveBeenCalledTimes(1);
    });
  });

  // -------------------------------------------------------------------------
  // processThread (full pipeline)
  // -------------------------------------------------------------------------

  describe('processThread', () => {
    it('processes a full thread: summarize, classify, store', async () => {
      // summarizeThread call
      anthropicCreate.mockResolvedValueOnce({
        content: [{ type: 'text', text: 'Daniel sent Q3 campaign proposal, wants feedback by Friday.' }],
      });
      // classifyIntent call
      mockFindByAnyHandle.mockResolvedValueOnce(null);
      anthropicCreate.mockResolvedValueOnce({
        content: [{ type: 'text', text: 'reply_needed' }],
      });
      // findByAnyHandle for processThread's own contact lookup
      mockFindByAnyHandle.mockResolvedValueOnce(null);

      const result = await gmail.processThread(makeThread());

      expect(result.summary).toContain('Daniel');
      expect(result.intent).toBe('reply_needed');
      expect(result.contact).toBeNull();
      expect(mockInboxCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          channel: 'gmail',
          external_id: 'thread-001',
          intent: 'reply_needed',
        }),
      );
    });

    it('extracts action items for urgent threads', async () => {
      // summarize
      anthropicCreate.mockResolvedValueOnce({
        content: [{ type: 'text', text: 'Urgent request from VIP.' }],
      });
      // classifyIntent - VIP shortcircuit
      mockFindByAnyHandle.mockResolvedValueOnce(makeVipContact());
      // extractActionItems
      anthropicCreate.mockResolvedValueOnce({
        content: [
          { type: 'text', text: JSON.stringify([{ title: 'Respond to Daniel', priority: 1 }]) },
        ],
      });
      // processThread's contact lookup
      mockFindByAnyHandle.mockResolvedValueOnce(makeVipContact());

      const result = await gmail.processThread(makeThread());

      expect(result.intent).toBe('urgent');
      expect(result.actionItems).toHaveLength(1);
    });
  });
});
