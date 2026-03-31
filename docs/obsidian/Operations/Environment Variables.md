---
title: Environment Variables
aliases: [Env Vars, Configuration, .env]
tags: [operations, configuration, environment, secrets]
created: 2026-03-31
---

# Environment Variables

Every configuration value in OpenClaw is managed via environment variables, loaded from `.env` files using `dotenv`, and validated at startup using Zod schemas. This page documents every variable, grouped by service.

## Validation

All variables are validated in `src/config/index.ts` using a Zod schema. The application fails fast on startup if required variables are missing or malformed.

```typescript
const envSchema = z.object({
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  PORT: z.string().default("3000").transform(Number),
  // ... all other variables
});
```

## Application Core

| Variable | Required | Default | Description | Where to Get |
|---|---|---|---|---|
| `NODE_ENV` | No | `development` | Runtime environment: `development`, `production`, or `test` | Set manually |
| `PORT` | No | `3000` | HTTP server port | Set manually |
| `APP_SECRET` | Prod only | `dev-secret-change-me` | API authentication token. All API requests must include `Authorization: Bearer {APP_SECRET}` | Generate: `openssl rand -hex 32` |

## Database

| Variable | Required | Default | Description | Where to Get |
|---|---|---|---|---|
| `DATABASE_URL` | Yes | None | PostgreSQL connection string | Format: `postgresql://user:pass@host:5432/dbname`. Local dev: `postgresql://openclaw:openclaw@localhost:5432/openclaw` |
| `REDIS_URL` | Yes | None | Redis connection string | Format: `redis://host:6379`. Local dev: `redis://localhost:6379` |
| `QDRANT_URL` | Yes | None | Qdrant HTTP API URL | Local dev: `http://localhost:6334`. Production: `http://localhost:6334` (same host) |
| `QDRANT_SWRE_URL` | No | None | SWRE Qdrant instance URL (read-only access) | Tailscale IP of SWRE server: `http://100.118.235.86:6333` |

See [[PostgreSQL]], [[Redis]], [[Qdrant]] for database details.

## Telegram

