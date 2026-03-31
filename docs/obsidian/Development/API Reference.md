---
title: API Reference
aliases: [API, REST API, Endpoints, HTTP API]
tags: [development, api, rest, endpoints]
created: 2026-03-31
---

# API Reference

OpenClaw exposes a REST API via Express on the configured `PORT` (default: 3000). The API serves webhook receivers, health checks, and internal management endpoints.

## Base URL

```
http://localhost:3000  (development)
http://<ec2-ip>:3000   (production, behind Tailscale)
```

## Authentication

### Webhook Endpoints

Webhook endpoints use source-specific authentication:

| Endpoint | Auth Method |
|---|---|
| `/webhooks/telegram` | Telegram webhook secret header |
| `/webhooks/gmail` | `APP_SECRET` in `Authorization: Bearer` header |
| `/webhooks/ghl` | `APP_SECRET` in `Authorization: Bearer` header |
| `/webhooks/imessage` | `IMESSAGE_BRIDGE_SECRET` in `Authorization: Bearer` header |

### Management Endpoints

Management endpoints require `APP_SECRET` in the `Authorization: Bearer` header.

```
Authorization: Bearer {APP_SECRET}
```

## Endpoints

### Health

#### GET /health

System health check. No authentication required.

**Response 200:**

```json
{
  "status": "ok",
  "timestamp": "2026-03-31T14:00:00Z",
  "services": {
    "postgresql": "connected",
    "redis": "connected",
    "qdrant": "connected"
  },
  "uptime": 86400
}
```

**Response 503:**

```json
{
  "status": "degraded",
  "timestamp": "2026-03-31T14:00:00Z",
  "services": {
    "postgresql": "connected",
    "redis": "error",
    "qdrant": "connected"
  },
  "errors": ["Redis connection failed"]
}
```

---

### Webhooks

#### POST /webhooks/telegram

Receives Telegram bot updates in webhook mode. Handled by Telegraf middleware.

**Auth:** Telegram webhook secret token in `X-Telegram-Bot-Api-Secret-Token` header.

