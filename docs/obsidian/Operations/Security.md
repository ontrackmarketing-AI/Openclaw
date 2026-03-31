---
title: Security
aliases: [Security Model, Access Control, Compliance]
tags: [operations, security, compliance, secrets, oauth2, tailscale]
created: 2026-03-31
---

# Security

OpenClaw handles sensitive business data across multiple channels and clients. This page documents the security model, secret management, compliance requirements, and access controls.

## Secret Management

### Environment Variables

All secrets are stored in `.env` files and loaded via `dotenv`. Secrets are **never** hardcoded in source code, committed to version control, or logged.

The `.env` file is listed in `.gitignore`. Only `.env.example` (with empty values) is committed.

See [[Environment Variables]] for the complete list of secrets and where to obtain them.

### Zod Validation

All environment variables are validated at startup using Zod schemas in `src/config/index.ts`. If a required variable is missing or malformed, the application fails fast with a clear error message listing the missing variables.

### Production Requirements

In production (`NODE_ENV=production`), the following variables are strictly required:

| Variable | Why Required |
|---|---|
| `APP_SECRET` | API authentication for all endpoints |
| `TELEGRAM_BOT_TOKEN` | Primary user interface |
| `ANTHROPIC_API_KEY` | Core agent reasoning |

Missing any of these causes a startup failure with an explicit error.

## OAuth2 Security

### Token Management

Google OAuth2 tokens (used by [[Gmail Integration]], [[Google Calendar Integration]], [[Google Drive Integration]]) follow these rules:

1. **Refresh tokens** are stored in `GOOGLE_REFRESH_TOKEN` environment variable
2. **Access tokens** are ephemeral (1-hour lifetime) and managed by the `googleapis` client
3. **Token refresh** happens automatically when the access token expires
4. **No tokens in logs** -- the logger is configured to redact authorization headers

### Scope Minimization

OAuth scopes are limited to what is needed:

| Scope | Justification |
|---|---|
| `gmail.readonly` | Read threads for triage |
| `gmail.compose` | Create drafts (not send) |
| `gmail.send` | Gated by `ENABLE_GMAIL_SEND` flag (default: disabled) |
| `gmail.modify` | Mark as read, apply labels |
| `calendar.readonly` | Read events for pre-briefs |
| `drive.readonly` | Read documents for research |

## Network Security (Tailscale)

### Tailscale VPN

All inter-machine communication uses Tailscale, a WireGuard-based mesh VPN:

```
+--------------------+         Tailscale         +--------------------+
|  AWS EC2           | <-----------------------> |  Mac mini           |
|  (OpenClaw)        |     Encrypted tunnel      |  (iMessage Bridge)  |
|  100.x.x.x        |                           |  100.y.y.y          |
+--------------------+                           +--------------------+
         |
         | Tailscale
         v
+--------------------+
|  SWRE Qdrant       |
|  (Read-only)       |
|  100.z.z.z         |
+--------------------+
```

### What Tailscale Protects

| Connection | Without Tailscale | With Tailscale |
|---|---|---|
| EC2 to Mac mini (iMessage Bridge) | Would need public IP + firewall rules | Private mesh, no public exposure |
| EC2 to SWRE Qdrant | Would need VPC peering or public access | Private mesh, no public exposure |
| SSH access to EC2 | Open port 22 to internet | SSH over Tailscale only |

### iMessage Bridge Security

The [[iMessage Bridge]] has three layers of security:

1. **Tailscale** -- Bridge is only reachable via Tailscale IP (no public DNS, no port forwarding)
2. **Shared secret** -- Every request requires `Authorization: Bearer {IMESSAGE_BRIDGE_SECRET}`
3. **Bind address** -- Bridge binds to Tailscale interface or localhost only

## FDCPA/TCPA Compliance

Bryson operates SW Recovery Services (SWRE), which deals with debt collection. This creates specific compliance requirements:

### FDCPA (Fair Debt Collection Practices Act)

| Rule | OpenClaw Implementation |
|---|---|
| No disclosure of debts to third parties | SWRE debtor data stays in SWRE's Qdrant instance; OpenClaw has read-only access and never writes debtor data to its own databases |
| No harassing or oppressive conduct | Automated sending is disabled by default (`ENABLE_GMAIL_SEND=false`) |
| No deceptive communications | All draft replies are reviewed by Bryson before sending |
| Time-of-day restrictions | Optional quiet hours configuration prevents automated outreach during restricted times |