| Variable | Required | Default | Description | Where to Get |
|---|---|---|---|---|
| `TELEGRAM_BOT_TOKEN` | Prod only | None | Bot API token | Create bot via [@BotFather](https://t.me/BotFather) on Telegram. Token format: `123456:ABC-DEF1234ghIkl-zyx57W2v1u123ew11` |
| `TELEGRAM_WEBHOOK_SECRET` | No | None | Secret token for webhook verification | Generate: `openssl rand -hex 16` |
| `TELEGRAM_BRYSON_CHAT_ID` | Prod only | None | Bryson's Telegram chat ID (authorization) | Send `/start` to the bot, check server logs for the chat ID, or use @userinfobot |

See [[Telegram Bot]] for bot setup details.

## Google OAuth & Services

All three Google integrations ([[Gmail Integration]], [[Google Calendar Integration]], [[Google Drive Integration]]) share one set of OAuth2 credentials.

| Variable | Required | Default | Description | Where to Get |
|---|---|---|---|---|
| `GOOGLE_CLIENT_ID` | For Google | None | OAuth2 client ID | Google Cloud Console > APIs & Services > Credentials > OAuth 2.0 Client IDs |
| `GOOGLE_CLIENT_SECRET` | For Google | None | OAuth2 client secret | Same location as client ID |
| `GOOGLE_REDIRECT_URI` | For Google | None | OAuth2 redirect URI | Must match the URI configured in Google Cloud Console. Local dev: `http://localhost:3000/auth/google/callback` |
| `GOOGLE_REFRESH_TOKEN` | For Google | None | Offline refresh token | Obtained during initial OAuth flow. Must request with `access_type=offline` and `prompt=consent` |
| `GOOGLE_DRIVE_WATCH_FOLDER_ID` | No | None | Google Drive folder ID for notebook photo watching | Open the folder in Drive, copy the ID from the URL: `https://drive.google.com/drive/folders/{THIS_ID}` |

### Obtaining the Refresh Token

1. Set up OAuth consent screen in Google Cloud Console
2. Create OAuth 2.0 credentials (Web Application type)
3. Add redirect URI
4. Navigate to the authorization URL with all required scopes:
   ```
   https://accounts.google.com/o/oauth2/v2/auth?
     client_id={CLIENT_ID}&
     redirect_uri={REDIRECT_URI}&
     response_type=code&
     scope=https://www.googleapis.com/auth/gmail.readonly+
           https://www.googleapis.com/auth/gmail.compose+
           https://www.googleapis.com/auth/gmail.send+
           https://www.googleapis.com/auth/gmail.modify+
           https://www.googleapis.com/auth/calendar.readonly+
           https://www.googleapis.com/auth/drive.readonly&
     access_type=offline&
     prompt=consent
   ```
5. Authorize and capture the `code` from the redirect
6. Exchange the code for tokens:
   ```bash
   curl -X POST https://oauth2.googleapis.com/token \
     -d code={CODE} \
     -d client_id={CLIENT_ID} \
     -d client_secret={CLIENT_SECRET} \
     -d redirect_uri={REDIRECT_URI} \
     -d grant_type=authorization_code
   ```
7. Save the `refresh_token` from the response as `GOOGLE_REFRESH_TOKEN`

## AI Providers

| Variable | Required | Default | Description | Where to Get |
|---|---|---|---|---|
| `ANTHROPIC_API_KEY` | Prod only | None | Anthropic API key for Claude (primary LLM) | [console.anthropic.com](https://console.anthropic.com) > API Keys |
| `OPENAI_API_KEY` | No | None | OpenAI API key for embeddings (`text-embedding-3-small`) | [platform.openai.com](https://platform.openai.com) > API Keys |
| `TAVILY_API_KEY` | No | None | Tavily API key for web search | [tavily.com](https://tavily.com) > Dashboard > API Keys |

See [[Tech Stack]] for which AI providers are used where.

## iMessage Bridge

| Variable | Required | Default | Description | Where to Get |
|---|---|---|---|---|
| `IMESSAGE_BRIDGE_URL` | No | None | URL of the iMessage bridge on Mac mini | Tailscale IP + port: `http://100.y.y.y:4000` |
| `IMESSAGE_BRIDGE_SECRET` | No | None | Shared secret for bridge authentication | Generate: `openssl rand -hex 32`. Must match `BRIDGE_SECRET` on the Mac mini |
| `ENABLE_IMESSAGE` | No | `false` | Feature flag to enable iMessage processing | Set to `true` only when Mac mini bridge is running |

See [[iMessage Bridge]] for bridge setup. The bridge has its own `.env.example` in `imessage-bridge/`:

| Bridge Variable | Default | Description |
|---|---|---|
| `PORT` | `4000` | Bridge HTTP server port |
| `BRIDGE_SECRET` | None | Must match `IMESSAGE_BRIDGE_SECRET` on the OpenClaw server |
| `BIND_ADDRESS` | `0.0.0.0` | Network interface to bind to (use Tailscale IP in production) |

## GoHighLevel CRM

| Variable | Required | Default | Description | Where to Get |
|---|---|---|---|---|
| `GHL_API_KEY` | No | None | GHL API key for the primary location | GHL Dashboard > Settings > API |
| `GHL_LOCATION_ID` | No | None | Default GHL location (sub-account) ID | GHL Dashboard > Settings > Business Info |
| `ENABLE_GHL_WRITE` | No | `false` | Feature flag for GHL write operations | Set to `true` only after testing GHL integration |

See [[GoHighLevel Integration]] for GHL details.

## n8n Workflows

| Variable | Required | Default | Description | Where to Get |
|---|---|---|---|---|
| `N8N_BASE_URL` | No | None | URL of the n8n instance | Self-hosted: `http://localhost:5678`. Remote: Tailscale IP |
| `N8N_API_KEY` | No | None | n8n API key for workflow triggering | n8n Settings > API > Create API Key |

See [[n8n Workflows]] for workflow details.

## Feature Flags

All feature flags default to `false` and must be explicitly enabled.

| Variable | Default | Controls | Risk if Enabled |
|---|---|---|---|
| `ENABLE_IMESSAGE` | `false` | iMessage sub-agent and bridge communication | Requires Mac mini running; bridge errors if unavailable |
| `ENABLE_GMAIL_SEND` | `false` | Whether the system can send (not just draft) emails | Autonomous email sending carries reputation risk |
| `ENABLE_GHL_WRITE` | `false` | Whether the system can write to GHL CRM | Could create duplicate contacts or incorrect pipeline changes |

See [[Security]] for why these default to disabled.

## Grouped by Deployment Stage

### Minimum for Local Development

```env
NODE_ENV=development
DATABASE_URL=postgresql://openclaw:openclaw@localhost:5432/openclaw
REDIS_URL=redis://localhost:6379
QDRANT_URL=http://localhost:6334
```

### Add for Telegram Testing

```env
TELEGRAM_BOT_TOKEN=your-bot-token
# TELEGRAM_BRYSON_CHAT_ID left unset (allows all users in dev)
```

### Add for Google Integration Testing

```env
GOOGLE_CLIENT_ID=your-client-id
GOOGLE_CLIENT_SECRET=your-client-secret
GOOGLE_REDIRECT_URI=http://localhost:3000/auth/google/callback
GOOGLE_REFRESH_TOKEN=your-refresh-token
```

### Add for AI Features

```env
ANTHROPIC_API_KEY=your-anthropic-key
OPENAI_API_KEY=your-openai-key
TAVILY_API_KEY=your-tavily-key
```

### Full Production

All of the above plus:

```env
NODE_ENV=production
APP_SECRET=generated-secret
TELEGRAM_WEBHOOK_SECRET=generated-secret
TELEGRAM_BRYSON_CHAT_ID=actual-chat-id
QDRANT_SWRE_URL=http://100.118.235.86:6333
IMESSAGE_BRIDGE_URL=http://100.y.y.y:4000
IMESSAGE_BRIDGE_SECRET=generated-secret
GHL_API_KEY=your-ghl-key
GHL_LOCATION_ID=your-location-id
N8N_BASE_URL=http://localhost:5678
N8N_API_KEY=your-n8n-key
```

## Code References

- Schema and validation: `src/config/index.ts`
- Example file: `.env.example`
- Bridge example: `imessage-bridge/.env.example`

## Related Pages

- [[Security]] for secret management practices
- [[Deployment]] for environment-specific setup
- [[Gmail Integration]] for Google OAuth setup
- [[iMessage Bridge]] for bridge configuration
- [[GoHighLevel Integration]] for GHL credentials
- [[n8n Workflows]] for n8n configuration
