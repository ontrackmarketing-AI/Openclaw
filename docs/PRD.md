# OpenClaw Personal OS — Full Product Requirements Document

**Version:** 1.0  
**Owner:** Bryson Stevens / Helium Solutions  
**Status:** Pre-build — Claude Code ready  
**Date:** 2026-03-31

-----

## TABLE OF CONTENTS

1. [Vision & Problem Statement](#1-vision--problem-statement)
2. [System Overview](#2-system-overview)
3. [Agent Architecture](#3-agent-architecture)
4. [Data Sources & Integrations](#4-data-sources--integrations)
5. [Database Architecture](#5-database-architecture)
6. [Notebook Ingestion Pipeline](#6-notebook-ingestion-pipeline)
7. [Inline Automation (n8n)](#7-inline-automation-n8n)
8. [Communication Channels](#8-communication-channels)
9. [Skills & Capabilities per Agent](#9-skills--capabilities-per-agent)
10. [Notification & Escalation Logic](#10-notification--escalation-logic)
11. [Infrastructure & Hosting](#11-infrastructure--hosting)
12. [Security & Compliance](#12-security--compliance)
13. [Gap Analysis](#13-gap-analysis)
14. [Build Sequence for Claude Code](#14-build-sequence-for-claude-code)
15. [Environment Variables Reference](#15-environment-variables-reference)
16. [Decision Log — Why We Built It This Way](#16-decision-log--why-we-built-it-this-way)

-----

## 1. Vision & Problem Statement

### What This Is

Bryson runs three interconnected businesses as a solo operator:

- **Helium Solutions** — AI marketing automation agency
- **Search Tuners partnership** — referral-based marketing with Mike
- **OnTrack Marketing** — SaaS product in development

He carries the context for every client, every workflow, every task in his head and on paper. Notes get written, tasks get listed, ideas get captured — but nothing talks to each other. Email piles up. iMessages go unread. Gmail threads get buried. Projects drift.

The goal of OpenClaw Personal OS is to give Bryson a single autonomous AI chief of staff that:

1. **Reads his notebook** (photos of handwritten notes → structured context)
2. **Monitors his inboxes** (Gmail, iMessage, Telegram) without him having to check them
3. **Knows every active project** and can reference them when pulling from any data source
4. **Works autonomously** across all areas it can handle without interrupting Bryson
5. **Surfaces only what truly needs him** — decisions, approvals, things that require his unique judgment
6. **Reports back** in a structured daily/on-demand briefing via Telegram

This is not a chatbot. This is an operating system for a solo operator's business brain.

### What It Is NOT

- Not a general-purpose assistant — everything is scoped to Bryson's actual projects and clients
- Not a replacement for Claude Code sessions — it feeds INTO those sessions
- Not a notification machine — it batches, filters, and only escalates what matters
- Not one agent — it's a multi-agent system with specialized roles

-----

## 2. System Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                    OPENCLAW PERSONAL OS                          │
│                                                                  │
│  INPUT LAYER          AGENT LAYER           OUTPUT LAYER         │
│  ─────────────        ───────────           ────────────         │
│  📷 Notebook Photos → INGESTION AGENT                           │
│  📧 Gmail         →  INBOX AGENT      →    Telegram (you)       │
│  💬 iMessage      →  INBOX AGENT      →    Gmail drafts         │
│  ✈️  Telegram     →  INBOX AGENT      →    GHL actions          │
│  📂 Google Drive  →  RESEARCH AGENT   →    n8n triggers         │
│  📅 Calendar      →  SCHEDULER AGENT  →    Claude Code context  │
│                                                                  │
│                    ORCHESTRATOR (central brain)                  │
│                    ─────────────────────────                    │
│                    Project Context Store                        │
│                    ↕                                            │
│  DATABASE LAYER                                                  │
│  ─────────────                                                   │
│  PostgreSQL (structured)  +  Qdrant (vector/RAG)                │
│  + Redis (queue/cache)                                           │
└─────────────────────────────────────────────────────────────────┘
```

### Core Principle: "Only ping Bryson when Bryson is required"

Every agent operates on a decision tree: **Can I handle this? → Do it. Can't fully handle it but can prepare it? → Prepare + queue. Requires Bryson? → Escalate with full context.**

Escalations always arrive in Telegram with:

- What happened
- What was already done
- What specifically needs Bryson's input
- Suggested options (when possible)

-----

## 3. Agent Architecture

### Agent 1: Orchestrator

**Role:** Central brain. Receives all events, routes them to the right agent, maintains project context, manages the escalation queue.

**Function:**

- Loads the Project Context Store on every invocation
- Routes incoming events to the appropriate specialist agent
- Merges results and decides: execute / queue / escalate
- Maintains a "working memory" of what's been done this session
- Runs on a cron schedule AND on webhook triggers

**Why a dedicated orchestrator?**  
Without it, each agent would need to know about all other agents and all project context. The orchestrator pattern keeps specialist agents lean and testable. When Bryson adds a new client or project, he updates the orchestrator's context — not every agent.

-----

### Agent 2: Ingestion Agent (Notebook Pipeline)

**Role:** Turns photos of handwritten notes into structured project context.

**Function:**

- Receives image(s) via Telegram upload or a watched Google Drive folder
- Runs Claude Vision to extract text, tasks, and project references
- Structures output: `{ project, tasks[], notes[], decisions[], questions[] }`
- Writes structured output to PostgreSQL `notes` table
- Embeds all note content into Qdrant under namespace `bryson_notes`
- Updates the Project Context Store if new project references are found
- Reports back to Bryson via Telegram: "Ingested 3 pages. Found 7 tasks across SWRE, TTT, and OnTrack. 2 items need clarification — [list]."

**Why this matters:**  
This is the core unlock. Pen-and-paper notes become queryable, searchable, actionable context. Every other agent can now pull from "what Bryson wrote down" when making decisions.

-----

### Agent 3: Inbox Agent (Gmail + iMessage + Telegram)

**Role:** Monitors all inboxes, triages messages, handles what it can, escalates what it can't.

**Sub-agents:**

- **Gmail Sub-agent** — reads threads, drafts replies, flags important senders, extracts action items
- **iMessage Sub-agent** — reads conversations (via Mac bridge), responds to simple queries, flags client messages
- **Telegram Sub-agent** — handles commands, receives note uploads, returns briefings

**Function per message:**

1. Identify sender → look up in Project Context Store (is this a client? VIP? vendor?)
2. Classify intent: FYI / needs reply / needs action / time-sensitive
3. For FYIs from non-VIPs → log and skip
4. For replies it can draft → compose draft, send to Bryson for 1-tap approval via Telegram
5. For action items → extract, create task in PostgreSQL, link to project
6. For VIP messages (Mike, Daniel, Steven, Hunter) → always escalate immediately

**Why iMessage needs a Mac bridge:**  
iMessage is Apple-only. There is no official API. The only production-grade solution is a small Node.js server running on a Mac (or Mac mini) that uses `osascript` to read/send iMessages and exposes a local REST API. This is the one component that requires a macOS machine. A Mac mini on 24/7 is the standard setup. This is a known architectural constraint and not a workaround — it's the only path.

-----

### Agent 4: Research Agent

**Role:** Handles information gathering, competitive research, client research, and document analysis without interrupting Bryson.

**Function:**

- Pulls relevant documents from Google Drive when a project is referenced
- Runs web searches for client-relevant information
- Synthesizes research into structured summaries stored in Qdrant
- Can be triggered by Orchestrator ("research Texas Tree Tops competitors before Bryson's call") or directly via Telegram command

-----

### Agent 5: Scheduler & Planner Agent

**Role:** Manages calendar context, surfaces scheduling conflicts, drafts meeting prep.

**Function:**

- Reads Google Calendar
- Pre-briefs Bryson before meetings: who's the contact, what project, last note, open action items
- Flags scheduling conflicts proactively
- Suggests time blocks for deep work vs. admin based on calendar density

-----

### Agent 6: Reporting Agent

**Role:** Produces daily briefing and on-demand status reports.

**Function:**

- Runs every morning at a configurable time (default 8:00 AM CST)
- Pulls from all agents' outputs from the last 24 hours
- Produces a structured Telegram message

-----

## 4. Data Sources & Integrations

| Source | Integration Method | What's Pulled | Agent(s) |
|---|---|---|---|
| Gmail | Gmail API (OAuth2) | All threads, sender metadata, attachments | Inbox Agent |
| iMessage | Mac bridge (osascript + Node REST) | All conversations, contact lookup | Inbox Agent |
| Telegram | Bot API (webhook) | Commands, note uploads, responses | Inbox Agent, Reporting Agent |
| Google Calendar | Google Calendar API | Events, attendees, description | Scheduler Agent |
| Google Drive | Drive API | Docs, sheets, shared files by folder | Research Agent, Ingestion Agent |
| Notebook Photos | Telegram upload OR Drive watched folder | JPEG/PNG images | Ingestion Agent |
| Qdrant (SWRE) | Qdrant REST API via Tailscale | Existing 822K vectors | Research Agent (read-only) |
| n8n | REST API / webhooks | Workflow triggers | Orchestrator |
| GHL | GHL API | Contact creation, task creation, pipeline updates | Orchestrator (via n8n) |

-----

## 5. Database Architecture

### Why Mixed: PostgreSQL + Qdrant + Redis

**PostgreSQL** handles all structured, relational data — tasks, contacts, projects, notes metadata, audit logs. This is your source of truth for "what happened."

**Qdrant** handles all semantic/vector data — note content, email summaries, research, anything you want to retrieve by meaning rather than exact match. This is your "find things by what they're about."

**Redis** handles ephemeral state — task queues, rate limiting, session caches, webhook deduplication. Never use Redis as primary storage — it's a fast lane, not a database.

**Why not just Qdrant for everything?**  
Qdrant is excellent at "find me things similar to X" but poor at "give me all tasks for project TTT that are overdue." Relational queries, joins, and aggregations belong in Postgres. Vector search belongs in Qdrant. Using one for the other's job creates performance and reliability problems.

### PostgreSQL Schema

See `src/db/schema.sql` for the full schema implementation.

### Qdrant Collections

| Collection | Purpose | Embedding Model |
|---|---|---|
| `bryson_notes` | All notebook content, chunked | text-embedding-3-small |
| `bryson_emails` | Summarized email threads | text-embedding-3-small |
| `bryson_research` | Research Agent output | text-embedding-3-small |
| `bryson_projects` | Project context docs | text-embedding-3-small |

### Redis Usage

```
Keys:
  webhook:dedup:{channel}:{message_id}     → "1" (TTL 24h)
  queue:escalations                         → list of escalation IDs
  queue:ingestion                           → list of image paths
  cache:project_context                     → serialized Project Context Store (TTL 1h)
  ratelimit:gmail:{date}                    → request count (TTL 24h)
```

-----

## 6. Notebook Ingestion Pipeline

See `src/agents/ingestion/` for full implementation.

### Flow

```
Bryson takes photos of notebook pages
        ↓
Uploads to Telegram OR drops into Google Drive folder
        ↓
Ingestion Agent receives image(s)
        ↓
Claude Vision API: extract all text, identify structure
        ↓
Structuring pass: identify tasks, decisions, questions, project references
        ↓
Project matching: fuzzy-match references to known projects
        ↓
Ambiguity check: flag unclear items → queue for Bryson
        ↓
Write to PostgreSQL: notes table + tasks table
        ↓
Chunk text (512 tokens, 50 token overlap) → embed → Qdrant
        ↓
Telegram confirmation to Bryson
```

-----

## 7. Inline Automation (n8n)

n8n handles GHL integration and acts as a bridge for external webhooks.

| Workflow | Trigger | Action |
|---|---|---|
| `openclaw-ghl-inbound` | GHL webhook | Parse event → POST to OpenClaw API |
| `openclaw-ghl-task-create` | OpenClaw HTTP call | Create task in GHL sub-account |
| `openclaw-ghl-contact-note` | OpenClaw HTTP call | Add note to GHL contact |
| `openclaw-gmail-fetch` | Schedule (every 15 min) | Fetch new Gmail threads → POST to OpenClaw API |

-----

## 8-16. See Additional Documentation

Remaining sections are implemented in code and documented in the `docs/obsidian/` vault.

-----

*End of PRD — Version 1.0*
