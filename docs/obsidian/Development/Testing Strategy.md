---
title: Testing Strategy
aliases: [Testing, Tests, QA]
tags: [development, testing, vitest, quality]
created: 2026-03-31
---

# Testing Strategy

OpenClaw uses Vitest as its test runner. This page documents how to test each component, mocking strategies for external APIs, and the testing pyramid.

## Test Runner

- **Framework:** Vitest 3.0
- **Config:** Default Vitest configuration (auto-discovers `*.test.ts` files)
- **Commands:**
  - `npm test` -- Run all tests once
  - `npm run test:watch` -- Watch mode for development

## Testing Pyramid

```
        ┌───────────┐
        │   E2E     │  Few: full pipeline tests
        │  Tests    │  (ingestion, inbox flow)
        ├───────────┤
        │Integration│  Some: database queries,
        │  Tests    │  API endpoints, Redis ops
        ├───────────┤
        │   Unit    │  Many: agent logic, scoring,
        │  Tests    │  fuzzy matching, formatting
        └───────────┘
```

## Unit Testing

### Agent Logic

Each agent's core logic should be testable without external dependencies.

**[[Orchestrator]]:**
- Event routing: given an event type, verify it routes to the correct agent
- Project context matching: given an event, verify the correct project is matched
- Deduplication: verify duplicate events are rejected

**[[Ingestion Agent]]:**
- Structuring pass: given Claude Vision output (mocked), verify correct parsing into tasks/notes/decisions/questions
- Fuzzy matching: given a list of projects and a handwritten reference, verify Fuse.js matches correctly
- Chunking: given a text string, verify correct 512-token chunks with 50-token overlap

```typescript
describe('fuzzyProjectMatch', () => {
  const projects = [
    { name: 'SWRE' },
    { name: 'Texas Tree Tops' },
    { name: 'OnTrack Marketing' },
  ];

  it('matches exact abbreviation', () => {
    expect(matchProject('TTT', projects)).toBe('Texas Tree Tops');
  });

  it('matches fuzzy input', () => {
    expect(matchProject('on track', projects)).toBe('OnTrack Marketing');
  });

  it('returns null for no match', () => {
    expect(matchProject('xyz unknown', projects)).toBeNull();
  });
});
```

**[[Inbox Agent]]:**
- Intent classification: given mocked Claude output, verify routing logic
- VIP detection: given a contact with `is_vip = true`, verify Tier 4 escalation
- Draft generation: verify draft format includes required context

**[[Reporting Agent]]:**
- Priority scoring: verify the scoring algorithm produces correct order
- Briefing formatting: verify the template renders correctly with sample data

**[[Scheduler Agent]]:**
- Conflict detection: given overlapping events, verify conflict is flagged
- Pre-brief timing: verify pre-brief sends 15 minutes before event

### Utility Functions

- Zod schema validation for all input types
- Redis key pattern generation
- MarkdownV2 escaping for Telegram
- Token counting with tiktoken

## Integration Testing

### Database Tests

Test actual database queries against a test PostgreSQL instance.

```typescript
describe('projects repository', () => {
  beforeAll(async () => {
    // Run migrations on test database
    await migrate(testPool);
  });

  afterEach(async () => {
    // Clean up test data
    await testPool.query('DELETE FROM projects');
  });

  it('creates and retrieves a project', async () => {
    const project = await create({ name: 'Test Project' });
    const found = await getById(project.id);
    expect(found?.name).toBe('Test Project');
  });

  it('filters active projects', async () => {
    await create({ name: 'Active', status: 'active' });
    await create({ name: 'Archived', status: 'archived' });
    const active = await getActive();
    expect(active).toHaveLength(1);
  });
});
```

### Redis Tests

Test Redis operations against a test Redis instance.

```typescript
describe('webhook deduplication', () => {
  it('allows first message through', async () => {
    const isNew = await checkDedup('gmail', 'msg_123');
    expect(isNew).toBe(true);
  });

  it('blocks duplicate message', async () => {
    await checkDedup('gmail', 'msg_123');
    const isNew = await checkDedup('gmail', 'msg_123');
    expect(isNew).toBe(false);
  });
});
```

### Qdrant Tests

Test vector operations against a test Qdrant instance.

```typescript
describe('qdrant collections', () => {
  it('initializes all collections', async () => {
    await initCollections();
    const collections = await qdrant.getCollections();
    expect(collections.collections.map(c => c.name))
      .toContain('bryson_notes');
  });
});
```

### API Endpoint Tests

Test Express routes with supertest.

```typescript
describe('health endpoint', () => {
  it('returns 200 when healthy', async () => {
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
  });
});
```

## Mocking External APIs

### Anthropic Claude

Mock the Anthropic SDK to return predetermined responses:

```typescript
vi.mock('@anthropic-ai/sdk', () => ({
  default: vi.fn().mockImplementation(() => ({
    messages: {
      create: vi.fn().mockResolvedValue({
        content: [{ type: 'text', text: JSON.stringify(mockResponse) }],
      }),
    },
  })),
}));
```

### OpenAI Embeddings

```typescript
vi.mock('openai', () => ({
  default: vi.fn().mockImplementation(() => ({
    embeddings: {
      create: vi.fn().mockResolvedValue({
        data: [{ embedding: new Array(1536).fill(0.1) }],
      }),
    },
  })),
}));
```

### Gmail API

```typescript
const mockGmail = {
  users: {
    threads: {
      list: vi.fn().mockResolvedValue({ data: { threads: [] } }),
      get: vi.fn().mockResolvedValue({ data: mockThread }),
    },
    drafts: {
      create: vi.fn().mockResolvedValue({ data: { id: 'draft_123' } }),
    },
  },
};
```

### Telegram (Telegraf)

```typescript
const mockCtx = {
  chat: { id: 12345 },
  message: { text: '/brief' },
  reply: vi.fn(),
  replyWithMarkdownV2: vi.fn(),
};
```

## End-to-End Tests

Full pipeline tests that verify data flows from input to output:

### Ingestion Pipeline E2E

1. Mock Claude Vision response with known notebook content
2. Process through ingestion pipeline
3. Verify notes and tasks in PostgreSQL
4. Verify vectors in Qdrant
5. Verify Telegram confirmation message

### Inbox Pipeline E2E

1. Mock Gmail thread with known content
2. Process through Inbox Agent
3. Verify contact lookup occurred
4. Verify intent classification
5. Verify draft creation (if applicable)
6. Verify inbox_events record in PostgreSQL

## Test Environment

### Environment Variables

Tests use `NODE_ENV=test` which:
- Skips production-required variable checks
- Uses test database connection strings
- Disables external API calls (relies on mocks)

### Docker Services

Integration tests require running Docker services:

```bash
# Start test infrastructure
docker-compose up -d postgres redis qdrant

# Run tests
npm test
```

### Test Database

Tests should use a separate database (e.g., `openclaw_test`) to avoid polluting development data.

## Coverage Goals

| Layer | Target Coverage |
|---|---|
| Agent logic (unit) | 80%+ |
| Repositories (integration) | 90%+ |
| API endpoints (integration) | 80%+ |
| Full pipelines (E2E) | Key flows only |

## Related Pages

- [[Build Phases]] for when each test is implemented
- [[Tech Stack]] for Vitest details
- [[Orchestrator]] for routing tests
- [[Ingestion Agent]] for ingestion pipeline tests
- [[Inbox Agent]] for inbox pipeline tests
- [[Reporting Agent]] for scoring algorithm tests
