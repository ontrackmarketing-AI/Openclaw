---
title: GoHighLevel Integration
aliases: [GHL, GoHighLevel, CRM, HighLevel]
tags: [integration, ghl, crm, gohighlevel, n8n]
created: 2026-03-31
---

# GoHighLevel Integration

GoHighLevel (GHL) is the CRM platform used across Bryson's businesses. OpenClaw integrates with GHL for contact management, task creation, and pipeline updates. All GHL operations are routed through [[n8n Workflows]] rather than direct API calls.

## Why GHL Goes Through n8n

Direct GHL API integration was considered and rejected for several reasons:

1. **Sub-account routing** -- Bryson manages multiple GHL sub-accounts (one per client/business). n8n handles the routing logic and credential management per sub-account.
2. **Webhook transformation** -- GHL webhook payloads vary by event type and need normalization before OpenClaw can process them.
3. **Rate limiting** -- n8n provides built-in retry and rate limiting that would need to be reimplemented in Node.js.
4. **Visual debugging** -- n8n's execution log makes it easy to debug GHL data flow without code changes.
5. **Decoupling** -- If GHL's API changes, only the n8n workflows need updating, not the OpenClaw codebase.

See [[Decision Log#GHL via n8n]] for the full reasoning.

## GHL API

### Authentication

GHL uses API keys scoped to locations (sub-accounts).

| Credential | Purpose |
|---|---|
| `GHL_API_KEY` | API key for the primary GHL location |
| `GHL_LOCATION_ID` | Default location (sub-account) ID |

These credentials are stored in the `.env` file and passed to n8n workflows. See [[Environment Variables]].

### Sub-Account Routing

Each of Bryson's businesses may have its own GHL sub-account:

| Business | GHL Sub-Account | Usage |
|---|---|---|
| SWRE | SW Recovery Services location | Debtor contacts, payment tracking |
| Helium Solutions | Helium location | Client contacts, project pipelines |
| OnTrack Marketing | OnTrack location | Lead management, campaigns |

n8n workflows accept a `location_id` parameter to route operations to the correct sub-account.

## Operations

### Contact Creation

When the [[Inbox Agent]] or [[Ingestion Agent]] identifies a new contact:

1. OpenClaw creates a contact record in [[PostgreSQL]] `contacts` table
2. If `ENABLE_GHL_WRITE` is `true`, a webhook is sent to the [[n8n Workflows]] `openclaw-ghl-contact-note` workflow
3. n8n creates or updates the contact in the appropriate GHL sub-account
4. n8n adds a note to the GHL contact with the context from OpenClaw

### Task Creation

When a task needs to be reflected in GHL:

1. Task is created in [[PostgreSQL]] `tasks` table
2. The [[n8n Workflows]] `openclaw-ghl-task-create` workflow picks up the task
3. n8n creates a corresponding task in GHL linked to the right contact and pipeline

### Pipeline Updates

When project status changes or deals progress:

1. [[Orchestrator]] detects a project state change
2. Sends update to n8n with project ID and new status
3. n8n maps OpenClaw project status to GHL pipeline stage
4. GHL opportunity is updated

### Inbound Events

GHL sends webhook events to OpenClaw when activity occurs in the CRM:

| Event Type | Description | OpenClaw Action |
|---|---|---|
| `contact.created` | New contact added in GHL | Log event, create contact in PostgreSQL if new |
| `contact.updated` | Contact details changed | Sync updates to PostgreSQL contacts |
| `opportunity.created` | New deal/opportunity | Log, potentially create project task |
| `opportunity.status_changed` | Pipeline stage change | Log, update project context |
| `task.completed` | GHL task marked done | Sync to PostgreSQL tasks table |

Inbound webhooks arrive at `POST /webhooks/ghl` and are verified using HMAC-SHA256 signature validation.

## Webhook Security

GHL webhook payloads are signed with the GHL API key:

```typescript
function verifyGhlSignature(
  payload: string,
  signature: string | undefined,
  secret: string,
): boolean {
  if (!signature) return false;
  const expected = crypto
    .createHmac("sha256", secret)
    .update(payload)
    .digest("hex");
  return crypto.timingSafeEqual(
    Buffer.from(signature),
    Buffer.from(expected),
  );
}
```

The signature is sent in the `X-GHL-Signature` header.

## Feature Flag

All GHL write operations are gated by `ENABLE_GHL_WRITE` (default: `false`).

- When `false`: OpenClaw receives GHL webhooks and logs them, but never writes back to GHL
- When `true`: OpenClaw can create contacts, tasks, and update pipelines in GHL via n8n

This follows the same safety pattern as [[Gmail Integration]]'s send flag.

## Environment Variables

| Variable | Required | Description |
|---|---|---|
| `GHL_API_KEY` | No | GHL API key for webhook verification and n8n auth |
| `GHL_LOCATION_ID` | No | Default GHL location (sub-account) ID |
| `ENABLE_GHL_WRITE` | No | Feature flag for GHL write operations (default: `false`) |

See [[Environment Variables]] for the complete list.

## Code References

- Webhook handler: `src/server/routes/webhooks.ts` (`/webhooks/ghl`)
- Configuration: `src/config/index.ts` (`ghl.*`, `features.ghlWrite`)

## Related Pages

- [[n8n Workflows]] for the workflows that bridge OpenClaw and GHL
- [[Orchestrator]] for how GHL events are routed
- [[Contacts]] for contact synchronization
- [[Project Registry]] for project-to-GHL mapping
- [[Environment Variables]] for GHL configuration
- [[Security]] for webhook verification details
