---
title: n8n Workflows
aliases: [n8n, Workflows, Automation Workflows]
tags: [integration, n8n, workflows, automation, bridge]
created: 2026-03-31
---

# n8n Workflows

n8n is an open-source workflow automation platform that bridges OpenClaw with external services that benefit from visual workflow design, built-in retry logic, and decoupled credential management. Four workflows handle the integration between OpenClaw and external systems.

## Why n8n Instead of Direct Integration

1. **Visual debugging** -- n8n's execution history shows exactly what data flowed through each step. When a GHL contact sync fails, you see the payload, the error, and can re-run the step.
2. **Credential isolation** -- GHL sub-account credentials live in n8n, not in the OpenClaw codebase. Adding a new GHL sub-account means adding an n8n credential, not a code deploy.
3. **Retry logic** -- n8n provides configurable retry with backoff out of the box for every HTTP node.
4. **Rate limiting** -- n8n respects API rate limits at the workflow level.
5. **Non-developer maintenance** -- If Bryson hires an ops person, they can modify n8n workflows without touching TypeScript.

See [[Decision Log#n8n for External Bridges]] for the full reasoning.

## Infrastructure

- **Instance:** Self-hosted n8n (Docker or standalone) on the same server or a dedicated instance
- **Access:** Via `N8N_BASE_URL` (e.g., `http://localhost:5678`)
- **Authentication:** API key (`N8N_API_KEY`) for programmatic workflow triggering

## Environment Variables

| Variable | Required | Description |
|---|---|---|
| `N8N_BASE_URL` | No | URL of the n8n instance |
| `N8N_API_KEY` | No | API key for n8n REST API access |

See [[Environment Variables]] for the complete list.

## Workflows

### 1. openclaw-gmail-fetch

**Trigger:** Cron (every 15 minutes)
**Purpose:** Poll Gmail for new/updated threads and push them to OpenClaw for processing.

```
Cron Trigger (15 min)
    |
    v
Gmail Node: List threads modified since last run
    |
    v
Loop: For each new thread
    |
    v
Gmail Node: Get full thread content
    |
    v
HTTP Request: POST to OpenClaw /webhooks/n8n
    Body: { type: "gmail.new_email", data: { thread_id, messages, subject, sender } }
    |
    v
Save last-run timestamp
```

**Why n8n for Gmail polling:** The Gmail API quota (250 units/day) requires careful management. n8n tracks the last-run timestamp and only fetches modified threads, minimizing API calls. If OpenClaw's cron scheduler is down, n8n continues polling independently.

**Fallback:** The [[Orchestrator]] has a backup cron job that polls Gmail directly every 15 minutes. This provides redundancy if n8n is unavailable.

### 2. openclaw-ghl-inbound

**Trigger:** GHL webhook (real-time)
**Purpose:** Receive GHL events, normalize them, and forward to OpenClaw.

```
GHL Webhook Trigger
    |
    v
Switch: Route by event type
    +-- contact.created / contact.updated
    |       |
    |       v
    |   Transform: Normalize GHL contact to OpenClaw format
    |       |
    |       v
    |   HTTP Request: POST to OpenClaw /webhooks/ghl
    |
    +-- opportunity.created / opportunity.status_changed
    |       |
    |       v
    |   Transform: Map GHL pipeline stage to OpenClaw status
    |       |
    |       v
    |   HTTP Request: POST to OpenClaw /webhooks/ghl
    |
    +-- task.completed
            |
            v
        Transform: Map GHL task to OpenClaw format
            |
            v
        HTTP Request: POST to OpenClaw /webhooks/ghl
```

**Sub-account routing:** The workflow inspects `locationId` in the GHL payload to determine which business the event belongs to and tags the forwarded event accordingly.

### 3. openclaw-ghl-task-create

**Trigger:** OpenClaw webhook (when a task needs GHL sync)
**Purpose:** Create or update tasks in GHL when OpenClaw tasks are created.

```
Webhook Trigger (from OpenClaw)
    |
    v
Lookup: Resolve GHL location from project_id
    |
    v
Lookup: Find or create GHL contact
    |
    v
GHL API: Create task
    |
    v
HTTP Response: Return GHL task ID to OpenClaw
```

**Gated by:** `ENABLE_GHL_WRITE` feature flag on the OpenClaw side. n8n only receives the request if OpenClaw decides to send it.

### 4. openclaw-ghl-contact-note

**Trigger:** OpenClaw webhook (when a contact interaction is logged)
**Purpose:** Add notes to GHL contacts when OpenClaw processes messages or creates contact records.

```
Webhook Trigger (from OpenClaw)
    |
    v
Lookup: Find GHL contact by email or phone
    |
    v
If found:
    |
    v
GHL API: Add note to contact
    Body: { body: "[OpenClaw] [summary of interaction]" }
    |
    v
HTTP Response: Confirm note added

If not found:
    |
    v
GHL API: Create contact
    |
    v
GHL API: Add note to new contact
    |
    v
HTTP Response: Return new GHL contact ID
```

## Communication Pattern

### OpenClaw to n8n

OpenClaw triggers n8n workflows via webhook URLs or the n8n REST API:

```typescript
// Trigger an n8n workflow
await fetch(`${config.n8n.baseUrl}/api/v1/workflows/${workflowId}/activate`, {
  method: 'POST',
  headers: { 'X-N8N-API-KEY': config.n8n.apiKey },
});
```

### n8n to OpenClaw

n8n sends events to OpenClaw's webhook endpoints:

- `POST /webhooks/n8n` -- General event ingestion (Gmail, Drive, Calendar)
- `POST /webhooks/ghl` -- GHL-specific events (routed through n8n for normalization)

Both endpoints verify the sender using `N8N_API_KEY` or `GHL_API_KEY` respectively.

## Error Handling

| Scenario | n8n Behavior |
|---|---|
| GHL API error | Retry up to 3 times with exponential backoff |
| OpenClaw webhook down | Queue event, retry when available |
| Gmail quota exceeded | Skip poll, try next cycle |
| Invalid webhook payload | Log error, skip event |

## Code References

- n8n webhook handler: `src/server/routes/webhooks.ts` (`/webhooks/n8n`)
- GHL webhook handler: `src/server/routes/webhooks.ts` (`/webhooks/ghl`)
- Configuration: `src/config/index.ts` (`n8n.*`)

## Related Pages

- [[GoHighLevel Integration]] for GHL-specific operations
- [[Gmail Integration]] for email polling details
- [[Orchestrator]] for how n8n events are routed internally
- [[Environment Variables]] for n8n configuration
- [[Deployment]] for n8n hosting details
