---
title: Qdrant
aliases: [Vector Database, Qdrant DB, Semantic Search]
tags: [database, qdrant, vector, embeddings, semantic-search]
created: 2026-03-31
---

# Qdrant

Qdrant handles all semantic/vector data in OpenClaw -- note content, email summaries, research output, and project context documents. It enables "find things by what they're about" queries that a relational database cannot efficiently perform.

## Why Qdrant Over pgvector?

See [[Decision Log#Qdrant Over pgvector]].

Key reasons:
1. **Dedicated vector engine** -- Purpose-built for similarity search, not bolted onto a relational DB
2. **Payload filtering** -- Native support for filtering by metadata (project_id, source, date) during vector search
3. **Scalability** -- Handles 800K+ vectors (the SWRE instance) without impacting PostgreSQL performance
4. **Separation of concerns** -- Vector workloads do not compete with relational query workloads
5. **Existing infrastructure** -- The SWRE project already uses Qdrant, so the team has operational experience

## Infrastructure

### OpenClaw Instance (Read/Write)

- **Container:** `openclaw-qdrant` (Docker Compose)
- **Ports:** 6333 (HTTP API), 6334 (gRPC)
- **Storage:** Docker volume `qdrantdata`
- **Client:** `@qdrant/js-client-rest` via `src/db/qdrant.ts`

### SWRE Instance (Read-Only)

- **Access:** Via Tailscale VPN
- **URL:** Configured via `QDRANT_SWRE_URL` environment variable
- **Vectors:** 822K+ existing vectors
- **Permissions:** Strictly read-only. No writes, no deletes, no schema modifications. This is enforced in code.
- **Used by:** [[Research Agent]] for cross-referencing SWRE knowledge base

See [[Security]] for Tailscale and access control details.

## Collections

All four collections use the same embedding model and vector dimensions:

- **Embedding model:** OpenAI `text-embedding-3-small`
- **Vector dimensions:** 1536
- **Distance metric:** Cosine similarity

### bryson_notes

Handwritten notebook content, chunked and embedded by the [[Ingestion Agent]].

| Payload Field | Type | Description |
|---|---|---|
| `project_id` | string (UUID) | Associated project |
| `source` | string | Always `"notebook"` |
| `note_id` | string (UUID) | References `notes.id` in [[PostgreSQL]] |
| `chunk_index` | integer | Position of this chunk within the note |
| `raw_text` | string | The actual text content of this chunk |
| `created_at` | string (ISO) | When the note was ingested |

**Chunking strategy:** 512 tokens per chunk, 50-token overlap, split on paragraph then sentence boundaries. Token counting via `tiktoken`.

**Typical queries:**
- "What did Bryson write about TTT pricing?"
- "Any notes mentioning competitor analysis?"
- "Recent tasks related to OnTrack?"

### bryson_emails

Summarized email thread content, embedded by the [[Inbox Agent]].

| Payload Field | Type | Description |
|---|---|---|
| `project_id` | string (UUID) | Associated project |
| `channel` | string | `gmail`, `imessage`, or `telegram` |
| `inbox_event_id` | string (UUID) | References `inbox_events.id` in [[PostgreSQL]] |
| `sender` | string | Sender name/address |
| `subject` | string | Thread subject |
| `summary` | string | Claude-generated thread summary |
| `created_at` | string (ISO) | When the message was processed |

**Typical queries:**
- "What was Mike's last email about?"
- "Any emails about the Salon Esby project?"
- "Recent messages from VIP contacts?"

### bryson_research

Research Agent output, stored for future retrieval.

| Payload Field | Type | Description |
|---|---|---|
| `project_id` | string (UUID) | Associated project |
| `query` | string | The original research query |
| `source_type` | string | `web`, `drive`, `qdrant`, `synthesis` |
| `chunk_index` | integer | Position within the research document |
| `content` | string | The actual research content |
| `sources` | string[] | URLs or document names consulted |
| `created_at` | string (ISO) | When the research was completed |

**Typical queries:**
- "Have we researched Texas Tree Tops competitors before?"
- "What do we know about solar panel marketing?"
- "Previous analysis of bail bonds industry?"

### bryson_projects

Project context documents -- detailed project information for agent reference.

| Payload Field | Type | Description |
|---|---|---|
| `project_id` | string (UUID) | Associated project |
| `project_name` | string | Project name for display |
| `section` | string | Which part of the project doc (overview, contacts, goals, etc.) |
| `content` | string | The actual context content |
| `updated_at` | string (ISO) | When this context was last updated |

**Typical queries:**
- "What are the goals for the OnTrack project?"
- "Who are the key contacts for Helium Solutions?"
- "What is the current status of SWRE?"

## Collection Initialization

Collections are created idempotently on application startup via `initCollections()` in `src/db/qdrant.ts`. If a collection already exists, it is skipped.

```typescript
// From src/db/qdrant.ts
const VECTOR_SIZE = 1536; // text-embedding-3-small dimension

export const COLLECTIONS = [
  "bryson_notes",
  "bryson_emails",
  "bryson_research",
  "bryson_projects",
] as const;
```

## Search Patterns

### Basic Semantic Search

```typescript
const results = await qdrant.search("bryson_notes", {
  vector: queryEmbedding,  // 1536-dim float array
  limit: 10,
  score_threshold: 0.7,
});
```

### Filtered Search (by project)

```typescript
const results = await qdrant.search("bryson_notes", {
  vector: queryEmbedding,
  limit: 10,
  filter: {
    must: [
      { key: "project_id", match: { value: projectId } }
    ]
  }
});
```

### Multi-Collection Search

The [[Research Agent]] searches across multiple collections and merges results:

```typescript
const [notes, emails, research] = await Promise.all([
  qdrant.search("bryson_notes", { vector, limit: 5 }),
  qdrant.search("bryson_emails", { vector, limit: 5 }),
  qdrant.search("bryson_research", { vector, limit: 5 }),
]);
```

## Health Check

```typescript
export async function healthCheck(): Promise<boolean> {
  try {
    await qdrant.getCollections();
    return true;
  } catch {
    return false;
  }
}
```

## Code References

- Client and collections: `src/db/qdrant.ts`
- SWRE client: `src/db/qdrant.ts` (`qdrantSwre` instance)
- Embedding generation: OpenAI SDK (`text-embedding-3-small`)

## Related Pages

- [[Ingestion Agent]] for notebook embedding pipeline
- [[Research Agent]] for multi-source search
- [[Inbox Agent]] for email embedding
- [[PostgreSQL]] for structured data (complements Qdrant)
- [[Redis]] for ephemeral state
- [[Decision Log#Qdrant Over pgvector]] for technology choice reasoning
- [[Security]] for SWRE read-only enforcement