### TCPA (Telephone Consumer Protection Act)

| Rule | OpenClaw Implementation |
|---|---|
| No auto-dialing without consent | OpenClaw does not make phone calls |
| Text message restrictions | iMessage sending is gated by `ENABLE_IMESSAGE` flag and requires approval |

### Namespace Separation

SWRE data is strictly separated from OpenClaw's operational data:

| Data Store | OpenClaw Access | SWRE Access |
|---|---|---|
| OpenClaw PostgreSQL | Read/write | None |
| OpenClaw Qdrant | Read/write | None |
| SWRE Qdrant (`QDRANT_SWRE_URL`) | **Read-only** | Read/write (separate system) |

The SWRE Qdrant client is configured at the code level to use only read operations:

```typescript
// SWRE client - read-only, never write
const qdrantSwre = new QdrantClient({
  url: config.qdrant.swreUrl,
});
// Only search() and scroll() are ever called on this client
// No upsert(), delete(), or createCollection() calls
```

## PII Handling

### What PII OpenClaw Stores

| Data | Where | Retention |
|---|---|---|
| Contact names, emails, phones | [[PostgreSQL]] `contacts` | Indefinite (business records) |
| Email thread summaries | [[PostgreSQL]] `inbox_events` | Indefinite |
| Email content embeddings | [[Qdrant]] `bryson_emails` | Indefinite |
| Notebook text | [[PostgreSQL]] `notes` + [[Qdrant]] `bryson_notes` | Indefinite |

### What OpenClaw Does NOT Store

- Full email bodies (only summaries)
- SWRE debtor personal information (stays in SWRE's systems)
- Credit card or bank account numbers
- Social Security Numbers
- Passwords or credentials (only in `.env`)

### Data Minimization

- Email threads are summarized by Claude before storage; raw bodies are not persisted
- Only relevant contact fields are stored (name, email, phone, project associations)
- Agent logs contain metadata, not full payload contents

## Agent Log Retention

Agent logs in the [[PostgreSQL]] `agent_logs` table are retained for 90 days. A scheduled cleanup job removes logs older than the retention period:

| Log Type | Retention | Rationale |
|---|---|---|
| Agent action logs | 90 days | Audit trail for debugging and compliance |
| Escalation records | Indefinite | Decision history |
| Inbox events | Indefinite | Communication record |

## API Authentication

All API endpoints (except `/health` and `/webhooks/telegram`) require authentication:

```
Authorization: Bearer {APP_SECRET}
```

The `APP_SECRET` is validated by middleware in `src/server/middleware/auth.ts`. See [[API Reference]] for endpoint details.

### Paths That Skip Auth

| Path | Reason |
|---|---|
| `/health` | Public health check for load balancers |
| `/webhooks/telegram` | Uses its own Telegram secret token verification |

## Feature Flags as Safety Gates

Three feature flags gate all write operations to external services:

| Flag | Default | Controls |
|---|---|---|
| `ENABLE_GMAIL_SEND` | `false` | Whether the system can send emails (not just draft) |
| `ENABLE_IMESSAGE` | `false` | Whether iMessage processing and sending is active |
| `ENABLE_GHL_WRITE` | `false` | Whether the system can write to GoHighLevel CRM |

These flags default to `false` in both development and production. They must be explicitly enabled after the system has proven reliable. See [[Decision Log#Feature Flags]] for reasoning.

## Code References

- Environment validation: `src/config/index.ts` (Zod schema)
- Auth middleware: `src/server/middleware/auth.ts`
- Telegram auth: `src/telegram/bot.ts` (`isBryson`, `guardBryson`)
- SWRE Qdrant client: `src/db/qdrant.ts` (`qdrantSwre`)

## Related Pages

- [[Environment Variables]] for all secret configuration
- [[iMessage Bridge]] for bridge security details
- [[Gmail Integration]] for OAuth2 and send flag
- [[GoHighLevel Integration]] for GHL write flag
- [[Deployment]] for infrastructure security
- [[Decision Log]] for security-related decisions
