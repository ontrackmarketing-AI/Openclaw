---
title: Build Phases
aliases: [Phases, Build Sequence, Implementation Plan]
tags: [development, phases, build, planning, milestones]
created: 2026-03-31
---

# Build Phases

OpenClaw is built in 8 sequential phases, each delivering a testable increment of functionality. Phases are ordered by dependency -- each phase builds on the previous one. From PRD Section 14.

## Phase Overview

| Phase | Name | Dependencies | Est. Duration |
|---|---|---|---|
| 1 | Foundation & Data Layer | None | 1-2 weeks |
| 2 | Ingestion Pipeline | Phase 1 | 1-2 weeks |
| 3 | Inbox Triage | Phase 1 | 1-2 weeks |
| 4 | Orchestrator & Escalations | Phases 1-3 | 1-2 weeks |
| 5 | Research & Calendar | Phases 1, 4 | 1-2 weeks |
| 6 | Reporting & Briefings | Phases 1-5 | 1 week |
| 7 | External Integrations | Phases 1-6 | 1-2 weeks |
| 8 | Polish & Hardening | Phases 1-7 | 1-2 weeks |

---

## Phase 1: Foundation & Data Layer

**Goal:** Working infrastructure, database schemas, configuration system, and basic server.

### Steps

1. Set up project scaffold (TypeScript, ESM, tsconfig, ESLint, Prettier)
2. Configure Docker Compose for [[PostgreSQL]], [[Redis]], [[Qdrant]]
3. Implement `src/config/index.ts` with Zod environment validation
4. Implement `src/db/connection.ts` with PostgreSQL connection pooling
5. Implement `src/db/redis.ts` with Redis client and connection handling
6. Implement `src/db/qdrant.ts` with Qdrant client and collection initialization
7. Create `src/db/schema.sql` with all tables (projects, tasks, notes, contacts, inbox_events, escalations, agent_logs)
8. Implement migration runner (`npm run db:migrate`)
9. Implement seed script with initial projects and contacts (`npm run db:seed`)
10. Create repository layer for each table (CRUD operations)
11. Set up Express server with health check, auth middleware, and basic routes
12. Set up Winston logging
13. Write unit tests for config validation, repository operations

### Acceptance Criteria

- [ ] `docker compose up -d` starts all three databases
- [ ] `npm run db:migrate` creates all tables
- [ ] `npm run db:seed` populates projects and contacts
- [ ] `GET /health` returns `200 OK`
- [ ] API routes respond with correct data from database
- [ ] All environment variables are validated at startup
- [ ] Unit tests pass (`npm test`)

### Status Format

```
Phase 1: [IN PROGRESS / COMPLETE]
  [x] Step 1 - Project scaffold
  [x] Step 2 - Docker Compose
  ...
```

---

## Phase 2: Ingestion Pipeline

**Goal:** Bryson can send a notebook photo via Telegram and see structured output.

### Steps

1. Implement [[Telegram Bot]] with Telegraf (polling mode for dev)
2. Implement photo upload handler (save image, queue to Redis)
3. Implement BullMQ ingestion worker
4. Implement Claude Vision extraction (structured prompt, Zod validation)
5. Implement Fuse.js fuzzy project matching
6. Implement PostgreSQL write (notes + tasks tables)
7. Implement text chunking (512 tokens, 50 overlap, tiktoken)
8. Implement OpenAI embedding generation
9. Implement Qdrant upsert to `bryson_notes` collection
10. Implement Telegram confirmation message
11. Implement ambiguity detection and clarification flow
12. Write integration tests for the full pipeline

### Dependencies

- Phase 1 (databases, repositories, Telegram bot token)

### Acceptance Criteria

- [ ] Send photo to bot, receive confirmation with task count
- [ ] Notes and tasks appear in PostgreSQL
- [ ] Chunks appear in Qdrant `bryson_notes`
- [ ] Ambiguous items prompt clarification via inline keyboard
- [ ] Pipeline handles errors gracefully (bad image, API failure)

---

## Phase 3: Inbox Triage

**Goal:** Gmail and iMessage messages are triaged, classified, and stored.

### Steps

1. Implement [[Gmail Integration]] OAuth2 client
2. Implement Gmail thread fetching (list + get)
3. Implement [[iMessage Bridge]] client (HTTP calls to Mac bridge)
4. Implement Telegram message handler for direct messages
5. Implement deduplication via Redis `webhook:dedup:{channel}:{id}`
6. Implement sender identification (contact lookup across channels)
7. Implement Claude intent classification (fyi, needs_reply, needs_action, time_sensitive)
8. Implement VIP detection
9. Implement draft composition (Claude + Gmail drafts API)
10. Implement task extraction from messages
11. Implement `inbox_events` storage
12. Implement email thread embedding to Qdrant `bryson_emails`
13. Write tests for each sub-agent

### Dependencies

- Phase 1 (databases, contacts table)
- Gmail OAuth credentials
- Optional: iMessage Bridge running on Mac mini

### Acceptance Criteria

- [ ] Gmail threads are fetched, classified, and stored
- [ ] VIP messages trigger immediate escalation
- [ ] Draft replies are created in Gmail
- [ ] Deduplication prevents double-processing
- [ ] Contact lookup works across all channels

---

## Phase 4: Orchestrator & Escalations

**Goal:** Central brain routes events, manages context, and delivers escalations.

### Steps

