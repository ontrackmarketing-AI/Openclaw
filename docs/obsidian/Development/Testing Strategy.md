---
title: Testing Strategy
aliases: [Testing, Tests, Test Plan]
tags: [development, testing, vitest, quality]
created: 2026-03-31
---

# Testing Strategy

OpenClaw uses Vitest for all testing. Tests are organized by agent and component, with a focus on unit tests for agent logic and integration tests for end-to-end flows.

## Test Runner

| Tool | Version | Configuration |
|---|---|---|
| Vitest | 3.0+ | TypeScript-native, ESM support, watch mode |

### Commands

| Command | Description |
|---|---|
| `npm test` | Run all tests once (`vitest run`) |
| `npm run test:watch` | Run tests in watch mode (`vitest`) |

### Configuration

Vitest is configured in `vitest.config.ts` or the `test` section of `package.json`:

```typescript
// vitest.config.ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.test.ts', 'tests/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
    },
    testTimeout: 30000, // 30s for API call tests
  },
});
```

## Test Categories

### Unit Tests

Test individual functions and modules in isolation. External dependencies (databases, APIs) are mocked.

| Component | What to Test | Location |
|---|---|---|
| Config validation | Zod schema accepts valid env, rejects invalid | `src/config/__tests__/` |
| Repositories | CRUD operations, query builders | `src/db/repositories/__tests__/` |
| Ingestion structuring | Claude response parsing, Zod validation | `src/agents/ingestion/__tests__/` |
| Fuzzy matching | Fuse.js project matching accuracy | `src/agents/ingestion/__tests__/` |
| Intent classification | Correct intent for different message types | `src/agents/inbox/__tests__/` |
| VIP detection | VIP contacts trigger correct tier | `src/agents/inbox/__tests__/` |
| Priority scoring | Score calculation for different factors | `src/agents/reporting/__tests__/` |
| MarkdownV2 escaping | Special characters escaped correctly | `src/telegram/__tests__/` |
| Auth middleware | Valid/invalid tokens, skip paths | `src/server/middleware/__tests__/` |

### Integration Tests

Test flows that span multiple components, using real Docker services.

| Flow | Services Required | What to Test |
|---|---|---|
| Ingestion pipeline | PostgreSQL, Qdrant, Redis | Photo in, notes + tasks + vectors out |
| Inbox triage | PostgreSQL, Redis | Message in, intent classified, stored correctly |
| Escalation lifecycle | PostgreSQL, Redis | Create, queue, deliver, action, update |
| Research flow | PostgreSQL, Qdrant | Query in, multi-source search, synthesis out |
| Briefing generation | PostgreSQL | Query all tables, format output |
| API endpoints | PostgreSQL | Request/response for all routes |

### End-to-End Tests

Test the complete system from external input to Telegram output. These require all services and potentially mocked external APIs.

| Scenario | Description |
|---|---|
| Photo to briefing | Upload photo, verify tasks appear in next briefing |
| VIP email to escalation | Simulate Gmail thread from VIP, verify Telegram escalation |
| Calendar conflict | Simulate overlapping events, verify conflict escalation |
| Full briefing cycle | Populate test data, trigger briefing, verify all sections |

## Mocking External APIs

External APIs should never be called in tests. Each service has a mock:

### Claude (Anthropic)

```typescript
// Mock the Anthropic SDK
vi.mock('@anthropic-ai/sdk', () => ({
  default: class MockAnthropic {
    messages = {
      create: vi.fn().mockResolvedValue({
        content: [{
          type: 'text',
          text: JSON.stringify({
            tasks: [{ title: 'Test task', project_ref: 'SWRE' }],
            notes: [{ content: 'Test note' }],
            decisions: [],
            questions: [],
          }),
        }],
      }),
    };
  },
}));
```

### Gmail API

