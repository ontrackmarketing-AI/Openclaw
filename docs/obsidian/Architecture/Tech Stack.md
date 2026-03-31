---
title: Tech Stack
aliases: [Technology Stack, Stack]
tags: [architecture, tech-stack, dependencies]
created: 2026-03-31
---

# Tech Stack

Every technology in OpenClaw was chosen for a specific reason. This page documents what is used, why it was chosen, and where it fits in the [[System Overview]].

## Runtime & Language

| Technology | Version | Purpose |
|---|---|---|
| Node.js | 20+ | Server runtime. Async I/O is ideal for an event-driven multi-agent system that spends most time waiting on API calls. |
| TypeScript | 5.7+ | Type safety across the entire codebase. Zod for runtime validation at boundaries. ES modules throughout. |
| tsx | 4.19+ | Development runner with watch mode (`npm run dev`). |

**Why Node.js over Python?** See [[Decision Log#Node.js over Python]]. The ecosystem for Google APIs, Telegram (Telegraf), and the Anthropic SDK is mature in Node. Bryson's existing SWRE codebase is also Node/TypeScript, reducing context-switching.

## AI Providers

| Provider | SDK | Purpose |
|---|---|---|
| Anthropic Claude | `@anthropic-ai/sdk` ^0.39 | Primary LLM for all agent reasoning, vision (notebook ingestion), draft composition, and intent classification. |
| OpenAI | `openai` ^4.82 | Embeddings (`text-embedding-3-small`, 1536 dimensions) and fallback for non-critical tasks. |
| Tavily | `tavily` via API key | Web search for the [[Research Agent]]. Structured search results without scraping. |

**Why Claude as primary?** See [[Decision Log#Claude as Primary LLM]]. Superior reasoning for complex triage decisions and better instruction-following for structured output.

**Why OpenAI for embeddings?** `text-embedding-3-small` offers the best cost-to-quality ratio for semantic search. It runs independently of the reasoning LLM.

## Databases

| Database | Version | Purpose | See Also |
|---|---|---|---|
| PostgreSQL | 16 (Alpine) | Structured relational data: tasks, contacts, projects, notes metadata, audit logs. Source of truth. | [[PostgreSQL]] |
| Qdrant | Latest | Vector/semantic search: note content, email summaries, research. "Find by meaning." | [[Qdrant]] |
| Redis | 7 (Alpine) | Ephemeral state: BullMQ job queues, rate limiting, caches, webhook deduplication. | [[Redis]] |

**Why not just Qdrant?** See [[Decision Log#Mixed Database Strategy]]. Qdrant excels at "find me things similar to X" but fails at "give me all overdue tasks for project TTT." Relational queries belong in Postgres. Vector search belongs in Qdrant.

## Web Framework & HTTP

| Technology | Version | Purpose |
|---|---|---|
| Express | 4.21 | HTTP API server for webhooks, health checks, and the REST API. See [[API Reference]]. |
| Helmet | 8.0 | HTTP security headers. |
| CORS | 2.8 | Cross-origin configuration for API access. |

## Messaging & Bot

| Technology | Version | Purpose |
|---|---|---|
| Telegraf | 4.16 | Telegram Bot framework. Handles commands, inline keyboards, photo uploads, webhook mode. See [[Telegram Bot]]. |

## Google Workspace

| Technology | Version | Purpose |
|---|---|---|
| googleapis | 144.0 | Unified client for Gmail API, Google Calendar API, and Google Drive API. OAuth2 authentication. |

Used by:
- [[Gmail Integration]] -- Thread fetching, draft composition
- [[Google Calendar Integration]] -- Event reading, attendee lookup
- [[Google Drive Integration]] -- Document retrieval, watched folders

## Job Processing

| Technology | Version | Purpose |
|---|---|---|
| BullMQ | 5.34 | Background job queue built on [[Redis]]. Handles ingestion pipeline, email processing, research tasks. Retry logic, rate limiting, job prioritization. |
| node-cron | 3.0 | Cron scheduling for periodic tasks (daily briefing, Gmail polling fallback, calendar sync). |

## Data Processing

| Technology | Version | Purpose |
|---|---|---|
| Fuse.js | 7.0 | Fuzzy string matching. Used by [[Ingestion Agent]] to match handwritten project references to known project names. |
| tiktoken | 1.0 | Token counting for chunking text before embedding. Ensures chunks stay within the 512-token window. |
| Zod | 3.24 | Runtime schema validation. Validates all environment variables, API inputs, and LLM structured outputs. |

## Infrastructure

| Technology | Purpose |
|---|---|
| Docker Compose | Local development and production orchestration. See `docker-compose.yml`. |
| AWS EC2 | Production hosting. See [[Deployment]]. |
| Tailscale | Secure networking between EC2 instance, Mac mini (iMessage), and SWRE Qdrant. See [[Security]]. |

## Utilities

| Technology | Version | Purpose |
|---|---|---|
| Winston | 3.17 | Structured logging with levels, timestamps, and JSON output in production. |
| uuid | 11.1 | UUID v4 generation for database primary keys. |
| dotenv | 16.4 | Environment variable loading from `.env` files. |

## Dev Dependencies

| Technology | Version | Purpose |
|---|---|---|
| Vitest | 3.0 | Test runner. Fast, TypeScript-native, watch mode. See [[Testing Strategy]]. |
| ESLint | 9.19 | Code linting. |
| Prettier | 3.4 | Code formatting. |

## Package Manifest

Full dependency list lives in `package.json` at the project root.

## Related Pages

- [[System Overview]] for how these fit together
- [[Decision Log]] for why each was chosen
- [[Deployment]] for infrastructure details
- [[Environment Variables]] for configuration
