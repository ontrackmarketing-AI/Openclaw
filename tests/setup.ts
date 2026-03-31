import { vi } from 'vitest';

// ---------------------------------------------------------------------------
// Environment variables — set BEFORE any application module loads config
// ---------------------------------------------------------------------------
process.env.NODE_ENV = 'test';
process.env.PORT = '3999';
process.env.APP_SECRET = 'test-secret-token';
process.env.DATABASE_URL = 'postgresql://test:test@localhost:5432/openclaw_test';
process.env.REDIS_URL = 'redis://localhost:6379/1';
process.env.QDRANT_URL = 'http://localhost:6333';
process.env.TELEGRAM_BOT_TOKEN = 'test-bot-token-123456';
process.env.TELEGRAM_WEBHOOK_SECRET = 'test-webhook-secret';
process.env.TELEGRAM_BRYSON_CHAT_ID = '123456789';
process.env.ANTHROPIC_API_KEY = 'sk-ant-test-key';
process.env.OPENAI_API_KEY = 'sk-openai-test-key';
process.env.GOOGLE_CLIENT_ID = 'test-google-client-id';
process.env.GOOGLE_CLIENT_SECRET = 'test-google-client-secret';
process.env.GOOGLE_REDIRECT_URI = 'http://localhost:3999/auth/callback';
process.env.GOOGLE_REFRESH_TOKEN = 'test-google-refresh-token';
process.env.IMESSAGE_BRIDGE_URL = 'http://localhost:3001';
process.env.IMESSAGE_BRIDGE_SECRET = 'test-imessage-secret';
process.env.ENABLE_IMESSAGE = 'false';
process.env.ENABLE_GMAIL_SEND = 'false';
process.env.ENABLE_GHL_WRITE = 'false';

// ---------------------------------------------------------------------------
// Mock: pg (PostgreSQL)
// ---------------------------------------------------------------------------
vi.mock('pg', () => {
  const mockQuery = vi.fn().mockResolvedValue({ rows: [], rowCount: 0 });
  const mockPool = {
    query: mockQuery,
    connect: vi.fn().mockResolvedValue({
      query: mockQuery,
      release: vi.fn(),
    }),
    end: vi.fn().mockResolvedValue(undefined),
    on: vi.fn(),
  };
  return {
    default: { Pool: vi.fn(() => mockPool) },
    Pool: vi.fn(() => mockPool),
  };
});

// ---------------------------------------------------------------------------
// Mock: ioredis
// ---------------------------------------------------------------------------
vi.mock('ioredis', () => {
  const RedisMock = vi.fn().mockImplementation(() => ({
    get: vi.fn().mockResolvedValue(null),
    set: vi.fn().mockResolvedValue('OK'),
    del: vi.fn().mockResolvedValue(1),
    incr: vi.fn().mockResolvedValue(1),
    expire: vi.fn().mockResolvedValue(1),
    rpush: vi.fn().mockResolvedValue(1),
    lpop: vi.fn().mockResolvedValue(null),
    llen: vi.fn().mockResolvedValue(0),
    quit: vi.fn().mockResolvedValue('OK'),
    on: vi.fn(),
    status: 'ready',
  }));
  return { default: RedisMock };
});

// ---------------------------------------------------------------------------
// Mock: @qdrant/js-client-rest
// ---------------------------------------------------------------------------
vi.mock('@qdrant/js-client-rest', () => {
  return {
    QdrantClient: vi.fn().mockImplementation(() => ({
      upsert: vi.fn().mockResolvedValue({}),
      search: vi.fn().mockResolvedValue([]),
      getCollections: vi.fn().mockResolvedValue({ collections: [] }),
      createCollection: vi.fn().mockResolvedValue({}),
      delete: vi.fn().mockResolvedValue({}),
    })),
  };
});

// ---------------------------------------------------------------------------
// Mock: @anthropic-ai/sdk
// ---------------------------------------------------------------------------
vi.mock('@anthropic-ai/sdk', () => {
  const createFn = vi.fn().mockResolvedValue({
    content: [{ type: 'text', text: '{}' }],
  });
  return {
    default: vi.fn().mockImplementation(() => ({
      messages: { create: createFn },
    })),
  };
});

// ---------------------------------------------------------------------------
// Mock: openai
// ---------------------------------------------------------------------------
vi.mock('openai', () => {
  return {
    default: vi.fn().mockImplementation(() => ({
      embeddings: {
        create: vi.fn().mockResolvedValue({
          data: [{ embedding: new Array(1536).fill(0.1), index: 0 }],
        }),
      },
    })),
  };
});

// ---------------------------------------------------------------------------
// Mock: googleapis
// ---------------------------------------------------------------------------
vi.mock('googleapis', () => {
  return {
    google: {
      auth: {
        OAuth2: vi.fn().mockImplementation(() => ({
          setCredentials: vi.fn(),
          getAccessToken: vi.fn().mockResolvedValue({ token: 'test-token' }),
        })),
      },
      gmail: vi.fn().mockReturnValue({
        users: {
          threads: {
            list: vi.fn().mockResolvedValue({ data: { threads: [] } }),
            get: vi.fn().mockResolvedValue({ data: { messages: [] } }),
          },
          messages: {
            send: vi.fn().mockResolvedValue({ data: { id: 'msg-1' } }),
          },
        },
      }),
      calendar: vi.fn().mockReturnValue({
        events: {
          list: vi.fn().mockResolvedValue({ data: { items: [] } }),
        },
      }),
    },
  };
});

// ---------------------------------------------------------------------------
// Mock: telegraf
// ---------------------------------------------------------------------------
vi.mock('telegraf', () => {
  const mockTelegram = {
    sendMessage: vi.fn().mockResolvedValue({ message_id: 42 }),
    setWebhook: vi.fn().mockResolvedValue(true),
    deleteWebhook: vi.fn().mockResolvedValue(true),
    getFileLink: vi.fn().mockResolvedValue(new URL('https://example.com/file.jpg')),
  };
  const TelegrafMock = vi.fn().mockImplementation(() => ({
    telegram: mockTelegram,
    command: vi.fn(),
    on: vi.fn(),
    catch: vi.fn(),
    launch: vi.fn().mockResolvedValue(undefined),
    stop: vi.fn(),
    webhookCallback: vi.fn().mockReturnValue(vi.fn()),
  }));
  return {
    Telegraf: TelegrafMock,
    Markup: {
      inlineKeyboard: vi.fn().mockReturnValue({ reply_markup: {} }),
      button: {
        callback: vi.fn().mockImplementation((text, data) => ({ text, callback_data: data })),
      },
    },
  };
});

// ---------------------------------------------------------------------------
// Mock: winston logger
// ---------------------------------------------------------------------------
vi.mock('../src/config/logger.js', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    child: vi.fn().mockReturnValue({
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    }),
  },
}));

// ---------------------------------------------------------------------------
// Mock: agent-logs repo (used by BaseAgent)
// ---------------------------------------------------------------------------
vi.mock('../src/db/repositories/agent-logs.js', () => ({
  log: vi.fn().mockResolvedValue({
    id: 'log-1',
    agent: 'test',
    event: 'test_event',
    project_id: null,
    metadata: {},
    created_at: new Date(),
  }),
  getByAgent: vi.fn().mockResolvedValue([]),
  getRecent: vi.fn().mockResolvedValue([]),
}));