1. Implement [[Orchestrator]] event routing (source identification, agent dispatch)
2. Implement project context loading (PostgreSQL + Redis cache)
3. Implement project context matching (event to project)
4. Implement working memory (session tracking in Redis)
5. Implement [[Escalation System]] creation (PostgreSQL + Redis queue)
6. Implement escalation deduplication
7. Implement Telegram escalation delivery with inline keyboards
8. Implement callback query handling (approve, edit, handle, dismiss)
9. Implement escalation lifecycle (pending, actioned, expired, dismissed)
10. Implement cron scheduling (node-cron for periodic tasks)
11. Write integration tests for routing and escalation flow

### Dependencies

- Phases 1-3 (all agents must exist to be routed to)

### Acceptance Criteria

- [ ] Events are correctly routed to the right agent
- [ ] Project context is loaded and cached
- [ ] Escalations appear in Telegram with working inline keyboards
- [ ] Callback actions update escalation status
- [ ] Cron jobs fire on schedule

---

## Phase 5: Research & Calendar

**Goal:** Research Agent gathers information; Scheduler Agent provides calendar context.

### Steps

1. Implement [[Research Agent]] Tavily web search
2. Implement Google Drive document search and retrieval
3. Implement multi-collection Qdrant semantic search
4. Implement SWRE Qdrant read-only access (via Tailscale)
5. Implement Claude synthesis (combine sources into structured summary)
6. Implement research storage (Qdrant `bryson_research` + agent_logs)
7. Implement `/research` Telegram command
8. Implement [[Google Calendar Integration]] event fetching
9. Implement pre-brief generation (15 min before meetings)
10. Implement conflict detection (overlapping, back-to-back, overloaded)
11. Implement calendar data feed to Reporting Agent
12. Write tests for research and scheduling flows

### Dependencies

- Phases 1, 4 (Orchestrator for routing)
- Google OAuth credentials
- Optional: Tailscale connection to SWRE

### Acceptance Criteria

- [ ] `/research Texas Tree Tops competitors` returns a structured summary
- [ ] Pre-briefs arrive 15 minutes before meetings
- [ ] Calendar conflicts trigger escalations
- [ ] SWRE Qdrant is accessible read-only

---

## Phase 6: Reporting & Briefings

**Goal:** Daily briefing is generated and delivered automatically.

### Steps

1. Implement [[Reporting Agent]] data aggregation (all PostgreSQL queries)
2. Implement priority scoring algorithm
3. Implement briefing template formatting (MarkdownV2)
4. Implement `/brief` Telegram command
5. Implement cron-triggered morning briefing (8:00 AM CST)
6. Implement `/status` system health command
7. Implement `/tasks` full task list command
8. Implement `sendBriefingDirect()` for cron delivery
9. Write tests for briefing generation

### Dependencies

- Phases 1-5 (all agents feeding data)

### Acceptance Criteria

- [ ] `/brief` returns a well-formatted briefing with all sections
- [ ] Morning briefing arrives at 8:00 AM CST automatically
- [ ] `/status` shows database connectivity and queue counts
- [ ] Priority scoring correctly ranks items

---

## Phase 7: External Integrations

**Goal:** n8n workflows and GoHighLevel integration are live.

### Steps

1. Set up n8n instance (self-hosted Docker)
2. Create `openclaw-gmail-fetch` workflow
3. Create `openclaw-ghl-inbound` workflow
4. Create `openclaw-ghl-task-create` workflow
5. Create `openclaw-ghl-contact-note` workflow
6. Implement GHL webhook handler with signature verification
7. Implement n8n webhook handler
8. Implement GHL feature flag (`ENABLE_GHL_WRITE`)
9. Test end-to-end GHL contact sync
10. Test Gmail polling via n8n (replace or complement direct polling)

### Dependencies

- Phases 1-6 (full system running)
- GHL API credentials
- n8n instance

### Acceptance Criteria

- [ ] Gmail polling works through n8n
- [ ] GHL events arrive and are logged
- [ ] With `ENABLE_GHL_WRITE=true`, contacts sync to GHL
- [ ] n8n workflows retry on failure

---

## Phase 8: Polish & Hardening

**Goal:** Production-ready system with monitoring, error handling, and documentation.

### Steps

1. Implement Telegram webhook mode (replace polling)
2. Add comprehensive error handling to all agents
3. Implement rate limiting for Gmail API
4. Implement agent log retention (90-day cleanup)
5. Implement [[Notification Logic]] follow-up reminders
6. Add monitoring via `/status` and health checks
7. Production Docker configuration (multi-stage build)
8. Set up systemd service for production
9. Document all [[Environment Variables]]
10. Run full end-to-end test suite
11. Deploy to AWS EC2
12. Configure Tailscale between EC2, Mac mini, and SWRE
13. Final security audit (secrets, access, feature flags)

### Dependencies

- All previous phases

### Acceptance Criteria

- [ ] System runs stably in production for 48+ hours
- [ ] All feature flags tested in both states
- [ ] Error recovery works (agent failure does not crash system)
- [ ] Daily briefing has been delivered successfully for 3+ consecutive days
- [ ] All documentation is complete and accurate

## Related Pages

- [[System Overview]] for architecture context
- [[Tech Stack]] for technology choices
- [[Decision Log]] for architectural reasoning
- [[Testing Strategy]] for how to test each phase
- [[Deployment]] for production setup
