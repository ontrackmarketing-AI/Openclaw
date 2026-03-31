---
title: Deployment
aliases: [Deploy, Infrastructure, Hosting]
tags: [operations, deployment, docker, aws, infrastructure]
created: 2026-03-31
---

# Deployment

OpenClaw runs on a minimal infrastructure stack: Docker Compose for services, AWS EC2 for the main server, and a Mac mini for iMessage. Total cost target: $90-130/month.

## Architecture Overview

```
+-----------------------------+          Tailscale          +-------------------+
|  AWS EC2 (t3.medium)        | <------------------------> |  Mac mini          |
|  us-east-1 or us-west-2     |                            |  (Bryson's office) |
|                              |                            |                    |
|  Docker Compose:             |                            |  iMessage Bridge   |
|    openclaw-app (Node.js)    |                            |  (Node.js server)  |
|    openclaw-postgres (PG 16) |                            |  Messages.app      |
|    openclaw-redis (Redis 7)  |                            +-------------------+
|    openclaw-qdrant (Qdrant)  |
|                              |
|  n8n (self-hosted)           |
+-----------------------------+
```

## Local Development (Docker Compose)

The `docker-compose.yml` at the project root provides all three database services:

```yaml
services:
  postgres:
    image: postgres:16-alpine
    container_name: openclaw-postgres
    ports: ["5432:5432"]
    volumes: [pgdata:/var/lib/postgresql/data]

  redis:
    image: redis:7-alpine
    container_name: openclaw-redis
    ports: ["6379:6379"]
    volumes: [redisdata:/data]

  qdrant:
    image: qdrant/qdrant:latest
    container_name: openclaw-qdrant
    ports: ["6333:6333", "6334:6334"]
    volumes: [qdrantdata:/qdrant/storage]
```

### Local Development Steps

1. `docker compose up -d` -- Start databases
2. `cp .env.example .env` -- Create environment file
3. Fill in required values (at minimum: `DATABASE_URL`, `REDIS_URL`, `QDRANT_URL`)
4. `npm install` -- Install dependencies
5. `npm run db:migrate` -- Run database migrations
6. `npm run db:seed` -- Seed initial data (projects, contacts)
7. `npm run dev` -- Start the app with watch mode (`tsx watch src/index.ts`)

The app runs on `http://localhost:3000` by default. Telegram bot runs in polling mode during development.

## Production (AWS EC2)

### Instance Specification

| Component | Specification | Rationale |
|---|---|---|
| **Instance type** | `t3.medium` | 2 vCPU, 4 GB RAM. Sufficient for Node.js app + 3 Docker containers. Burstable for ingestion spikes. |
| **Storage** | 30 GB gp3 EBS | OS + Docker images + database volumes. gp3 for consistent IOPS. |
| **Region** | `us-east-1` or `us-west-2` | Low latency to Google APIs and Telegram servers |
| **OS** | Ubuntu 22.04 LTS | Stable, well-supported, Docker-friendly |

### PostgreSQL Option

Two configurations are supported:

| Option | When | Cost |
|---|---|---|
| **Same EC2 (Docker)** | Phase 1-4, low data volume | $0 additional |
| **RDS t3.micro** | Phase 5+, when data reliability is critical | ~$15/month |

Starting with PostgreSQL in Docker on the same EC2 instance is recommended. Migrate to RDS when the system is stable and data volume warrants it.

### Production Setup Steps

1. Launch EC2 instance with Ubuntu 22.04
2. Install Docker and Docker Compose
3. Install Tailscale and join the tailnet
4. Clone the repository
5. Configure `.env` with production secrets
6. `docker compose up -d` -- Start databases
7. `npm run db:migrate` -- Run migrations
8. `npm run build` -- Compile TypeScript
9. `npm start` -- Start production server (or use PM2/systemd)
10. Configure Telegram webhook URL
11. Set up n8n instance

### Process Management

In production, the Node.js process should be managed by `systemd` or PM2:

