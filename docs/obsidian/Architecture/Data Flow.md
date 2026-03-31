---
title: Data Flow
aliases: [Data Flow Diagram, Flow]
tags: [architecture, data-flow, diagrams]
created: 2026-03-31
---

# Data Flow

This page documents how data moves through the OpenClaw system from input sources through agents to databases and outputs. See [[System Overview]] for the high-level architecture.

## High-Level Flow

```
INPUT SOURCES                PROCESSING                    STORAGE + OUTPUT
─────────────               ──────────                    ────────────────
                         ┌──────────────┐
  Telegram photo ──────→ │  Ingestion   │──→ PostgreSQL (notes, tasks)
  Drive folder   ──────→ │  Agent       │──→ Qdrant (bryson_notes)
                         └──────────────┘──→ Telegram confirmation
                                │
                         ┌──────────────┐
  Gmail threads  ──────→ │              │──→ PostgreSQL (inbox_events, tasks)
  iMessage msgs  ──────→ │  Inbox Agent │──→ Qdrant (bryson_emails)
  Telegram cmds  ──────→ │              │──→ Gmail drafts / Telegram reply
                         └──────────────┘──→ Escalation queue
                                │
                         ┌──────────────┐
  Google Drive   ──────→ │  Research    │──→ Qdrant (bryson_research)
  Web (Tavily)   ──────→ │  Agent       │──→ PostgreSQL (agent_logs)
  Qdrant (SWRE)  ──────→ │              │──→ Telegram summary
                         └──────────────┘
                                │
                         ┌──────────────┐
  Google Calendar ─────→ │  Scheduler   │──→ Telegram pre-briefs
                         │  Agent       │──→ PostgreSQL (agent_logs)
                         └──────────────┘
                                │
                         ┌──────────────┐
  All agent output ────→ │  Reporting   │──→ Telegram daily briefing
  PostgreSQL       ────→ │  Agent       │
  Qdrant           ────→ │              │
                         └──────────────┘
                                │
                    ┌───────────────────────┐
                    │     ORCHESTRATOR      │
                    │  Routes all events    │
                    │  Loads project context │
                    │  Manages escalations  │
                    └───────────────────────┘
```

## Notebook Ingestion Flow

The most complex pipeline. See [[Ingestion Agent]] for full details.

```
Bryson takes photo of notebook page
        │
        ▼
Upload via Telegram OR drop into Google Drive watched folder
        │
        ▼
Image queued in Redis (queue:ingestion)
        │
        ▼
BullMQ worker picks up job
        │
        ▼
Claude Vision API: extract all text, identify structure
  Prompt: "Extract all handwritten text. Identify tasks, decisions,
           questions, and project references."
        │
        ▼
Structuring pass: parse into { project, tasks[], notes[], decisions[], questions[] }
        │
        ▼
Project matching via Fuse.js: fuzzy-match references to known projects
  e.g., "TTT" → "Texas Tree Tops", "SWRE" → "SWRE"
        │
        ▼
Ambiguity check: flag unclear items → queue for Bryson clarification
        │
        ▼
Write to PostgreSQL:
  - notes table: raw_text, structured JSON, image_path, project_id
  - tasks table: one row per extracted task, linked to project
        │
        ▼
Chunk text (512 tokens, 50 token overlap via tiktoken)
        │
        ▼
Embed chunks via OpenAI text-embedding-3-small (1536 dims)
        │
        ▼
Upsert vectors to Qdrant collection: bryson_notes
  Payload: { project_id, source: "notebook", chunk_index, raw_text, created_at }
        │
        ▼
Telegram confirmation to Bryson:
  "Ingested 3 pages. Found 7 tasks across SWRE, TTT, and OnTrack.
   2 items need clarification — [list]."
```

## Inbox Processing Flow

See [[Inbox Agent]] for sub-agent details.

