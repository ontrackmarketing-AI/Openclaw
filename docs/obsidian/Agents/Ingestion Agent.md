---
title: Ingestion Agent
aliases: [Ingestion, Notebook Pipeline, Agent 2]
tags: [agent, ingestion, notebook, vision, embeddings]
created: 2026-03-31
---

# Ingestion Agent

The Ingestion Agent turns photos of Bryson's handwritten notebook pages into structured, queryable, searchable, actionable context. This is the core unlock of OpenClaw -- pen-and-paper notes become data that every other agent can reference.

## Role

- Receive images via [[Telegram Bot]] upload or a watched [[Google Drive Integration]] folder
- Extract text and structure using Claude Vision
- Match project references to known projects
- Write structured output to [[PostgreSQL]]
- Embed content into [[Qdrant]] for semantic search
- Report results to Bryson via Telegram

## Pipeline

### Step 1: Image Receipt

Images enter through two channels:

1. **Telegram photo upload** -- Bryson sends a photo directly to the bot. The [[Telegram Bot]] handler saves the image and pushes a job to [[Redis]] `queue:ingestion`.
2. **Google Drive watched folder** -- Bryson drops photos into a designated Drive folder. The [[Google Drive Integration]] detects new files and pushes jobs to the ingestion queue.

### Step 2: Claude Vision Extraction

The image is sent to the Anthropic Claude API with a vision prompt:

```
You are processing a photo of a handwritten notebook page belonging to
Bryson Stevens, who runs multiple businesses. Extract ALL text from
the image exactly as written.

Then structure the content into:
- tasks: action items with any mentioned deadlines
- decisions: choices or conclusions made
- questions: items marked with "?" or phrased as questions
- notes: general information, ideas, context
- project_references: any mention of a known project or client

Known projects: [injected from Project Context Store]

Return as structured JSON.
```

### Step 3: Structuring Pass

Claude's response is validated with Zod and parsed into the canonical format:

```typescript
interface IngestionResult {
  project: string | null;
  tasks: Array<{
    title: string;
    description?: string;
    project_ref?: string;
    due_date?: string;
    priority?: number;
  }>;
  notes: Array<{
    content: string;
    project_ref?: string;
  }>;
  decisions: Array<{
    content: string;
    project_ref?: string;
  }>;
  questions: Array<{
    content: string;
    project_ref?: string;
    needs_bryson: boolean;
  }>;
}
```

### Step 4: Fuzzy Project Matching

Project references from handwritten notes are often abbreviated or misspelled. The agent uses **Fuse.js** for fuzzy matching against the project registry:

| Written | Matched To | Score |
|---|---|---|
| "TTT" | Texas Tree Tops | 0.95 |
| "SWRE" | SWRE | 1.0 |
| "ontrack" | OnTrack Marketing | 0.88 |
| "helium" | Helium Solutions | 0.92 |
| "bail bonds" | A to Z Bail Bonds | 0.85 |

Fuse.js configuration:

```typescript
const fuse = new Fuse(projects, {
  keys: ['name', 'client'],
  threshold: 0.4,      // Allow fuzzy matches
  includeScore: true,
  minMatchCharLength: 2,
});
```

Matches below the threshold (0.4) are flagged as ambiguous and queued for Bryson's clarification.

### Step 5: Ambiguity Check

If any extracted items cannot be confidently matched to a project, the agent queues them for Bryson and sends a Telegram message listing the ambiguous items with inline keyboard options for manual assignment.

### Step 6: PostgreSQL Write

Two tables are updated:

**`notes` table:**

| Column | Value |
|---|---|
| `project_id` | Matched project UUID (or NULL if ambiguous) |
| `source` | `"notebook"` |
| `raw_text` | Full extracted text |
| `structured` | JSON with tasks, decisions, questions, notes |
| `image_path` | Path to stored image |
| `qdrant_ids` | Array of Qdrant point IDs after embedding |

**`tasks` table** (one row per extracted task):

| Column | Value |
|---|---|
| `project_id` | Matched project UUID |
| `source` | `"notebook"` |
| `title` | Extracted task title |
| `description` | Additional context |
| `status` | `"open"` |
| `priority` | Inferred or default (3) |
| `due_date` | Extracted date or NULL |

### Step 7: Chunking and Embedding

Text is chunked for embedding:

- **Chunk size:** 512 tokens (measured via `tiktoken`)
- **Overlap:** 50 tokens between consecutive chunks
- **Strategy:** Split on paragraph boundaries first, then sentence boundaries, then token count

Each chunk is embedded via OpenAI `text-embedding-3-small` (1536 dimensions) and upserted to [[Qdrant]] collection `bryson_notes`.

**Qdrant payload schema:**

```json
{
  "project_id": "uuid",
  "source": "notebook",
  "note_id": "uuid (references notes table)",
  "chunk_index": 0,
  "raw_text": "chunk content",
  "created_at": "ISO timestamp"
}
```

### Step 8: Telegram Confirmation

The agent sends a confirmation message via [[Telegram Bot]]:

```
Ingested 3 pages.
Found 7 tasks across SWRE, TTT, and OnTrack.
2 items need clarification:
  - "Call Mike about the thing" — which project?
  - "Update pricing" — SWRE or Helium Solutions?
```

Items needing clarification include inline keyboard buttons for project assignment.

## Error Handling

- **Vision extraction fails** -- Retry once with a simplified prompt. If still failing, escalate with the original image attached.
- **No text detected** -- Inform Bryson: "Could not read text from image. Try a clearer photo."
- **Embedding fails** -- Write to PostgreSQL anyway (structured data is not lost). Retry embedding via BullMQ with exponential backoff.

## Code References

- Pipeline implementation: `src/agents/ingestion/`
- Qdrant client: `src/db/qdrant.ts`
- Schema: `src/db/schema.sql` (notes and tasks tables)

## Related Pages

- [[Qdrant]] for vector storage details
- [[PostgreSQL]] for schema documentation
- [[Telegram Bot]] for upload handling
- [[Google Drive Integration]] for watched folder setup
- [[Data Flow]] for the full pipeline diagram
- [[Orchestrator]] for how ingestion is triggered
