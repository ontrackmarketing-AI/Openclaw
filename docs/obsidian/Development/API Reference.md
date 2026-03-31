---
title: API Reference
aliases: [API, REST API, Endpoints, HTTP API]
tags: [development, api, rest, endpoints, reference]
created: 2026-03-31
---

# API Reference

OpenClaw exposes a REST API via Express on port 3000 (configurable via `PORT`). The API serves webhooks for external integrations and provides CRUD endpoints for projects, tasks, contacts, escalations, notes, ingestion, and briefings.

## Authentication

All API endpoints (except those listed below) require authentication via Bearer token:

```
Authorization: Bearer {APP_SECRET}
```

The `APP_SECRET` is configured as an environment variable. See [[Environment Variables]].

### Paths That Skip Authentication

| Path | Reason |
|---|---|
| `GET /health` | Public health check for load balancers and monitoring |
| `POST /webhooks/telegram` | Uses Telegram's own secret token verification (`X-Telegram-Bot-Api-Secret-Token` header) |

All other paths return `401 Unauthorized` without a valid Bearer token or `403 Forbidden` with an invalid token.

## Base URL

- **Local development:** `http://localhost:3000`
- **Production:** `https://{ec2-public-ip}` or via Tailscale `http://100.x.x.x:3000`

## Response Format

All API responses follow a consistent JSON envelope:

### Success

```json
{
  "data": { ... }
}
```

### Error

```json
{
  "error": "Human-readable error message"
}
```

### List Response

```json
{
  "data": [ ... ]
}
```

---

## Health Check

### GET /health

No authentication required.

**Response (200):**

```json
{
  "status": "ok",
  "service": "openclaw",
  "timestamp": "2026-03-31T14:00:00.000Z",
  "uptime": 3600.5
}
```

---

## Projects

### GET /api/projects

List all projects.

**Response (200):**

```json
{
  "data": [
    {
      "id": "uuid",
      "name": "SWRE",
      "client": "SW Recovery Services",
      "status": "active",
      "priority": 1,
      "metadata": {},
      "created_at": "2026-03-31T00:00:00.000Z",
      "updated_at": "2026-03-31T00:00:00.000Z"
    }
  ]
}
```

### GET /api/projects/:id

Get a single project by UUID.

**Parameters:**

| Parameter | Location | Required | Description |
|---|---|---|---|
| `id` | Path | Yes | Project UUID |

**Response (200):** Single project object wrapped in `data`.
**Response (404):** `{ "error": "Project not found" }`

---

## Tasks

### GET /api/tasks

List tasks with optional filters.

**Query Parameters:**

| Parameter | Type | Description |
|---|---|---|
| `status` | string | Filter by status (`open`, `in_progress`, `done`, `cancelled`) |
| `project_id` | string (UUID) | Filter by project |

Both parameters can be combined to get tasks for a specific project with a specific status.

**Response (200):**

```json
{
  "data": [
    {
      "id": "uuid",
      "project_id": "uuid",
      "source": "notebook",
      "source_ref": null,
      "title": "Follow up with Daniel about TTT pricing",
      "description": "From notebook page 12",
      "status": "open",
      "priority": 2,
      "due_date": "2026-04-05",
      "agent_handled": false,
      "escalated_to_bryson": false,
      "escalation_reason": null,
      "created_at": "2026-03-31T00:00:00.000Z",
      "updated_at": "2026-03-31T00:00:00.000Z"
    }
  ]
}
```

### POST /api/tasks

Create a new task.

**Request Body:**

```json
{
  "title": "Review OnTrack proposal",
  "project_id": "uuid",
  "source": "manual",
  "source_ref": null,
  "description": "Final review before sending to client",
  "status": "open",
  "priority": 2,
  "due_date": "2026-04-10"
}
```

| Field | Type | Required | Default | Description |
|---|---|---|---|---|
| `title` | string | Yes | -- | Task title |
| `project_id` | string (UUID) | No | null | Associated project |
| `source` | string | No | null | Origin: `notebook`, `gmail`, `imessage`, `telegram`, `manual` |
| `source_ref` | string | No | null | Reference to original message/note |
| `description` | string | No | null | Additional context |
| `status` | string | No | `open` | Initial status |
| `priority` | number | No | 3 | 1 (highest) to 5 (lowest) |
| `due_date` | string (date) | No | null | Due date in `YYYY-MM-DD` format |

**Response (201):** Created task object wrapped in `data`.
**Response (400):** `{ "error": "title is required and must be a string" }`

### PATCH /api/tasks/:id

Update an existing task. Only provided fields are updated.