```
New message arrives (Gmail / iMessage / Telegram)
        │
        ▼
Deduplication check: Redis webhook:dedup:{channel}:{message_id}
  If exists → skip (already processed)
  If new → SET with TTL 24h
        │
        ▼
Orchestrator routes to Inbox Agent with project context
        │
        ▼
Sender lookup: query contacts table
  ├── Known contact → load project associations, VIP status
  └── Unknown sender → log as new, classify from content
        │
        ▼
Intent classification (Claude):
  ├── FYI → log to inbox_events, skip notification
  ├── needs_reply → draft response, queue for approval
  ├── needs_action → extract task, create in tasks table
  └── time_sensitive → immediate escalation
        │
        ▼
VIP check: is sender in VIP list?
  ├── YES → always escalate immediately regardless of intent
  └── NO → follow normal routing
        │
        ▼
Store in PostgreSQL: inbox_events table
  (channel, external_id, sender, contact_id, project_id, intent, agent_action)
        │
        ▼
Summarize thread → embed → Qdrant (bryson_emails)
        │
        ▼
Output routing:
  ├── Draft approval → Telegram inline keyboard
  ├── Task created → log only (included in daily briefing)
  └── Escalation → Telegram with full context + options
```

## Research Flow

See [[Research Agent]] for details.

```
Research triggered by:
  ├── Orchestrator (pre-meeting research, project context)
  ├── Telegram command (/research <query>)
  └── Scheduled task
        │
        ▼
Gather sources in parallel:
  ├── Qdrant semantic search (bryson_notes, bryson_projects)
  ├── Qdrant SWRE search (read-only, via Tailscale)
  ├── Google Drive document retrieval
  └── Tavily web search
        │
        ▼
Claude synthesis: combine all sources into structured summary
        │
        ▼
Store in Qdrant (bryson_research) for future retrieval
        │
        ▼
Log to PostgreSQL (agent_logs)
        │
        ▼
Return to requester:
  ├── If Orchestrator → feed into next agent action
  ├── If Telegram → send summary message
  └── If scheduled → include in daily briefing
```

## Daily Briefing Flow

See [[Reporting Agent]] for the full template.

```
Cron trigger at 8:00 AM CST
        │
        ▼
Query PostgreSQL:
  ├── Open tasks (by priority, by project)
  ├── Overdue tasks
  ├── Pending escalations
  ├── Inbox events from last 24h
  ├── Agent logs from last 24h
  └── Today's calendar events (via Scheduler Agent)
        │
        ▼
Query Qdrant:
  └── Recent research summaries
        │
        ▼
Priority scoring algorithm:
  score = base_priority × recency_weight × vip_multiplier × deadline_urgency
        │
        ▼
Claude synthesis: format into briefing template
        │
        ▼
Send via Telegram:
  Structured message with sections, counts, and action items
```

## Escalation Flow

See [[Escalation System]] for tier definitions.

```
Agent determines escalation needed
        │
        ▼
Create escalation record in PostgreSQL:
  (type, project_id, task_id, inbox_event_id, summary, context, options)
        │
        ▼
Push to Redis queue:escalations
        │
        ▼
Format Telegram message:
  ┌─────────────────────────────────┐
  │ ESCALATION: [Type]              │
  │ Project: [Name]                 │
  │                                 │
  │ What happened: [summary]        │
  │ Already done: [agent actions]   │
  │ Needs your input: [question]    │
  │                                 │
  │ [Option A]  [Option B]  [Skip]  │
  └─────────────────────────────────┘
        │
        ▼
Bryson taps inline keyboard button
        │
        ▼
Callback handler:
  ├── Update escalation status → "actioned"
  ├── Execute chosen option
  └── Log to agent_logs
```

## Redis Key Flow

All ephemeral data passes through [[Redis]]:

```
webhook:dedup:{channel}:{id}  ← Set on receive, TTL 24h
queue:escalations             ← LPUSH on create, RPOP on process
queue:ingestion               ← LPUSH on upload, RPOP on process
cache:project_context         ← SET on load, TTL 1h, GET on every agent call
ratelimit:gmail:{date}        ← INCR on each API call, TTL 24h
```

## Related Pages

- [[System Overview]] for the architectural layers
- [[PostgreSQL]] for schema details
- [[Qdrant]] for collection schemas
- [[Redis]] for key patterns
- [[Escalation System]] for escalation tiers
