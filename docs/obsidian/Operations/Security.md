---
title: Security
aliases: [Security & Compliance, Access Control]
tags: [operations, security, compliance, secrets, oauth]
created: 2026-03-31
---

# Security

OpenClaw handles sensitive business data across multiple channels. This page documents secrets management, access control, compliance considerations, and logging rules.

## Secrets Management

### Where Secrets Live

| Secret Type | Storage | Access |
|---|---|---|
| API keys (Anthropic, OpenAI, Tavily) | `.env` file (not committed) | `src/config/index.ts` via Zod validation |
| Google OAuth tokens | `.env` file | Refreshed automatically by `googleapis` client |
| Telegram bot token | `.env` file | Loaded at startup |
| iMessage bridge secret | `.env` file on both servers | Shared between EC2 and Mac mini |
| GHL API key | n8n credential store | Managed in n8n UI, never in OpenClaw code |
| Database passwords | `.env` file / Docker Compose | Local dev uses defaults; production uses strong passwords |

### Rules

1. **Never commit `.env` files.** The `.env` file is in `.gitignore`.
2. **Never log secrets.** Winston logger is configured to redact known secret patterns.
3. **Never include secrets in Telegram messages.** No API keys, tokens, or passwords in bot messages.
4. **Never include secrets in error messages.** Catch blocks sanitize before logging.
5. **Rotate on compromise.** If any key is suspected compromised, rotate immediately and update `.env`.

### Production Secret Management

In production (AWS EC2):
- Secrets stored in AWS Systems Manager Parameter Store (encrypted)
- Loaded into environment at deploy time
- Never stored on disk in plaintext (except briefly in memory)

## OAuth2 Security

### Google OAuth

- **Token type:** Offline refresh token (long-lived)
- **Scopes:** Minimal required per integration (see [[Gmail Integration]], [[Google Calendar Integration]], [[Google Drive Integration]])
- **Token refresh:** Automatic via `googleapis` client library
- **Revocation:** Can be revoked at https://myaccount.google.com/permissions

### Token Storage

The refresh token is stored as `GOOGLE_REFRESH_TOKEN` in the `.env` file. Access tokens are ephemeral and managed in-memory by the googleapis client.

## Network Security (Tailscale)

Tailscale provides a zero-config mesh VPN connecting:

1. **AWS EC2 instance** (OpenClaw primary server)
2. **Mac mini** (iMessage bridge)
3. **SWRE Qdrant instance** (vector database, read-only access)

### Why Tailscale

- **No public exposure:** The iMessage bridge and SWRE Qdrant are never exposed to the public internet
- **WireGuard-based:** Industry-standard encrypted tunneling
- **Zero config:** No firewall rules, no port forwarding, no VPN server management
- **Identity-based:** Access is tied to Tailscale accounts, not IP addresses

### Network Topology

```
┌──────────────┐    Tailscale     ┌──────────────┐
│  EC2 Instance │ ◄────────────→ │  Mac mini     │
│  (OpenClaw)   │    100.x.x.x   │  (iMessage)   │
│               │                 │               │
│  Public IP:   │    Tailscale    │  No public IP │
│  accessible   │ ◄────────────→ │               │
└──────────────┘                 └──────────────┘
        │
        │ Tailscale
        ▼
┌──────────────┐
│  SWRE Qdrant  │
│  (read-only)  │
│  No public IP │
└──────────────┘
```

## Compliance

### FDCPA (Fair Debt Collection Practices Act)

Relevant because of the A to Z Bail Bonds project. See [[Project Registry]].

| Rule | OpenClaw Implementation |
|---|---|
| No automated debt collection communications | All outbound messages require Bryson's approval |
| Time-of-day restrictions | Business hours enforcement in [[Notification Logic]] |
| Required disclosures | Draft templates include required language |
| Record keeping | All communications logged in [[PostgreSQL]] |

### TCPA (Telephone Consumer Protection Act)

| Rule | OpenClaw Implementation |
|---|---|
| No automated texts without consent | `ENABLE_IMESSAGE` defaults to `false`; sends require explicit approval |
| Opt-out compliance | Contact records track opt-out status |
| Time restrictions | Business hours enforcement |

### General Data Handling

| Principle | Implementation |
|---|---|
| Data minimization | Only store what is needed for processing |
| Access control | Single-user system (Bryson only) |
| Audit trail | `agent_logs` table records all agent actions |
| Encryption at rest | PostgreSQL and Qdrant on encrypted volumes |
| Encryption in transit | HTTPS for all API calls, Tailscale for internal |

## Feature Flags as Safety Gates

Three feature flags gate all write operations to external services:

| Flag | Default | Controls |
|---|---|---|
| `ENABLE_IMESSAGE` | `false` | iMessage read/send via Mac bridge |
| `ENABLE_GMAIL_SEND` | `false` | Gmail send (drafts always allowed) |
| `ENABLE_GHL_WRITE` | `false` | GoHighLevel create/update operations |

These are checked at the integration layer before any write operation. Even when enabled, write operations go through approval flows (see [[Escalation System]]).

## Logging Rules

### What Gets Logged

- All agent actions (agent_logs table)
- All API calls with status codes (Winston logger)
- All escalation lifecycle events
- All authentication events (token refresh, login)
- Processing duration for performance monitoring

### What Never Gets Logged

- Message body content in plain-text logs (summaries only)
- API keys or tokens
- OAuth refresh tokens
- Passwords
- Personal identifiers beyond what is needed for routing

### Log Levels

| Level | Usage |
|---|---|
| `error` | System failures, unhandled exceptions |
| `warn` | Rate limits hit, retry attempts, degraded functionality |
| `info` | Agent actions, event processing, standard operations |
| `debug` | Detailed processing steps (development only, never in production) |

## SWRE Read-Only Enforcement

The SWRE Qdrant instance is strictly read-only. This is enforced in code:

- The `qdrantSwre` client in `src/db/qdrant.ts` is a separate instance
- No write methods are called on this client
- The [[Research Agent]] only uses `search` operations against SWRE
- Code review must verify no write operations are added to the SWRE client

## Related Pages

- [[Environment Variables]] for all secret configuration
- [[Deployment]] for production infrastructure security
- [[iMessage Bridge]] for Tailscale setup
- [[Qdrant]] for SWRE read-only details
- [[Escalation System]] for approval workflows
- [[Gmail Integration]] for OAuth2 details
