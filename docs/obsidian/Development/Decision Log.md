---
title: Decision Log
aliases: [Decisions, Architecture Decisions, ADR]
tags: [development, decisions, architecture, reasoning]
created: 2026-03-31
---

# Decision Log

Every significant architectural decision in OpenClaw, with full reasoning. Reference these when questioning "why was it built this way?"

## Node.js over Python

**Decision:** Use Node.js 20+ with TypeScript as the runtime.

**Alternatives considered:** Python with FastAPI, Deno

**Reasoning:**
1. The Anthropic SDK, OpenAI SDK, and Telegraf (Telegram) all have mature, well-maintained Node.js/TypeScript libraries
2. The `googleapis` package provides unified access to Gmail, Calendar, and Drive APIs
3. Bryson's existing SWRE project is Node.js/TypeScript -- using the same stack reduces context-switching and allows code sharing
4. TypeScript provides compile-time type safety, and Zod provides runtime validation at boundaries
5. The async I/O model is ideal for a system that spends most of its time waiting on API responses
6. npm ecosystem has strong support for every integration needed (BullMQ, ioredis, pg, Fuse.js, tiktoken)

**Trade-off:** Python has better ML/NLP libraries, but OpenClaw delegates all ML tasks to external APIs (Claude, OpenAI embeddings), making this irrelevant.

---

## Claude as Primary LLM

**Decision:** Use Anthropic Claude as the primary LLM for all reasoning tasks.

**Alternatives considered:** OpenAI GPT-4, local models

**Reasoning:**
1. Claude excels at structured output generation -- critical for intent classification, task extraction, and draft composition
2. Superior instruction-following for complex multi-step agent decisions
3. Claude Vision for notebook ingestion is excellent at handwriting recognition
4. Anthropic's API is simple, well-documented, and reliable
5. Bryson already uses Claude Code for development, so the integration is natural

**OpenAI is used for:** Embeddings only (`text-embedding-3-small`). Best cost-to-quality ratio for semantic search vectors.

---

## Mixed Database Strategy

**Decision:** Use PostgreSQL + Qdrant + Redis as three separate databases.

**Alternatives considered:** PostgreSQL only (with pgvector), MongoDB + Qdrant, single-database approach

**Reasoning:**
1. **PostgreSQL for structured data** -- "Give me all overdue tasks for project TTT" is a relational query. Joins, aggregations, and transactional integrity belong in a relational database.
2. **Qdrant for vector search** -- "Find me notes similar to this query" is a vector similarity search. Purpose-built vector databases outperform bolted-on solutions.
3. **Redis for ephemeral state** -- Queues, caches, and deduplication need sub-millisecond access. Redis is the standard tool for this.

**Why not pgvector?** See below.

---

## Qdrant Over pgvector

**Decision:** Use Qdrant as a dedicated vector database instead of pgvector extension for PostgreSQL.

**Alternatives considered:** pgvector, Pinecone, Weaviate, Chroma

**Reasoning:**
1. **Separation of concerns** -- Vector workloads do not compete with relational query workloads. Under load, pgvector queries can degrade PostgreSQL performance.
2. **Payload filtering** -- Qdrant supports native metadata filtering during vector search (e.g., filter by project_id while searching semantically). pgvector requires separate WHERE clauses that don't integrate with the vector index.
3. **Scale** -- The SWRE Qdrant instance already has 822K+ vectors. pgvector performance degrades significantly at this scale without careful tuning.
4. **Existing infrastructure** -- SWRE already uses Qdrant, providing operational experience and the ability to cross-reference the SWRE knowledge base.
5. **Cost** -- Qdrant is open-source and runs in Docker. No managed service costs.

**Why not Pinecone?** Managed service with monthly costs. OpenClaw is a personal system -- self-hosted is more appropriate.

**Why not Chroma?** Less mature, fewer production deployments, weaker filtering capabilities.

---

## Orchestrator Pattern

**Decision:** Use a central Orchestrator agent that routes events to specialist agents.

**Alternatives considered:** Peer-to-peer agent communication, single monolithic agent

