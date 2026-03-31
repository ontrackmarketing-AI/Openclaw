---
title: Deployment
aliases: [Infrastructure, Hosting, Docker, AWS]
tags: [operations, deployment, docker, aws, infrastructure]
created: 2026-03-31
---

# Deployment

OpenClaw runs on AWS EC2 with Docker Compose for service orchestration. A Mac mini provides iMessage bridge capabilities.

## Docker Compose Setup

All core services run via Docker Compose. See `docker-compose.yml` in the project root.

### Services

| Service | Image | Container Name | Ports |
|---|---|---|---|
| PostgreSQL | `postgres:16-alpine` | `openclaw-postgres` | 5432:5432 |
| Redis | `redis:7-alpine` | `openclaw-redis` | 6379:6379 |
| Qdrant | `qdrant/qdrant:latest` | `openclaw-qdrant` | 6333:6333, 6334:6334 |

### Volumes

| Volume | Purpose |
|---|---|
| `pgdata` | PostgreSQL data persistence |
| `redisdata` | Redis data persistence (queue recovery) |
| `qdrantdata` | Qdrant vector storage persistence |

### Health Checks

All services have Docker health checks:

| Service | Check | Interval | Retries |
|---|---|---|---|
| PostgreSQL | `pg_isready -U openclaw -d openclaw` | 10s | 5 |
| Redis | `redis-cli ping` | 10s | 5 |
| Qdrant | `curl -f http://localhost:6333/healthz` | 10s | 5 |

### Starting Services

```bash
# Start all infrastructure services
docker-compose up -d

# Check health
docker-compose ps

# View logs
docker-compose logs -f postgres
docker-compose logs -f redis
docker-compose logs -f qdrant
```

## Application Deployment

The OpenClaw Node.js application runs outside Docker (directly on the host or in a separate container):

```bash
# Install dependencies
npm install

# Build TypeScript
npm run build

# Run migrations
npm run db:migrate

# Seed initial data
npm run db:seed

# Start production server
npm start

# Or development with watch mode
npm run dev
```

## AWS EC2 Specifications

### Recommended Instance

| Spec | Value | Rationale |
|---|---|---|
| Instance type | `t3.medium` | 2 vCPU, 4 GB RAM -- sufficient for all services |
| Storage | 50 GB gp3 EBS | PostgreSQL, Qdrant vectors, Redis persistence, application code |
| Region | `us-east-1` | Closest to Bryson (Texas), good API latency |
| OS | Ubuntu 22.04 LTS | Stable, well-supported, Docker-friendly |

### Cost Breakdown (Estimated Monthly)

| Item | Cost |
|---|---|
| EC2 t3.medium (on-demand) | ~$30/month |
| EBS 50 GB gp3 | ~$4/month |
| Data transfer (estimate) | ~$5/month |
| **EC2 Total** | **~$39/month** |

### API Costs (Estimated Monthly)

| Service | Estimated Usage | Cost |
|---|---|---|
| Anthropic Claude (reasoning) | ~500K tokens/day | ~$15/month |
| OpenAI embeddings | ~100K tokens/day | ~$1/month |
| Tavily search | ~50 queries/day | ~$5/month |
| **API Total** | | **~$21/month** |

### Total Estimated Monthly Cost

| Category | Cost |
|---|---|
| AWS infrastructure | ~$39 |
| API services | ~$21 |
| Tailscale | Free (personal plan) |
| n8n (self-hosted) | Free |
| **Total** | **~$60/month** |

## Mac Mini Requirements

See [[iMessage Bridge]] for detailed setup.

| Requirement | Details |
|---|---|
| Hardware | Mac mini (M1 or later recommended) |
| macOS | Ventura 13.0+ |
| Network | Ethernet, Tailscale installed |
| Power | Always on, 24/7 |
| Software | Node.js 20+, iMessage bridge server |
| Apple ID | Signed in to Messages.app |
| Startup | Bridge configured as launchd Launch Agent |

**Cost:** One-time ~$599 (Mac mini M2) + ~$5/month electricity.

## Production Checklist

### Before First Deploy

- [ ] EC2 instance launched with Ubuntu 22.04
- [ ] Docker and Docker Compose installed
- [ ] Node.js 20+ installed
- [ ] Tailscale installed and joined to tailnet
- [ ] `.env` file configured with all production secrets
- [ ] `docker-compose up -d` -- all services healthy
- [ ] `npm run db:migrate` -- schema applied
- [ ] `npm run db:seed` -- initial project and contact data loaded
- [ ] Telegram bot created via @BotFather, token configured
- [ ] Google OAuth2 flow completed, refresh token obtained
- [ ] n8n deployed and workflows configured

### Mac Mini Setup

- [ ] Mac mini powered on and connected to network
- [ ] Tailscale installed and joined to same tailnet
- [ ] Messages.app signed in with Bryson's Apple ID
- [ ] iMessage bridge server installed and running
- [ ] Launch Agent configured for auto-start
- [ ] Test message sent successfully from EC2 to Mac mini

### Post-Deploy Verification

- [ ] `curl http://localhost:3000/health` returns 200
- [ ] Telegram `/status` command returns system health
- [ ] Test photo upload processes through ingestion pipeline
- [ ] Test Gmail fetch processes through inbox pipeline
- [ ] Daily briefing triggers at configured time

## Process Management

In production, use PM2 or systemd to keep the application running:

```bash
# Using PM2
npm install -g pm2
pm2 start dist/index.js --name openclaw
pm2 save
pm2 startup
```

## Related Pages

- [[Tech Stack]] for technology choices
- [[iMessage Bridge]] for Mac mini details
- [[Security]] for production secret management
- [[Environment Variables]] for all configuration
- [[Docker Compose]] reference in `docker-compose.yml`
