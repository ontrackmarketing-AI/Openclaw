---
title: Build Phases
aliases: [Build Sequence, Phases, Implementation Plan]
tags: [development, build, phases, roadmap]
created: 2026-03-31
---

# Build Phases

OpenClaw is built in 8 sequential phases, each adding a layer of capability. Phases are ordered by dependency -- each phase builds on the foundation laid by previous phases.

## Phase Overview

| Phase | Name | Status | Dependencies |
|---|---|---|---|
| 1 | Foundation | In Progress | None |
| 2 | Ingestion Pipeline | Not Started | Phase 1 |
| 3 | Inbox Agent (Gmail) | Not Started | Phase 1 |
| 4 | Inbox Agent (iMessage + Telegram) | Not Started | Phase 1, Phase 3 |
| 5 | Research Agent | Not Started | Phase 1, Phase 2 |
| 6 | Scheduler Agent | Not Started | Phase 1 |
| 7 | Reporting Agent | Not Started | Phases 1-6 |
| 8 | Polish & Integration | Not Started | All phases |

## Phase 1: Foundation

**Goal:** Core infrastructure, database, configuration, base agent framework, Telegram bot shell.

### Deliverables

- [x] Project structure (`src/` directory layout)
- [x] TypeScript configuration (`tsconfig.json`)
- [x] Package dependencies (`package.json`)
- [x] Docker Compose for PostgreSQL, Redis, Qdrant
- [x] Environment variable validation (Zod schema in `src/config/index.ts`)
- [x] Winston logger (`src/config/logger.ts`)
- [x] PostgreSQL connection pool (`src/db/connection.ts`)
- [x] PostgreSQL schema (`src/db/schema.sql`)
- [x] Redis client (`src/db/redis.ts`)
- [x] Qdrant client with collection initialization (`src/db/qdrant.ts`)
- [x] Project repository (`src/db/repositories/projects.ts`)
- [x] Task repository (`src/db/repositories/tasks.ts`)
- [ ] Express HTTP server with health endpoint
- [ ] Telegram bot basic setup (Telegraf)
- [ ] Base agent class / framework
- [ ] Orchestrator skeleton (event routing)
- [ ] BullMQ queue setup

### Key Files

- `src/config/index.ts` -- Configuration and env validation
- `src/config/logger.ts` -- Winston logger setup
- `src/db/connection.ts` -- PostgreSQL pool
- `src/db/redis.ts` -- Redis client
- `src/db/qdrant.ts` -- Qdrant client and collections
- `src/db/schema.sql` -- Full database schema
- `src/db/repositories/projects.ts` -- Project CRUD
- `src/db/repositories/tasks.ts` -- Task CRUD

### Links

- [[PostgreSQL]] for schema documentation
- [[Redis]] for client setup
- [[Qdrant]] for collection initialization
- [[Tech Stack]] for dependency choices

---

## Phase 2: Ingestion Pipeline

**Goal:** Notebook photo to structured data pipeline.

### Deliverables

- [ ] Claude Vision integration for text extraction
- [ ] Structuring pass (Zod-validated output)
- [ ] Fuse.js fuzzy project matching
- [ ] Text chunking (512 tokens, 50 overlap, tiktoken)
- [ ] OpenAI embedding generation
- [ ] Qdrant upsert to `bryson_notes`
- [ ] PostgreSQL write to `notes` and `tasks` tables
- [ ] Telegram photo upload handler
- [ ] Google Drive watched folder polling
- [ ] BullMQ ingestion worker
- [ ] Telegram confirmation message

### Links

- [[Ingestion Agent]] for full pipeline documentation
- [[Qdrant]] for `bryson_notes` collection schema
- [[Google Drive Integration]] for watched folder

---

## Phase 3: Inbox Agent (Gmail)

**Goal:** Gmail monitoring, triage, draft composition.

### Deliverables

- [ ] Google OAuth2 setup and token management
- [ ] Gmail thread fetching via API
- [ ] n8n `openclaw-gmail-fetch` workflow
- [ ] Sender identification (contact lookup)
- [ ] Intent classification (Claude)
- [ ] VIP detection
- [ ] Draft composition (Claude)
- [ ] Gmail draft creation via API
- [ ] Draft approval flow (Telegram inline keyboard)
- [ ] Task extraction from emails
- [ ] Email summary embedding to Qdrant `bryson_emails`
- [ ] Webhook deduplication (Redis)
- [ ] Gmail rate limit tracking (Redis)