**Parameters:**

| Parameter | Location | Required | Description |
|---|---|---|---|
| `id` | Path | Yes | Task UUID |

**Request Body (all fields optional):**

```json
{
  "title": "Updated title",
  "description": "Updated description",
  "status": "done",
  "priority": 1,
  "due_date": "2026-04-15",
  "project_id": "uuid",
  "agent_handled": true,
  "escalated_to_bryson": false,
  "escalation_reason": null
}
```

**Response (200):** Updated task object wrapped in `data`.
**Response (404):** `{ "error": "Task not found" }`

---

## Contacts

### GET /api/contacts

List contacts with optional VIP filter.

**Query Parameters:**

| Parameter | Type | Description |
|---|---|---|
| `vip` | string | Set to `"true"` to return only VIP contacts |

**Response (200):**

```json
{
  "data": [
    {
      "id": "uuid",
      "name": "Mike",
      "email": "mike@searchtuners.com",
      "phone": "+15551234567",
      "imessage_handle": null,
      "telegram_username": "@mike_st",
      "type": "partner",
      "project_ids": ["uuid"],
      "is_vip": true,
      "last_contact": "2026-03-30T16:00:00.000Z",
      "notes": "Search Tuners partner",
      "created_at": "2026-03-31T00:00:00.000Z"
    }
  ]
}
```

---

## Escalations

### GET /api/escalations

List pending escalations.

**Response (200):**

```json
{
  "data": [
    {
      "id": "uuid",
      "type": "draft_approval",
      "project_id": "uuid",
      "task_id": null,
      "inbox_event_id": "uuid",
      "summary": "Draft reply to Daniel about TTT pricing",
      "context": "Daniel asked about updated pricing for Q2",
      "options": [
        { "label": "Send draft", "action": "approve" },
        { "label": "Edit", "action": "edit" },
        { "label": "Dismiss", "action": "dismiss" }
      ],
      "status": "pending",
      "telegram_message_id": "12345",
      "created_at": "2026-03-31T14:00:00.000Z",
      "actioned_at": null
    }
  ]
}
```

### POST /api/escalations/:id/action

Take action on a pending escalation.

**Parameters:**

| Parameter | Location | Required | Description |
|---|---|---|---|
| `id` | Path | Yes | Escalation UUID |

**Request Body:**

```json
{
  "action": "approve"
}
```

| Field | Type | Required | Valid Values |
|---|---|---|---|
| `action` | string | Yes | `approve`, `dismiss`, `edit`, `handle_myself`, `escalate` |

**Response (200):** Updated escalation object wrapped in `data`.
**Response (400):** `{ "error": "action is required and must be a string" }` or `{ "error": "Invalid action. Must be one of: ..." }`
**Response (404):** `{ "error": "Escalation not found" }`
**Response (409):** `{ "error": "Escalation already actioned" }`

---

## Notes

### GET /api/notes

List notes with optional project filter.

**Query Parameters:**

| Parameter | Type | Description |
|---|---|---|
| `project_id` | string (UUID) | Filter by project |

**Response (200):**

```json
{
  "data": [
    {
      "id": "uuid",
      "project_id": "uuid",
      "source": "notebook",
      "raw_text": "Full extracted text from notebook page...",
      "structured": {
        "tasks": [...],
        "notes": [...],
        "decisions": [...],
        "questions": [...]
      },
      "image_path": "https://api.telegram.org/file/...",
      "qdrant_ids": ["point_id_1", "point_id_2"],
      "created_at": "2026-03-31T10:00:00.000Z"
    }
  ]
}
```

---

## Ingestion

### POST /api/ingest

Submit content for ingestion into the system.

**Request Body:**

```json
{
  "raw_text": "Meeting notes from TTT call...",
  "source": "manual",
  "project_id": "uuid",
  "image_path": "https://example.com/photo.jpg"
}
```

| Field | Type | Required | Description |
|---|---|---|---|
| `raw_text` | string | One of raw_text or image_path | Text content to ingest |
| `image_path` | string | One of raw_text or image_path | URL or path to an image file |
| `source` | string | No | Origin identifier (default: `manual`) |
| `project_id` | string (UUID) | No | Associated project |

**Response (201):**

```json
{
  "data": {
    "id": "uuid",
    "raw_text": "Meeting notes from TTT call...",
    "source": "manual",
    "project_id": "uuid",
    "image_path": null,
    "created_at": "2026-03-31T14:00:00.000Z"
  },
  "message": "Ingestion queued"
}
```

**Response (400):** `{ "error": "Either raw_text or image_path is required" }`