```ini
# /etc/systemd/system/openclaw.service
[Unit]
Description=OpenClaw Personal OS
After=docker.service

[Service]
Type=simple
User=ubuntu
WorkingDirectory=/home/ubuntu/openclaw
ExecStart=/usr/bin/node dist/index.js
Restart=on-failure
RestartSec=10
Environment=NODE_ENV=production

[Install]
WantedBy=multi-user.target
```

## Mac Mini (iMessage Bridge)

The Mac mini runs the [[iMessage Bridge]] server. See that page for detailed setup.

| Requirement | Details |
|---|---|
| Hardware | Mac mini (M1+ recommended) |
| Location | Bryson's office or home, always on |
| Network | Wired ethernet, Tailscale installed |
| Software | Node.js 20+, Messages.app signed in |
| Startup | Bridge configured as macOS Launch Agent |
| Cost | ~$0/month (existing hardware, home internet) |

### Launch Agent Configuration

```xml
<!-- ~/Library/LaunchAgents/com.openclaw.imessage-bridge.plist -->
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.openclaw.imessage-bridge</string>
    <key>ProgramArguments</key>
    <array>
        <string>/usr/local/bin/node</string>
        <string>/Users/bryson/imessage-bridge/index.js</string>
    </array>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <true/>
</dict>
</plist>
```

## Tailscale Networking

All machines are connected via Tailscale mesh VPN:

| Machine | Tailscale IP | Services Exposed |
|---|---|---|
| AWS EC2 | `100.x.x.x` | OpenClaw API (port 3000) |
| Mac mini | `100.y.y.y` | iMessage Bridge (port 4000) |
| SWRE server | `100.z.z.z` | Qdrant (port 6333, read-only) |

No services are exposed to the public internet except:
- EC2 port 443 (for Telegram webhook, behind reverse proxy)
- EC2 port 80 (redirect to 443)

See [[Security]] for Tailscale security details.

## Cost Breakdown

| Component | Monthly Cost | Notes |
|---|---|---|
| AWS EC2 t3.medium | ~$30 | On-demand pricing. Reserved instance: ~$19/month |
| EBS 30 GB gp3 | ~$2.40 | Storage for OS + Docker volumes |
| Data transfer | ~$5-10 | Outbound to APIs, Telegram, etc. |
| Anthropic API (Claude) | ~$20-40 | Depends on ingestion volume and triage complexity |
| OpenAI API (embeddings) | ~$5-10 | text-embedding-3-small is very cheap |
| Tavily API | ~$0-10 | Free tier covers light research; paid for heavy use |
| Tailscale | $0 | Free for personal use (up to 100 devices) |
| Mac mini | $0 | Existing hardware + home internet |
| n8n | $0 | Self-hosted |
| **Total** | **~$62-102** | |

With RDS t3.micro add ~$15/month. With reserved EC2 pricing, total can be under $90/month.

## Why Not Serverless

See [[Decision Log#Why Not Serverless]]. Key reasons:

1. **Long-running processes** -- BullMQ workers, Telegram bot polling, and cron jobs need persistent processes
2. **Cold starts** -- Agent reasoning with Claude takes 5-15 seconds; adding Lambda cold starts would make it worse
3. **State management** -- Redis connections, Qdrant connections, and in-memory caches would be lost between invocations
4. **Complexity** -- A single EC2 instance with Docker Compose is simpler to debug than a Lambda + SQS + DynamoDB architecture
5. **Cost** -- At OpenClaw's usage level, EC2 is cheaper than equivalent Lambda invocations

## Monitoring

| What | Tool | Details |
|---|---|---|
| Application logs | Winston (JSON to stdout) | Structured logging with levels |
| Container health | Docker healthchecks | PostgreSQL, Redis, Qdrant all have healthchecks |
| Uptime | `/health` endpoint | Returns `200 OK` with uptime |
| System metrics | Telegram `/status` command | On-demand system health |
| Errors | Telegram alerts | Critical errors trigger Tier 5 escalation |

## Related Pages

- [[Security]] for network and access security
- [[iMessage Bridge]] for Mac mini setup details
- [[Environment Variables]] for production configuration
- [[Tech Stack]] for software dependencies
- [[Decision Log#Why Not Serverless]] for architecture reasoning