### Links

- [[Inbox Agent]] for full agent documentation
- [[Gmail Integration]] for API and OAuth2 details
- [[n8n Workflows]] for the fetch workflow
- [[Contacts]] for sender identification

---

## Phase 4: Inbox Agent (iMessage + Telegram)

**Goal:** Complete inbox coverage with iMessage and Telegram sub-agents.

### Deliverables

- [ ] iMessage bridge client (HTTP calls to Mac bridge)
- [ ] iMessage message polling
- [ ] iMessage sender resolution (phone/handle)
- [ ] Telegram message handler (non-command messages)
- [ ] Telegram sub-agent intent classification
- [ ] Cross-channel contact unification
- [ ] Feature flag gating (`ENABLE_IMESSAGE`)

### Dependencies

- Phase 1 (Foundation)
- Phase 3 (Gmail sub-agent patterns are reused)

### Links

- [[iMessage Bridge]] for Mac bridge architecture
- [[Telegram Bot]] for message handling
- [[Contacts]] for cross-channel resolution

---

## Phase 5: Research Agent

**Goal:** Multi-source information gathering and synthesis.

### Deliverables

- [ ] Tavily web search integration
- [ ] Google Drive document retrieval
- [ ] Qdrant multi-collection search
- [ ] SWRE Qdrant read-only access (via Tailscale)
- [ ] Claude synthesis of gathered sources
- [ ] Research output storage (Qdrant `bryson_research`)
- [ ] `/research` Telegram command handler
- [ ] Orchestrator-triggered research (pre-meeting)

### Dependencies

- Phase 1 (Foundation)
- Phase 2 (Qdrant collections and embedding pipeline)

### Links

- [[Research Agent]] for full documentation
- [[Qdrant]] for collection schemas
- [[Google Drive Integration]] for document search

---

## Phase 6: Scheduler Agent

**Goal:** Calendar integration, pre-briefs, conflict detection.

### Deliverables

- [ ] Google Calendar API integration
- [ ] Event fetching (cron + on-demand)
- [ ] Attendee contact lookup
- [ ] Pre-brief generation (15 min before meeting)
- [ ] Conflict detection (overlaps, back-to-back, overloaded days)
- [ ] Time block suggestions
- [ ] Calendar data feed to Reporting Agent

### Dependencies

- Phase 1 (Foundation)

### Links

- [[Scheduler Agent]] for full documentation
- [[Google Calendar Integration]] for API details
- [[Contacts]] for attendee matching

---

## Phase 7: Reporting Agent

**Goal:** Daily briefing and on-demand reports.

### Deliverables

- [ ] Daily briefing cron job (8:00 AM CST)
- [ ] Data aggregation from all agents and databases
- [ ] Priority scoring algorithm
- [ ] Briefing template formatting (Telegram MarkdownV2)
- [ ] `/brief` command handler
- [ ] `/status` system health report
- [ ] `/tasks` full task list

### Dependencies

- All previous phases (the Reporting Agent aggregates from everything)

### Links

- [[Reporting Agent]] for briefing template and scoring algorithm
- [[Telegram Bot]] for delivery

---

## Phase 8: Polish & Integration

**Goal:** Error handling, monitoring, performance optimization, end-to-end testing.

### Deliverables

- [ ] Global error handling and recovery
- [ ] Comprehensive logging across all agents
- [ ] Performance monitoring (slow query detection, API latency)
- [ ] End-to-end integration tests
- [ ] n8n workflow setup and testing
- [ ] GoHighLevel integration via n8n
- [ ] Escalation expiration and retry logic
- [ ] Quiet mode implementation
- [ ] Notification batching logic
- [ ] Documentation review

### Dependencies

- All previous phases

### Links

- [[GoHighLevel Integration]] for CRM setup
- [[n8n Workflows]] for automation workflows
- [[Notification Logic]] for batching implementation
- [[Escalation System]] for expiration logic
- [[Testing Strategy]] for test approach

## Related Pages

- [[Decision Log]] for why things are built in this order
- [[Tech Stack]] for technology dependencies
- [[System Overview]] for the full architecture
