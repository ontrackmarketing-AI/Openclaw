---
title: Environment Variables
aliases: [Env Vars, Configuration, .env]
tags: [operations, configuration, environment, secrets]
created: 2026-03-31
---

# Environment Variables

Every environment variable used by OpenClaw, documented with its purpose, source, and whether it is required. Configuration is validated at startup by Zod in `src/config/index.ts`.

## Application

| Variable | Required | Default | Description | Where to Get It |
|---|---|---|---|---|
| `NODE_ENV` | No | `development` | Environment: `development`, `production`, `test` | Set based on deploy target |
| `PORT` | No | `3000` | HTTP server port | Choose an available port |
| `APP_SECRET` | Production only | `dev-secret-change-me` | Application secret for signing/hashing | Generate: `openssl rand -hex 32` |

## Database

| Variable | Required | Default | Description | Where to Get It |
|---|---|---|---|---|
| `DATABASE_URL` | Yes | -- | PostgreSQL connection string | `postgresql://openclaw:openclaw@localhost:5432/openclaw` for dev |

## Redis

| Variable | Required | Default | Description | Where to Get It |
|---|---|---|---|---|
| `REDIS_URL` | Yes | -- | Redis connection string | `redis://localhost:6379` for dev |

## Qdrant

| Variable | Required | Default | Description | Where to Get It |
|---|---|---|---|---|
| `QDRANT_URL` | Yes | -- | Primary Qdrant instance URL | `http://localhost:6333` for dev |
| `QDRANT_SWRE_URL` | No | -- | SWRE Qdrant instance URL (read-only) | Tailscale IP of the SWRE Qdrant server |

## Telegram

| Variable | Required | Default | Description | Where to Get It |
|---|---|---|---|---|
| `TELEGRAM_BOT_TOKEN` | Production | -- | Bot API token | Create bot via @BotFather on Telegram |
| `TELEGRAM_WEBHOOK_SECRET` | No | -- | Webhook verification secret | Generate: `openssl rand -hex 16` |
| `TELEGRAM_BRYSON_CHAT_ID` | Production | -- | Bryson's Telegram chat ID | Send `/start` to the bot, check logs for chat ID |

See [[Telegram Bot]] for setup details.

## Google (OAuth2)

| Variable | Required | Default | Description | Where to Get It |
|---|---|---|---|---|
| `GOOGLE_CLIENT_ID` | For Google features | -- | OAuth2 client ID | Google Cloud Console > APIs & Services > Credentials |
| `GOOGLE_CLIENT_SECRET` | For Google features | -- | OAuth2 client secret | Same as above |
| `GOOGLE_REDIRECT_URI` | For Google features | -- | OAuth2 redirect URI | Set in Google Cloud Console, must match app config |
| `GOOGLE_REFRESH_TOKEN` | For Google features | -- | Offline refresh token | Obtained during OAuth2 authorization flow |
| `GOOGLE_DRIVE_WATCH_FOLDER_ID` | No | -- | Drive folder ID for notebook uploads | Open folder in Google Drive, copy ID from URL |

See [[Gmail Integration]], [[Google Calendar Integration]], [[Google Drive Integration]].

## AI Providers

| Variable | Required | Default | Description | Where to Get It |
|---|---|---|---|---|
| `ANTHROPIC_API_KEY` | Production | -- | Anthropic API key for Claude | https://console.anthropic.com/settings/keys |
| `OPENAI_API_KEY` | No | -- | OpenAI API key for embeddings | https://platform.openai.com/api-keys |
| `TAVILY_API_KEY` | No | -- | Tavily API key for web search | https://tavily.com (sign up for API key) |

## iMessage Bridge

| Variable | Required | Default | Description | Where to Get It |
|---|---|---|---|---|
| `IMESSAGE_BRIDGE_URL` | No | -- | URL of Mac bridge server | Tailscale IP + port (e.g., `http://100.x.x.x:3001`) |
| `IMESSAGE_BRIDGE_SECRET` | No | -- | Shared auth secret | Generate: `openssl rand -hex 32`, set on both servers |

See [[iMessage Bridge]] for architecture details.

## GoHighLevel

| Variable | Required | Default | Description | Where to Get It |
|---|---|---|---|---|
| `GHL_API_KEY` | No | -- | GHL API key | GHL Settings > Business Profile > API Key |
| `GHL_LOCATION_ID` | No | -- | Default GHL location/sub-account | GHL Settings > Business Profile > Location ID |

See [[GoHighLevel Integration]].

## n8n

| Variable | Required | Default | Description | Where to Get It |
|---|---|---|---|---|
| `N8N_BASE_URL` | No | -- | n8n instance URL | `http://localhost:5678` for local n8n |
| `N8N_API_KEY` | No | -- | n8n API key for workflow management | n8n Settings > API > Create API Key |

See [[n8n Workflows]].

## Feature Flags

| Variable | Required | Default | Description |
|---|---|---|---|
| `ENABLE_IMESSAGE` | No | `false` | Enable iMessage bridge integration |
| `ENABLE_GMAIL_SEND` | No | `false` | Enable Gmail send (drafts always work) |
| `ENABLE_GHL_WRITE` | No | `false` | Enable GoHighLevel write operations |

Feature flags use a boolean string format: `"true"`, `"false"`, `"1"`, `"0"`, or `""`. Empty string is treated as `false`.

See [[Security]] for why these default to `false`.

## Validation

All environment variables are validated at startup using Zod schemas in `src/config/index.ts`. If validation fails, the application exits with a clear error listing which variables are missing or invalid.

In production mode (`NODE_ENV=production`), the following are additionally required:
- `APP_SECRET`
- `TELEGRAM_BOT_TOKEN`
- `ANTHROPIC_API_KEY`

## Example .env File

```bash
# Application
NODE_ENV=development
PORT=3000
APP_SECRET=dev-secret-change-me

# Database
DATABASE_URL=postgresql://openclaw:openclaw@localhost:5432/openclaw

# Redis
REDIS_URL=redis://localhost:6379

# Qdrant
QDRANT_URL=http://localhost:6333
# QDRANT_SWRE_URL=http://100.x.x.x:6333

# Telegram
# TELEGRAM_BOT_TOKEN=your-bot-token
# TELEGRAM_WEBHOOK_SECRET=your-webhook-secret
# TELEGRAM_BRYSON_CHAT_ID=your-chat-id

# Google
# GOOGLE_CLIENT_ID=your-client-id
# GOOGLE_CLIENT_SECRET=your-client-secret
# GOOGLE_REDIRECT_URI=http://localhost:3000/auth/google/callback
# GOOGLE_REFRESH_TOKEN=your-refresh-token
# GOOGLE_DRIVE_WATCH_FOLDER_ID=your-folder-id

# AI
# ANTHROPIC_API_KEY=your-anthropic-key
# OPENAI_API_KEY=your-openai-key
# TAVILY_API_KEY=your-tavily-key

# iMessage (optional)
# IMESSAGE_BRIDGE_URL=http://100.x.x.x:3001
# IMESSAGE_BRIDGE_SECRET=your-shared-secret
ENABLE_IMESSAGE=false

# GHL (optional)
# GHL_API_KEY=your-ghl-key
# GHL_LOCATION_ID=your-location-id
ENABLE_GHL_WRITE=false

# n8n (optional)
# N8N_BASE_URL=http://localhost:5678
# N8N_API_KEY=your-n8n-key

# Feature Flags
ENABLE_GMAIL_SEND=false
```

## Related Pages

- [[Security]] for secrets management and compliance
- [[Deployment]] for production configuration
- [[Tech Stack]] for what each service does
- All integration pages for service-specific setup
