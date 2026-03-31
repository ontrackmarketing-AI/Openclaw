---
title: PostgreSQL
aliases: [Postgres, PG, Relational Database]
tags: [database, postgresql, schema, relational]
created: 2026-03-31
---

# PostgreSQL

PostgreSQL 16 is the source of truth for all structured, relational data in OpenClaw. It handles tasks, contacts, projects, notes metadata, inbox events, escalations, and audit logs.

**Why PostgreSQL?** Relational queries, joins, and aggregations ("give me all overdue tasks for project TTT") belong in a relational database. See [[Decision Log#Mixed Database Strategy]].

## Connection

- **Container:** `openclaw-postgres` (Docker Compose, PostgreSQL 16 Alpine)
- **Default credentials:** `openclaw` / `openclaw` / `openclaw` (dev only)
- **Connection pooling:** `pg.Pool` with configurable max connections, idle timeout, and connection timeout
- **Slow query logging:** Queries over 1000ms are logged as warnings
- **Transaction support:** `withTransaction()` helper for multi-statement operations

Code: `src/db/connection.ts`

## Schema

Full schema: `src/db/schema.sql`

### projects

The project registry. Every other table references projects.

| Column | Type | Default | Description |
|---|---|---|---|
| `id` | UUID | `gen_random_uuid()` | Primary key |
| `name` | TEXT | NOT NULL | Project name (e.g., "SWRE", "Texas Tree Tops") |
| `client` | TEXT | NULL | Client name if applicable |
| `status` | TEXT | `'active'` | `active`, `paused`, `completed`, `archived` |
| `priority` | INTEGER | `3` | 1 (highest) to 5 (lowest) |
| `metadata` | JSONB | `'{}'` | Flexible key-value data (tech stack, notes, URLs) |
| `created_at` | TIMESTAMPTZ | `now()` | Record creation timestamp |
| `updated_at` | TIMESTAMPTZ | `now()` | Last modification timestamp |

**Used by:** [[Orchestrator]] (project context loading), [[Reporting Agent]] (project snapshots), [[Ingestion Agent]] (project matching), all agents via context.

**Indexes:**
- `idx_projects_status` -- Filter active projects quickly
- `idx_projects_priority` -- Sort by priority

**Repository:** `src/db/repositories/projects.ts` -- `getAll()`, `getById()`, `getByName()`, `create()`, `update()`, `getActive()`

---

### tasks

Action items extracted from notebooks, emails, or created by agents.

| Column | Type | Default | Description |
|---|---|---|---|
| `id` | UUID | `gen_random_uuid()` | Primary key |
| `project_id` | UUID | NULL | FK to `projects.id` |
| `source` | TEXT | NULL | Where this task came from: `notebook`, `gmail`, `imessage`, `telegram`, `manual` |
| `source_ref` | TEXT | NULL | Original message/note ID for traceability |
| `title` | TEXT | NOT NULL | Task title |
| `description` | TEXT | NULL | Additional context |
| `status` | TEXT | `'open'` | `open`, `in_progress`, `done`, `cancelled` |
| `priority` | INTEGER | `3` | 1 (highest) to 5 (lowest) |
| `due_date` | DATE | NULL | When this task is due |
| `agent_handled` | BOOLEAN | `false` | Whether an agent completed this without Bryson |
| `escalated_to_bryson` | BOOLEAN | `false` | Whether this was escalated |
| `escalation_reason` | TEXT | NULL | Why it was escalated |
| `created_at` | TIMESTAMPTZ | `now()` | Record creation timestamp |
| `updated_at` | TIMESTAMPTZ | `now()` | Last modification timestamp |

**Used by:** [[Ingestion Agent]] (task extraction), [[Inbox Agent]] (action item extraction), [[Reporting Agent]] (task counts, overdue lists), [[Orchestrator]] (escalation context).

**Indexes:**
- `idx_tasks_project_id` -- Filter tasks by project
- `idx_tasks_status` -- Filter open/done tasks
- `idx_tasks_priority` -- Sort by priority
- `idx_tasks_due_date` -- Find overdue tasks
- `idx_tasks_escalated` -- Partial index on escalated tasks (WHERE `escalated_to_bryson = true`)

**Repository:** `src/db/repositories/tasks.ts` -- `getAll()`, `getById()`, `getByProjectId()`, `getOpen()`, `getOverdue()`, `create()`, `update()`, `markDone()`, `markEscalated()`

---

### notes

Ingested notebook content. Raw text plus structured extraction.

| Column | Type | Default | Description |
|---|---|---|---|
| `id` | UUID | `gen_random_uuid()` | Primary key |
| `project_id` | UUID | NULL | FK to `projects.id` |
| `source` | TEXT | NULL | `notebook`, `drive`, `manual` |
| `raw_text` | TEXT | NULL | Full extracted text from the image |
| `structured` | JSONB | NULL | Parsed structure: `{ tasks[], notes[], decisions[], questions[] }` |
| `image_path` | TEXT | NULL | Path to the original image file |
| `qdrant_ids` | TEXT[] | NULL | Array of Qdrant point IDs for embedded chunks |
| `created_at` | TIMESTAMPTZ | `now()` | Record creation timestamp |

**Used by:** [[Ingestion Agent]] (primary writer), [[Research Agent]] (context lookup), [[Reporting Agent]] (ingestion counts).

**Indexes:**
- `idx_notes_project_id` -- Filter notes by project
- `idx_notes_created_at` -- Sort chronologically

---

### contacts

People Bryson interacts with across all channels.

| Column | Type | Default | Description |
|---|---|---|---|
| `id` | UUID | `gen_random_uuid()` | Primary key |
| `name` | TEXT | NOT NULL | Display name |
| `email` | TEXT | NULL | Email address (for Gmail matching) |
| `phone` | TEXT | NULL | Phone number (for iMessage matching) |
| `imessage_handle` | TEXT | NULL | Apple ID / iMessage identifier |
| `telegram_username` | TEXT | NULL | Telegram username (for Telegram matching) |
| `type` | TEXT | NULL | `client`, `partner`, `vendor`, `personal`, `lead` |
| `project_ids` | UUID[] | NULL | Array of associated project UUIDs |
| `is_vip` | BOOLEAN | `false` | VIP contacts always trigger escalation |
| `last_contact` | TIMESTAMPTZ | NULL | When Bryson last communicated with them |
| `notes` | TEXT | NULL | Free-form notes about this contact |
| `created_at` | TIMESTAMPTZ | `now()` | Record creation timestamp |

**Used by:** [[Inbox Agent]] (sender identification, VIP check), [[Scheduler Agent]] (attendee lookup), [[Escalation System]] (VIP routing). See [[Contacts]] for the full VIP list.

**Indexes:**
- `idx_contacts_is_vip` -- Partial index on VIP contacts (WHERE `is_vip = true`)
- `idx_contacts_email` -- Partial index for email lookup (WHERE `email IS NOT NULL`)
- `idx_contacts_phone` -- Partial index for phone lookup (WHERE `phone IS NOT NULL`)

---

### inbox_events

Every message processed from any channel.

| Column | Type | Default | Description |
|---|---|---|---|
| `id` | UUID | `gen_random_uuid()` | Primary key |
| `channel` | TEXT | NOT NULL | `gmail`, `imessage`, `telegram` |
| `external_id` | TEXT | NULL | Original message ID from the source system |
| `sender` | TEXT | NULL | Sender name or address |
| `contact_id` | UUID | NULL | FK to `contacts.id` (if matched) |
| `project_id` | UUID | NULL | FK to `projects.id` (if matched) |
| `subject` | TEXT | NULL | Thread subject (Gmail) or first line |
| `body_summary` | TEXT | NULL | Claude-generated summary |
| `intent` | TEXT | NULL | `fyi`, `needs_reply`, `needs_action`, `time_sensitive` |
| `agent_action` | TEXT | NULL | What the agent did (e.g., `drafted_reply`, `created_task`, `escalated`) |
| `escalated` | BOOLEAN | `false` | Whether this triggered an escalation |
| `processed_at` | TIMESTAMPTZ | `now()` | When this was processed |

**Unique constraint:** `(channel, external_id)` prevents duplicate processing.

**Used by:** [[Inbox Agent]] (primary writer), [[Reporting Agent]] (inbox summary), [[Orchestrator]] (context).

**Indexes:**
- `idx_inbox_events_channel` -- Filter by channel
- `idx_inbox_events_intent` -- Filter by intent type
- `idx_inbox_events_processed_at` -- Time-range queries for daily reports
- `idx_inbox_events_contact_id` -- Find all messages from a contact

---

### escalations

Items requiring Bryson's decision. Managed by the [[Orchestrator]] and displayed via [[Telegram Bot]].

| Column | Type | Default | Description |
|---|---|---|---|
| `id` | UUID | `gen_random_uuid()` | Primary key |
| `type` | TEXT | NULL | Escalation type (e.g., `vip_message`, `draft_approval`, `conflict`, `ambiguous_note`) |
| `project_id` | UUID | NULL | FK to `projects.id` |
| `task_id` | UUID | NULL | FK to `tasks.id` (if task-related) |
| `inbox_event_id` | UUID | NULL | FK to `inbox_events.id` (if message-related) |
| `summary` | TEXT | NOT NULL | Human-readable summary of what needs attention |
| `context` | TEXT | NULL | Additional context (what was already done) |
| `options` | JSONB | NULL | Array of options for inline keyboard buttons |
| `status` | TEXT | `'pending'` | `pending`, `actioned`, `expired`, `dismissed` |
| `telegram_message_id` | TEXT | NULL | Telegram message ID for editing/updating |
| `created_at` | TIMESTAMPTZ | `now()` | When the escalation was created |
| `actioned_at` | TIMESTAMPTZ | NULL | When Bryson responded |

**Used by:** [[Escalation System]] (full lifecycle), [[Orchestrator]] (queue management), [[Reporting Agent]] (pending counts), [[Telegram Bot]] (display and callbacks).

**Indexes:**
- `idx_escalations_status` -- Filter pending escalations
- `idx_escalations_created_at` -- Time-range queries

---

### agent_logs

Audit trail of every agent action.

| Column | Type | Default | Description |
|---|---|---|---|
| `id` | UUID | `gen_random_uuid()` | Primary key |
| `agent` | TEXT | NOT NULL | Agent name: `orchestrator`, `ingestion`, `inbox`, `research`, `scheduler`, `reporting` |
| `event` | TEXT | NOT NULL | Event type (e.g., `processed_message`, `created_task`, `ran_research`) |
| `project_id` | UUID | NULL | FK to `projects.id` (if project-related) |
| `metadata` | JSONB | `'{}'` | Flexible event metadata |
| `created_at` | TIMESTAMPTZ | `now()` | Event timestamp |

**Used by:** [[Reporting Agent]] (agent activity summary), [[Orchestrator]] (working memory), all agents (audit logging).

**Indexes:**
- `idx_agent_logs_agent` -- Filter by agent
- `idx_agent_logs_created` -- Time-range queries

## Index Strategy

The schema uses a targeted indexing strategy:

1. **Foreign key indexes** -- Every FK column is indexed for JOIN performance (project_id on tasks, notes, inbox_events, etc.)
2. **Status/filter indexes** -- Columns frequently used in WHERE clauses (status, priority, channel, intent)
3. **Partial indexes** -- Used where the filtered subset is small (VIP contacts, escalated tasks, contacts with email/phone). Saves disk space and improves scan speed.
4. **Temporal indexes** -- `created_at` and `processed_at` for time-range queries in daily reports.
5. **No full-text indexes** -- Text search is handled by [[Qdrant]] semantic search, not PostgreSQL.

## Migrations

- Migration runner: `npm run db:migrate` (executes `src/db/migrate.ts`)
- Seed data: `npm run db:seed` (executes `src/db/seed.ts`)

## Related Pages

- [[Qdrant]] for vector/semantic data
- [[Redis]] for ephemeral state
- [[System Overview]] for where PostgreSQL fits
- [[Data Flow]] for how data moves in and out
- [[Decision Log#Mixed Database Strategy]] for why this architecture
