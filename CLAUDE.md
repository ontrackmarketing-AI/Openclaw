# OpenClaw Personal OS

## Overview
OpenClaw is a multi-agent personal operating system built for Bryson Stevens. It orchestrates six specialized AI agents that manage communications, scheduling, CRM, document processing, research, and system maintenance through a unified Telegram interface.

## Tech Stack
- **Runtime**: Node.js 20+ with TypeScript (ES modules)
- **AI**: Anthropic Claude (primary), OpenAI (embeddings/fallback)
- **Database**: PostgreSQL 16 (relational), Qdrant (vector search), Redis (cache + queues)
- **Messaging**: Telegram (primary interface via Telegraf), iMessage bridge (optional)
- **Integrations**: Google Workspace (Gmail, Calendar, Drive), GoHighLevel CRM, n8n workflows, Tavily search
- **Queue**: BullMQ on Redis for background job processing

## Getting Started
```bash
# Start infrastructure
docker-compose up -d

# Install dependencies
npm install

# Copy and configure environment
cp .env.example .env
# Edit .env with your API keys

# Run database migrations
npm run db:migrate

# Seed initial data
npm run db:seed

# Start development server
npm run dev
```

## Project Structure
```
src/
  config/          # App configuration and logger
  agents/          # Six specialized agents
    triage/        # Message classification and routing
    comms/         # Email, messaging, notifications
    scheduler/     # Calendar and scheduling
    crm/           # GoHighLevel CRM operations
    docs/          # Google Drive document processing
    researcher/    # Web research and analysis
  core/            # Shared agent infrastructure (base classes, memory, tools)
  db/              # Database migrations, seeds, and query layer
  integrations/    # External service clients (Google, GHL, Telegram, etc.)
  api/             # Express HTTP routes
  queue/           # BullMQ job definitions and workers
  types/           # Shared TypeScript type definitions
  utils/           # Utility functions
  index.ts         # Application entry point
```

## Agent Architecture
1. **Triage Agent** - Classifies incoming messages and routes to the correct specialist
2. **Comms Agent** - Handles email drafts, message replies, and notifications
3. **Scheduler Agent** - Manages Google Calendar events and scheduling conflicts
4. **CRM Agent** - Interfaces with GoHighLevel for contact and pipeline management
5. **Docs Agent** - Processes Google Drive documents, extracts and indexes content
6. **Researcher Agent** - Performs web research using Tavily and synthesizes findings

## Build Phases
- **Phase 1**: Foundation (config, database, base agent framework, Telegram bot)
- **Phase 2**: Triage + Comms agents (message routing, email drafts)
- **Phase 3**: Scheduler + CRM agents (calendar, GoHighLevel)
- **Phase 4**: Docs + Researcher agents (Drive processing, web search)
- **Phase 5**: Polish (error handling, monitoring, performance)

## Database
- **PostgreSQL**: Conversations, messages, contacts, tasks, agent state
- **Qdrant**: Vector embeddings for semantic search across messages and documents
- **Redis**: Session cache, rate limiting, BullMQ job queues

## Testing
```bash
npm test            # Run all tests
npm run test:watch  # Watch mode
```

## Critical Safety Rules
- **Never send emails autonomously.** Always create drafts for Bryson to review and approve.
- **Never write to the SWRE Qdrant instance.** The SWRE Qdrant (QDRANT_SWRE_URL) is read-only. Only the local Qdrant (QDRANT_URL) may be written to.
- **Never delete calendar events** without explicit confirmation.
- **Never expose API keys** in logs or responses.
- Feature flags (ENABLE_IMESSAGE, ENABLE_GMAIL_SEND, ENABLE_GHL_WRITE) must be checked before any write operations to those services.
