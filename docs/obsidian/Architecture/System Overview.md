---
title: System Overview
aliases: [Architecture, System Architecture]
tags: [architecture, system-design, overview]
created: 2026-03-31
---

# System Overview

OpenClaw is a four-layer architecture: Input Layer, Agent Layer, Output Layer, and Database Layer. Every component is designed around the core principle: **"Only ping Bryson when Bryson is required."**

## Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────┐
│                    OPENCLAW PERSONAL OS                          │
│                                                                  │
│  INPUT LAYER          AGENT LAYER           OUTPUT LAYER         │
│  ─────────────        ───────────           ────────────         │
│  Notebook Photos  →  INGESTION AGENT                             │
│  Gmail            →  INBOX AGENT      →    Telegram (you)        │
│  iMessage         →  INBOX AGENT      →    Gmail drafts          │
│  Telegram         →  INBOX AGENT      →    GHL actions           │
│  Google Drive     →  RESEARCH AGENT   →    n8n triggers          │
│  Calendar         →  SCHEDULER AGENT  →    Claude Code context   │
│                                                                  │
│                    ORCHESTRATOR (central brain)                   │
│                    ─────────────────────────                     │
│                    Project Context Store                         │
│                    ↕                                             │
│  DATABASE LAYER                                                  │
│  ─────────────                                                   │
│  PostgreSQL (structured)  +  Qdrant (vector/RAG)                 │
│  + Redis (queue/cache)                                           │
└─────────────────────────────────────────────────────────────────┘
```

## Input Layer

The input layer captures data from all of Bryson's communication channels and work surfaces:

| Source | Method | Destination Agent |
|---|---|---|
| Notebook Photos | Telegram upload or Google Drive watched folder | [[Ingestion Agent]] |
| Gmail | Gmail API (OAuth2), polled every 15 min via [[n8n Workflows]] | [[Inbox Agent]] |
| iMessage | [[iMessage Bridge]] on Mac mini | [[Inbox Agent]] |
| Telegram | Bot API webhooks | [[Inbox Agent]] |
| Google Drive | Drive API, watched folders | [[Research Agent]], [[Ingestion Agent]] |
| Google Calendar | Calendar API | [[Scheduler Agent]] |
| GoHighLevel | GHL API via [[n8n Workflows]] | [[Orchestrator]] |

## Agent Layer

Six specialized agents handle all processing. The [[Orchestrator]] sits at the center, routing events and maintaining project context. Each specialist agent is kept lean and focused on a single domain.

- **[[Orchestrator]]** -- Central brain. Loads project context, routes events, merges results, manages escalation queue.
- **[[Ingestion Agent]]** -- Turns notebook photos into structured, searchable data.
- **[[Inbox Agent]]** -- Triages Gmail, iMessage, and Telegram. Handles what it can, escalates what it cannot.
- **[[Research Agent]]** -- Gathers information from web, Drive, and Qdrant without interrupting Bryson.
- **[[Scheduler Agent]]** -- Manages calendar context, pre-briefs, and conflict detection.
- **[[Reporting Agent]]** -- Produces daily briefings and on-demand status reports.

### Agent Decision Tree

Every agent operates on the same decision tree:

```
Can I handle this autonomously?
  ├── YES → Execute and log
  ├── PARTIALLY → Prepare + queue for review
  └── NO → Escalate with full context
```

Escalations always arrive in Telegram with:
1. What happened
2. What was already done
3. What specifically needs Bryson's input
4. Suggested options (when possible)

## Output Layer

All outputs flow through controlled channels:

- **Telegram** -- Primary output channel. Briefings, escalations, confirmations, inline keyboards for approvals. See [[Telegram Bot]].
- **Gmail Drafts** -- The system drafts replies but never sends autonomously. See [[Gmail Integration]].
- **GHL Actions** -- CRM updates routed through [[n8n Workflows]] to [[GoHighLevel Integration]].
- **Claude Code Context** -- Research and project context that feeds into development sessions.

## Database Layer

Three databases serve distinct purposes:

- **[[PostgreSQL]]** -- Source of truth for all structured, relational data. Tasks, contacts, projects, notes metadata, audit logs.
- **[[Qdrant]]** -- Semantic vector search. Note content, email summaries, research output. "Find things by what they're about."
- **[[Redis]]** -- Ephemeral state. Task queues (BullMQ), rate limiting, session caches, webhook deduplication.

See [[Data Flow]] for how data moves between these layers.

## Key Design Principles

1. **Autonomy with guardrails** -- Agents act independently but escalate when uncertain.
2. **Project-centric context** -- Every event is matched to a project before processing.
3. **Single orchestrator** -- Keeps specialist agents decoupled and testable.
4. **Never spam Bryson** -- Batch, filter, and only interrupt for genuine decisions.
5. **Defense in depth** -- Feature flags gate all write operations to external services.

## Related Pages

- [[Tech Stack]] for technology choices
- [[Data Flow]] for detailed flow diagrams
- [[Build Phases]] for implementation sequence
- [[Decision Log]] for architectural reasoning