**Reasoning:**
1. **Decoupling** -- Specialist agents do not need to know about each other. Each has a focused responsibility.
2. **Project context centralization** -- The Orchestrator loads project context once and passes relevant slices to each agent, instead of every agent querying independently.
3. **Testability** -- Each specialist agent can be tested in isolation with mock project context.
4. **Extensibility** -- Adding a new agent means adding a routing rule to the Orchestrator, not modifying every existing agent.
5. **Working memory** -- The Orchestrator maintains session state that prevents duplicate processing in multi-step operations.

**Trade-off:** Single point of failure. Mitigated by keeping the Orchestrator stateless (Redis-backed working memory) and simple (routing logic, not business logic).

---

## Telegram Over Web App

**Decision:** Use Telegram as the sole user interface instead of building a web dashboard.

**Alternatives considered:** Custom web app, Slack bot, Discord bot, mobile app

**Reasoning:**
1. **Already on Bryson's phone** -- No new app to install or check
2. **Inline keyboards** -- One-tap approvals without typing, perfect for the escalation workflow
3. **Rich formatting** -- MarkdownV2 supports structured briefings
4. **Photo uploads** -- Native support for notebook photo ingestion
5. **Free** -- No API costs for sending messages
6. **Bot API maturity** -- Well-documented, stable, minimal breaking changes
7. **Single channel** -- All notifications in one place prevents fragmentation

**Why not Slack?** Bryson is a solo operator, not a team. Slack's multi-channel model adds complexity without value.

**Why not a web app?** Building and maintaining a web frontend doubles the development effort for a single user. The time is better spent on agent capabilities.

---

## n8n as Bridge Layer

**Decision:** Use n8n for GHL integration and Gmail polling instead of direct API integration.

**Alternatives considered:** Direct API calls from OpenClaw, Zapier, Make.com

**Reasoning:**
1. **GHL sub-account routing** -- Each client has different GHL credentials. n8n manages credential routing visually.
2. **Visual debugging** -- Complex webhook transformations are easier to debug in n8n's visual editor than in code.
3. **Non-developer maintenance** -- Bryson can adjust workflows without touching code.
4. **Isolation** -- If GHL's API changes, only n8n workflows need updating.
5. **Self-hosted** -- Free, runs in Docker, no monthly SaaS costs.

**Why not Zapier/Make?** Monthly subscription costs for a personal system. n8n is open-source and self-hosted.

---

## GHL Through n8n

**Decision:** Route all GoHighLevel operations through n8n rather than direct API calls.

**Reasoning:**
1. GHL's API is sub-account scoped -- credential routing is needed per client
2. n8n provides built-in rate limiting and retry logic
3. GHL webhook payloads require transformation before OpenClaw can process them
4. Isolates GHL API changes from the OpenClaw codebase
5. Visual debugging for complex CRM workflows

See [[GoHighLevel Integration]] and [[n8n Workflows]] for implementation details.

---

## Redis for Ephemeral State

**Decision:** Use Redis for queues, caches, and deduplication rather than PostgreSQL or in-memory storage.

**Alternatives considered:** PostgreSQL advisory locks + LISTEN/NOTIFY, in-memory Maps

**Reasoning:**
1. **BullMQ** -- The chosen job queue library requires Redis as its backend
2. **Sub-millisecond reads** -- Deduplication checks on every webhook need to be fast
3. **TTL support** -- Native key expiration for caches and rate limits
4. **List operations** -- Native LPUSH/RPOP for simple queues
5. **Persistence** -- Redis with AOF provides queue recovery after restarts (Docker volume)
6. **Standard tool** -- Well-understood, well-documented, battle-tested

**Why not in-memory?** Would lose all queued work on application restart. Unacceptable for an autonomous system.

---

## Feature Flags for Write Operations

**Decision:** Gate all external write operations behind feature flags that default to `false`.

**Reasoning:**
1. **Incremental trust** -- Enable writes only after the system has proven reliable in read-only mode
2. **Safety** -- Prevents accidental email sends, iMessage replies, or CRM updates during development
3. **Compliance** -- FDCPA/TCPA regulations require explicit controls on automated communications
4. **Rollback** -- Can instantly disable writes without code deployment

See [[Security]] for compliance details.

## Related Pages

- [[System Overview]] for the architecture these decisions shaped
- [[Tech Stack]] for the resulting technology choices
- [[Build Phases]] for how the build order reflects dependencies
- [[Security]] for compliance-related decisions