---

## Briefing

### GET /api/briefing

Generate a briefing summary with current system state.

**Response (200):**

```json
{
  "data": {
    "generated_at": "2026-03-31T14:00:00.000Z",
    "summary": {
      "active_projects": 8,
      "open_tasks": 23,
      "overdue_tasks": 3,
      "pending_escalations": 2
    },
    "overdue_tasks": [
      {
        "id": "uuid",
        "title": "Review SWRE quarterly report",
        "due_date": "2026-03-28",
        "project_id": "uuid",
        "priority": 1
      }
    ],
    "pending_escalations": [
      {
        "id": "uuid",
        "type": "vip_message",
        "summary": "Mike sent a message about Search Tuners revenue split",
        "created_at": "2026-03-31T12:00:00.000Z"
      }
    ],
    "projects": [
      {
        "id": "uuid",
        "name": "SWRE",
        "client": "SW Recovery Services",
        "priority": 1,
        "task_count": 5
      }
    ],
    "top_tasks": [
      {
        "id": "uuid",
        "title": "Follow up with Daniel",
        "priority": 1,
        "due_date": "2026-04-01",
        "project_id": "uuid"
      }
    ]
  }
}
```

---

## Webhooks

### POST /webhooks/telegram

Telegram Bot API webhook endpoint. Authenticated via `X-Telegram-Bot-Api-Secret-Token` header (not the standard Bearer token).

Handled by Telegraf's `webhookCallback` middleware. See [[Telegram Bot]].

### POST /webhooks/n8n

Receive events from [[n8n Workflows]].

**Request Body:**

```json
{
  "type": "gmail.new_email",
  "workflow": "openclaw-gmail-fetch",
  "data": {
    "thread_id": "...",
    "messages": [...],
    "subject": "...",
    "sender": "..."
  }
}
```

**Supported Event Types:**

| Type | Description | Routed To |
|---|---|---|
| `gmail.new_email` | New or updated Gmail thread | [[Inbox Agent]] |
| `calendar.event` | Calendar event change | [[Scheduler Agent]] |
| `drive.file_changed` | File added/modified in Drive | [[Ingestion Agent]] or [[Research Agent]] |
| `ingest` | Raw text for ingestion | Note creation |

**Authentication:** `X-N8N-Secret` header or `Authorization: Bearer {N8N_API_KEY}`

**Response (200):** `{ "ok": true, "received": "gmail.new_email" }`

### POST /webhooks/ghl

Receive events from [[GoHighLevel Integration]] (via [[n8n Workflows]]).

**Request Body:**

```json
{
  "type": "contact.created",
  "contactId": "ghl_contact_id",
  "locationId": "ghl_location_id",
  "...": "additional GHL fields"
}
```

**Supported Event Types:**

| Type | Description |
|---|---|
| `contact.created` | New contact in GHL |
| `contact.updated` | Contact details changed |
| `opportunity.created` | New deal/opportunity |
| `opportunity.status_changed` | Pipeline stage change |
| `task.completed` | GHL task marked done |

**Authentication:** `X-GHL-Signature` header (HMAC-SHA256 signature verified against `GHL_API_KEY`)

**Response (200):** `{ "ok": true, "received": "contact.created" }`

---

## Error Codes

| HTTP Status | Meaning |
|---|---|
| 200 | Success |
| 201 | Created (POST) |
| 400 | Bad request (missing or invalid parameters) |
| 401 | Missing Authorization header |
| 403 | Invalid API key or webhook secret |
| 404 | Resource not found |
| 409 | Conflict (e.g., escalation already actioned) |
| 500 | Internal server error |

## Code References

- Server setup: `src/server/index.ts`
- Auth middleware: `src/server/middleware/auth.ts`
- Route files: `src/server/routes/`
  - Projects: `src/server/routes/projects.ts`
  - Tasks: `src/server/routes/tasks.ts`
  - Contacts: `src/server/routes/contacts.ts`
  - Escalations: `src/server/routes/escalations.ts`
  - Notes: `src/server/routes/notes.ts`
  - Ingest: `src/server/routes/ingest.ts`
  - Briefing: `src/server/routes/briefing.ts`
  - Webhooks: `src/server/routes/webhooks.ts`

## Related Pages

- [[Environment Variables]] for `APP_SECRET` and `PORT` configuration
- [[Telegram Bot]] for webhook endpoint details
- [[n8n Workflows]] for n8n webhook payloads
- [[GoHighLevel Integration]] for GHL webhook signature verification
- [[Security]] for authentication model
- [[Deployment]] for API hosting
