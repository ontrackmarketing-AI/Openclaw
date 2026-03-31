---
title: Redis
aliases: [Redis Cache, Queue, Cache]
tags: [database, redis, cache, queue, bullmq]
created: 2026-03-31
---

# Redis

Redis 7 handles all ephemeral state in OpenClaw -- job queues (BullMQ), rate limiting, session caches, and webhook deduplication. Redis is a fast lane, not a primary database. Nothing stored in Redis is irreplaceable.

**Why Redis?** See [[Decision Log#Redis for Ephemeral State]]. Sub-millisecond reads for deduplication checks, native list operations for queues, and TTL-based expiration for caches. BullMQ requires Redis as its backend.

## Infrastructure

- **Container:** `openclaw-redis` (Docker Compose, Redis 7 Alpine)
- **Port:** 6379
- **Storage:** Docker volume `redisdata` (persistence for queue recovery)
- **Client:** `ioredis` via `src/db/redis.ts`

## Connection Configuration

```typescript
// From src/db/redis.ts
export const redis = new Redis({
  host: config.redis.host,
  port: config.redis.port,
  password: config.redis.password,
  db: config.redis.db,
  maxRetriesPerRequest: config.redis.maxRetriesPerRequest,
  retryStrategy(times) {
    const delay = Math.min(times * 200, 5000);
    return delay;  // Exponential backoff, capped at 5s
  },
  reconnectOnError(err) {
    // Reconnect on transient errors
    const targetErrors = ["READONLY", "ECONNRESET", "ETIMEDOUT"];
    return targetErrors.some(e => err.message.includes(e));
  },
  lazyConnect: false,
});
```

## Key Patterns

### Webhook Deduplication

Prevents processing the same message twice across restarts.

| Key Pattern | Value | TTL | Used By |
|---|---|---|---|
| `webhook:dedup:{channel}:{message_id}` | `"1"` | 24 hours | [[Inbox Agent]] |

**Example keys:**
- `webhook:dedup:gmail:msg_abc123` -- Gmail thread already processed
- `webhook:dedup:imessage:im_xyz789` -- iMessage already processed
- `webhook:dedup:telegram:tg_456` -- Telegram message already processed

**Flow:**
```
Message arrives → GET webhook:dedup:{channel}:{id}
  ├── Key exists → Skip (already processed)
  └── Key missing → SET webhook:dedup:{channel}:{id} "1" EX 86400 → Process
```

### Escalation Queue

List of escalation IDs awaiting processing.

| Key Pattern | Type | TTL | Used By |
|---|---|---|---|
| `queue:escalations` | List | None | [[Orchestrator]], [[Escalation System]] |

**Operations:**
- `LPUSH queue:escalations {escalation_id}` -- New escalation created
- `RPOP queue:escalations` -- Process next escalation (FIFO)
- `LLEN queue:escalations` -- Count pending escalations

### Ingestion Queue

List of image paths awaiting processing by the [[Ingestion Agent]].

| Key Pattern | Type | TTL | Used By |
|---|---|---|---|
| `queue:ingestion` | List | None | [[Ingestion Agent]], [[Telegram Bot]] |

**Operations:**
- `LPUSH queue:ingestion {image_path}` -- New image uploaded
- `RPOP queue:ingestion` -- Process next image (FIFO)

### Project Context Cache

Serialized Project Context Store to avoid repeated database queries.

| Key Pattern | Value | TTL | Used By |
|---|---|---|---|
| `cache:project_context` | Serialized JSON | 1 hour | [[Orchestrator]] |

**Flow:**
```
Orchestrator invoked → GET cache:project_context
  ├── Cache hit → Deserialize and use
  └── Cache miss → Query PostgreSQL → Serialize → SET cache:project_context EX 3600
```

The cache is invalidated (DEL) when projects are updated.

### Gmail Rate Limiting

Tracks Gmail API quota usage to stay within the 250 units/day limit.

| Key Pattern | Value | TTL | Used By |
|---|---|---|---|
| `ratelimit:gmail:{date}` | Integer (request count) | 24 hours | [[Gmail Integration]], [[Inbox Agent]] |

**Example:** `ratelimit:gmail:2026-03-31` = `47`

**Flow:**
```
Before Gmail API call → INCR ratelimit:gmail:{today}
  ├── Count < 250 → Proceed with API call
  └── Count >= 250 → Skip, log warning, wait until tomorrow
```

### BullMQ Keys

BullMQ creates its own key patterns under a configurable prefix. These are managed by the BullMQ library and should not be manipulated directly.

| Key Pattern | Purpose |
|---|---|
| `bull:{queue_name}:id` | Job data |
| `bull:{queue_name}:wait` | Waiting jobs list |
| `bull:{queue_name}:active` | Currently processing jobs |
| `bull:{queue_name}:completed` | Completed jobs |
| `bull:{queue_name}:failed` | Failed jobs |
| `bull:{queue_name}:delayed` | Delayed/scheduled jobs |

Queues defined in the application:
- `bull:ingestion:*` -- Notebook image processing jobs
- `bull:inbox:*` -- Message processing jobs
- `bull:research:*` -- Research task jobs

## TTL Summary

| Key Category | TTL | Rationale |
|---|---|---|
| Webhook dedup | 24 hours | Messages older than 24h will not be re-delivered |
| Project context cache | 1 hour | Balance between freshness and query reduction |
| Rate limit counters | 24 hours | Gmail quota resets daily |
| BullMQ jobs (completed) | Configurable | Default: keep last 1000 completed jobs |
| Escalation queue | No TTL | Persistent until processed |
| Ingestion queue | No TTL | Persistent until processed |

## Graceful Shutdown

```typescript
export async function shutdownRedis(): Promise<void> {
  await redis.quit();
}
```

Registered on `SIGINT` and `SIGTERM` signals.

## Code References

- Client: `src/db/redis.ts`
- BullMQ configuration: `src/queue/`

## Related Pages

- [[Orchestrator]] for project context caching and escalation queue
- [[Webhook Deduplication]] (this page covers the pattern)
- [[Ingestion Agent]] for ingestion queue
- [[Gmail Integration]] for rate limiting
- [[PostgreSQL]] for persistent storage
- [[Qdrant]] for vector storage
- [[Tech Stack]] for why BullMQ on Redis
