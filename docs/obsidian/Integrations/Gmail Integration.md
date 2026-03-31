---
title: Gmail Integration
aliases: [Gmail, Email Integration, Gmail API]
tags: [integration, gmail, google, email, oauth2]
created: 2026-03-31
---

# Gmail Integration

OpenClaw monitors Bryson's Gmail inbox, triages threads, drafts contextual replies, and extracts action items -- all without Bryson needing to open Gmail.

## Authentication

Gmail access uses Google OAuth2 with offline refresh tokens.

### OAuth2 Setup

1. Create a Google Cloud project
2. Enable the Gmail API
3. Configure OAuth consent screen (internal or external)
4. Create OAuth2 credentials (Web Application type)
5. Set redirect URI to match `GOOGLE_REDIRECT_URI`
6. Complete the OAuth flow to obtain a refresh token
7. Store the refresh token as `GOOGLE_REFRESH_TOKEN`

### Required Scopes

| Scope | Purpose |
|---|---|
| `https://www.googleapis.com/auth/gmail.readonly` | Read email threads and messages |
| `https://www.googleapis.com/auth/gmail.compose` | Create drafts |
| `https://www.googleapis.com/auth/gmail.send` | Send emails (gated by feature flag) |
| `https://www.googleapis.com/auth/gmail.modify` | Mark as read, apply labels |

### Environment Variables

| Variable | Required | Description |
|---|---|---|
| `GOOGLE_CLIENT_ID` | Yes (for Gmail) | OAuth2 client ID |
| `GOOGLE_CLIENT_SECRET` | Yes (for Gmail) | OAuth2 client secret |
| `GOOGLE_REDIRECT_URI` | Yes (for Gmail) | OAuth2 redirect URI |
| `GOOGLE_REFRESH_TOKEN` | Yes (for Gmail) | Offline refresh token |

See [[Environment Variables]] for the complete list.

## Thread Fetching

Gmail threads are fetched every 15 minutes via the [[n8n Workflows]] `openclaw-gmail-fetch` workflow. This acts as the primary polling mechanism.

**Fetch logic:**
1. Query Gmail API for threads modified since last check
2. For each new/updated thread, fetch full message content
3. POST to OpenClaw API endpoint for [[Inbox Agent]] processing

**Fallback:** A cron job in the [[Orchestrator]] also polls Gmail directly as a backup if n8n is down.

## Draft Composition

When the [[Inbox Agent]] determines a reply is needed:

1. Claude generates a contextual reply based on:
   - Full thread history
   - Sender's contact record and project associations
   - Recent related tasks and notes
2. A Gmail draft is created via the API (`gmail.users.drafts.create`)
3. An approval message is sent to Bryson via [[Telegram Bot]] with inline keyboard

The draft remains in Gmail's Drafts folder. Bryson can edit it there or approve/send via Telegram.

## Rate Limits

Gmail API uses a quota system:

| Limit | Value | Tracking |
|---|---|---|
| Daily quota units | 250 per user per day | [[Redis]] key `ratelimit:gmail:{date}` |
| Queries per second | 1 per second | Built-in backoff |

**Quota costs for common operations:**

| Operation | Quota Cost |
|---|---|
| `messages.list` | 5 units |
| `messages.get` | 5 units |
| `threads.list` | 5 units |
| `threads.get` | 5 units |
| `drafts.create` | 10 units |
| `messages.send` | 25 units |

With 250 units/day and 15-minute polling, the system budgets approximately:
- 96 polls/day x 5 units = 480 units (exceeds daily limit)
- Solution: Only fetch threads modified since last successful poll, cache thread IDs in Redis

## Why Send Is Disabled By Default

The `ENABLE_GMAIL_SEND` feature flag defaults to `false`. Reasons:

1. **Safety** -- An autonomous system sending emails as Bryson carries reputation risk
2. **FDCPA/TCPA compliance** -- Some of Bryson's clients are in regulated industries (bail bonds). Automated outbound communications could create compliance issues. See [[Security]].
3. **Approval workflow** -- The draft-then-approve pattern is safer and gives Bryson final control
4. **Incremental trust** -- The flag can be enabled once the system has proven reliable

Even with the flag enabled, the [[Inbox Agent]] still routes send actions through Telegram approval. The flag controls whether the final "send" API call is permitted.

## Error Handling

| Error | Response |
|---|---|
| OAuth token expired | Automatic refresh via `googleapis` client |
| Rate limit exceeded | Log warning, skip poll, retry next cycle |
| API 5xx error | Retry with exponential backoff (BullMQ) |
| Thread not found | Skip, log as deleted/moved |

## Code References

- Google OAuth client: `src/integrations/` (googleapis setup)
- Configuration: `src/config/index.ts` (`google.*` and `features.gmailSend`)
- n8n workflow: `openclaw-gmail-fetch` (see [[n8n Workflows]])

## Related Pages

- [[Inbox Agent]] for how email content is processed
- [[n8n Workflows]] for the polling workflow
- [[Telegram Bot]] for draft approval flow
- [[Security]] for compliance considerations
- [[Environment Variables]] for configuration
- [[Redis]] for rate limiting and deduplication