**Body:** Telegram Update object (see [Telegram Bot API](https://core.telegram.org/bots/api#update))

**Response:** 200 (always, per Telegram requirements)

See [[Telegram Bot]] for command handling details.

---

#### POST /webhooks/gmail

Receives Gmail thread data from [[n8n Workflows]] (`openclaw-gmail-fetch`).

**Auth:** `Authorization: Bearer {APP_SECRET}`

**Request body:**

```json
{
  "thread_id": "gmail_thread_abc123",
  "messages": [
    {
      "id": "msg_001",
      "from": "mike@searchtuners.com",
      "to": "bryson@heliumsolutions.com",
      "subject": "Austin campaign update",
      "body": "Hey Bryson, wanted to discuss...",
      "date": "2026-03-31T10:00:00Z"
    }
  ]
}
```

**Response 200:**

```json
{
  "status": "processed",
  "inbox_event_id": "uuid",
  "intent": "needs_reply",
  "agent_action": "drafted_reply"
}
```

**Response 409:**

```json
{
  "status": "duplicate",
  "message": "Thread already processed"
}
```

---

#### POST /webhooks/ghl

Receives GoHighLevel events from [[n8n Workflows]] (`openclaw-ghl-inbound`).

**Auth:** `Authorization: Bearer {APP_SECRET}`

**Request body:**

```json
{
  "event_type": "contact.create",
  "location_id": "ghl_location_abc",
  "contact": {
    "id": "ghl_contact_123",
    "name": "John Smith",
    "email": "john@example.com",
    "phone": "+15551234567"
  },
  "data": {}
}
```

**Response 200:**

```json
{
  "status": "processed",
  "action": "contact_created"
}
```

---

#### POST /webhooks/imessage

Receives iMessage notifications from the [[iMessage Bridge]].

**Auth:** `Authorization: Bearer {IMESSAGE_BRIDGE_SECRET}`

**Request body:**

```json
{
  "event": "new_message",
  "message": {
    "id": "im_msg_456",
    "sender": "+15551234567",
    "text": "Can we meet tomorrow at 3?",
    "timestamp": "2026-03-31T14:30:00Z"
  }
}
```

**Response 200:**

```json
{
  "status": "processed",
  "inbox_event_id": "uuid",
  "intent": "needs_action"
}
```

---

### Projects

#### GET /api/projects

List all projects.

**Auth:** `Authorization: Bearer {APP_SECRET}`

**Query parameters:**

| Parameter | Type | Default | Description |
|---|---|---|---|
| `status` | string | `all` | Filter by status: `active`, `paused`, `completed`, `archived`, `all` |

**Response 200:**

```json
{
  "projects": [
    {
      "id": "uuid",
      "name": "SWRE",
      "client": "SWRE",
      "status": "active",
      "priority": 1,
      "metadata": {},
      "created_at": "2026-03-01T00:00:00Z",
      "updated_at": "2026-03-31T00:00:00Z"
    }
  ]
}
```

---

#### GET /api/projects/:id

Get a single project by ID.

**Auth:** `Authorization: Bearer {APP_SECRET}`

**Response 200:** Single project object.

**Response 404:** `{ "error": "Project not found" }`

---

### Tasks

#### GET /api/tasks

List tasks with filtering.

**Auth:** `Authorization: Bearer {APP_SECRET}`

**Query parameters:**

| Parameter | Type | Default | Description |
|---|---|---|---|
| `status` | string | `all` | Filter: `open`, `in_progress`, `done`, `cancelled`, `all` |
| `project_id` | UUID | -- | Filter by project |
| `overdue` | boolean | `false` | Show only overdue tasks |

**Response 200:**

```json
{
  "tasks": [
    {
      "id": "uuid",
      "project_id": "uuid",
      "title": "Update pricing page",
      "status": "open",
      "priority": 2,
      "due_date": "2026-04-01",
      "source": "notebook",
      "escalated_to_bryson": false,
      "created_at": "2026-03-30T00:00:00Z"
    }
  ]
}
```

---

#### POST /api/tasks

Create a new task.

**Auth:** `Authorization: Bearer {APP_SECRET}`

**Request body:**

```json
{
  "title": "Follow up with Mike",
  "project_id": "uuid",
  "description": "Discuss Austin campaign budget",
  "priority": 2,
  "due_date": "2026-04-02",
  "source": "manual"
}
```

**Response 201:** Created task object.

---

#### PATCH /api/tasks/:id

Update a task.

**Auth:** `Authorization: Bearer {APP_SECRET}`

**Request body:** Any subset of task fields.

**Response 200:** Updated task object.

---

### Escalations

#### GET /api/escalations

List escalations.

**Auth:** `Authorization: Bearer {APP_SECRET}`

**Query parameters:**

| Parameter | Type | Default | Description |
|---|---|---|---|
| `status` | string | `pending` | Filter: `pending`, `actioned`, `expired`, `dismissed`, `all` |

**Response 200:**

```json
{
  "escalations": [
    {
      "id": "uuid",
      "type": "vip_message",
      "project_id": "uuid",
      "summary": "Mike sent a message about the Austin campaign",
      "status": "pending",
      "options": ["Approve", "Counter-offer", "Dismiss"],
      "created_at": "2026-03-31T14:00:00Z"
    }
  ]
}
```

---

#### POST /api/escalations/:id/action

Action an escalation.

**Auth:** `Authorization: Bearer {APP_SECRET}`

**Request body:**

```json
{
  "action": "approve",
  "data": {}
}
```

**Response 200:**

```json
{
  "status": "actioned",
  "escalation_id": "uuid",
  "action": "approve",
  "actioned_at": "2026-03-31T14:05:00Z"
}
```

---

### n8n Bridge

#### POST /n8n/ghl-task

Create a GHL task via n8n. Called by the [[Orchestrator]] when a client-facing task needs CRM tracking.

**Auth:** `Authorization: Bearer {APP_SECRET}`

**Request body:**

```json
{
  "ghl_location_id": "location_abc",
  "contact_id": "ghl_contact_123",
  "title": "Follow up on proposal",
  "description": "Sent pricing proposal, follow up in 3 days",
  "due_date": "2026-04-03"
}
```

**Response 200:** `{ "status": "created", "ghl_task_id": "..." }`

---

#### POST /n8n/ghl-note

Add a note to a GHL contact. Called by the [[Inbox Agent]] when logging communication summaries.

**Auth:** `Authorization: Bearer {APP_SECRET}`

**Request body:**

```json
{
  "ghl_location_id": "location_abc",
  "contact_id": "ghl_contact_123",
  "note_body": "Email thread about Austin campaign pricing. Draft reply sent for Bryson's approval."
}
```

**Response 200:** `{ "status": "created" }`

---

## Error Responses

All endpoints return errors in a consistent format:

```json
{
  "error": "Human-readable error message",
  "code": "ERROR_CODE",
  "details": {}
}
```

| HTTP Status | Meaning |
|---|---|
| 400 | Bad request (invalid body, missing fields) |
| 401 | Authentication failed |
| 404 | Resource not found |
| 409 | Conflict (duplicate) |
| 429 | Rate limited |
| 500 | Internal server error |

## Code References

- Express server setup: `src/api/`
- Route handlers: `src/api/`
- Configuration: `src/config/index.ts` (`app.port`, `app.secret`)

## Related Pages

- [[Telegram Bot]] for the Telegram webhook endpoint
- [[Gmail Integration]] for the Gmail webhook
- [[iMessage Bridge]] for the iMessage webhook
- [[GoHighLevel Integration]] for GHL webhooks
- [[n8n Workflows]] for n8n bridge endpoints
- [[Security]] for authentication details