```typescript
// Mock googleapis Gmail client
vi.mock('googleapis', () => ({
  google: {
    auth: {
      OAuth2: vi.fn().mockReturnValue({
        setCredentials: vi.fn(),
        on: vi.fn(),
      }),
    },
    gmail: vi.fn().mockReturnValue({
      users: {
        threads: {
          list: vi.fn().mockResolvedValue({ data: { threads: [] } }),
          get: vi.fn().mockResolvedValue({ data: { messages: [] } }),
        },
        drafts: {
          create: vi.fn().mockResolvedValue({ data: { id: 'draft_123' } }),
        },
      },
    }),
  },
}));
```

### Telegram (Telegraf)

```typescript
// Mock Telegraf context for command tests
function createMockContext(overrides = {}) {
  return {
    chat: { id: 12345 },
    message: { text: '/brief' },
    reply: vi.fn().mockResolvedValue({ message_id: 1 }),
    answerCbQuery: vi.fn().mockResolvedValue(true),
    editMessageReplyMarkup: vi.fn().mockResolvedValue(true),
    telegram: {
      getFileLink: vi.fn().mockResolvedValue(new URL('https://example.com/photo.jpg')),
      sendMessage: vi.fn().mockResolvedValue({ message_id: 2 }),
    },
    ...overrides,
  };
}
```

### iMessage Bridge

```typescript
// Mock HTTP calls to the bridge
vi.mock('node-fetch', () => ({
  default: vi.fn().mockResolvedValue({
    ok: true,
    json: () => Promise.resolve({
      messages: [
        { id: 'msg_1', sender: '+15551234567', text: 'Test message', timestamp: '2026-03-31T10:00:00Z' },
      ],
    }),
  }),
}));
```

### OpenAI Embeddings

```typescript
// Mock OpenAI embedding generation
vi.mock('openai', () => ({
  default: class MockOpenAI {
    embeddings = {
      create: vi.fn().mockResolvedValue({
        data: [{ embedding: new Array(1536).fill(0.01) }],
      }),
    };
  },
}));
```

## Test Data Seeding

The seed script (`npm run db:seed`) populates the database with realistic test data:

### Projects

All 8 projects from [[Project Registry]] are seeded with correct priorities, clients, and metadata.

### Contacts

VIP contacts (Mike, Daniel, Steven, Hunter, Raymond, Bren) are seeded with `is_vip = true` and realistic channel identifiers.

### Tasks

Sample tasks across projects with varying statuses, priorities, and due dates (including some overdue).

### Notes

Sample ingested notebook entries with structured JSON.

### Inbox Events

Sample messages from different channels with different intents.

### Escalations

A few pending escalations for testing the escalation UI.

## Docker Test Environment

Integration tests use the same Docker Compose services as development:

```bash
# Start test databases
docker compose up -d

# Run tests
npm test

# Run with coverage
npx vitest run --coverage
```

For CI environments, tests can use `docker compose` to spin up services before running:

```bash
docker compose up -d --wait
npm run db:migrate
npm run db:seed
npm test
docker compose down
```

## Test File Naming Convention

| Pattern | Type |
|---|---|
| `*.test.ts` | Unit or integration test |
| `*.spec.ts` | Alternative (both patterns supported) |

Tests are co-located with source files or in `__tests__/` subdirectories.

## Coverage Targets

| Component | Target | Rationale |
|---|---|---|
| Config/validation | 95%+ | Critical path, must not fail |
| Repositories | 80%+ | Database operations are straightforward |
| Agent logic | 70%+ | Agent reasoning depends on LLM output, which is mocked |
| API routes | 80%+ | Request/response validation |
| Telegram bot | 60%+ | UI layer, harder to test comprehensively |

## Related Pages

- [[Build Phases]] for when tests are written
- [[Tech Stack]] for Vitest details
- [[API Reference]] for endpoint testing
- [[Ingestion Agent]] for ingestion pipeline tests
- [[Inbox Agent]] for triage logic tests
