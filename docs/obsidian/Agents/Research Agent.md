---
title: Research Agent
aliases: [Research, Researcher, Agent 4]
tags: [agent, research, search, qdrant, drive]
created: 2026-03-31
---

# Research Agent

The Research Agent handles information gathering, competitive research, client research, and document analysis without interrupting Bryson. It pulls from multiple sources, synthesizes findings, and stores results for future retrieval.

## Role

- Perform web searches via Tavily
- Search Google Drive documents
- Run semantic searches against [[Qdrant]] collections
- Access the SWRE Qdrant instance (read-only)
- Synthesize findings into structured summaries
- Store research output for future reference

## Trigger Sources

The Research Agent can be triggered in three ways:

1. **Orchestrator-initiated** -- The [[Orchestrator]] triggers research proactively. Example: "Research Texas Tree Tops competitors before Bryson's 2 PM call."
2. **Telegram command** -- Bryson sends `/research <query>` via [[Telegram Bot]].
3. **Scheduled task** -- Periodic research tasks (e.g., weekly competitor monitoring).

## Search Sources

### Web Search (Tavily)

Tavily provides structured web search results without requiring page scraping. The agent formulates search queries based on project context and user intent.

```typescript
// Example: research triggered for a client meeting
const results = await tavily.search({
  query: "Texas Tree Tops arborist competitors Austin TX 2026",
  max_results: 10,
  include_answer: true,
});
```

### Google Drive Search

The [[Google Drive Integration]] provides access to Bryson's document library:
- Client proposals and contracts
- Meeting notes
- Project documentation
- Shared files from collaborators

The agent searches by folder, filename, and full-text content.

### Qdrant Semantic Search

The agent searches across multiple [[Qdrant]] collections:

| Collection | What It Contains | Use Case |
|---|---|---|
| `bryson_notes` | Notebook content | "What did Bryson write about TTT pricing?" |
| `bryson_emails` | Email thread summaries | "What was the last email from Mike about?" |
| `bryson_research` | Previous research output | "Have we already researched this topic?" |
| `bryson_projects` | Project context documents | "What are the key details for OnTrack?" |

Search uses OpenAI `text-embedding-3-small` to embed the query, then performs cosine similarity search with a score threshold.

### SWRE Qdrant (Read-Only)

The agent has read-only access to the existing SWRE Qdrant instance containing 822K+ vectors. This provides access to the full SWRE knowledge base for cross-referencing.

**Critical safety rule:** The SWRE Qdrant instance (`QDRANT_SWRE_URL`) is strictly read-only. No writes, no deletes, no collection modifications. This is enforced at the client configuration level. See [[Security]].

## Synthesis Process

After gathering results from all sources, Claude synthesizes them into a structured research summary:

```typescript
interface ResearchSummary {
  query: string;
  sources_consulted: string[];
  key_findings: Array<{
    finding: string;
    source: string;
    confidence: "high" | "medium" | "low";
  }>;
  recommendations: string[];
  related_projects: string[];
  gaps: string[];  // What we couldn't find
}
```

## Storage

Research output is stored in two places:

1. **[[Qdrant]]** `bryson_research` collection -- The full summary is chunked, embedded, and stored for future semantic retrieval.
2. **[[PostgreSQL]]** `agent_logs` table -- Metadata about the research task (query, sources, timestamp) is logged for audit.

## Output Routing

Depending on the trigger source:

| Trigger | Output |
|---|---|
| Orchestrator (pre-meeting) | Fed into [[Scheduler Agent]] pre-brief |
| Telegram `/research` | Summary sent as Telegram message |
| Scheduled task | Included in next daily briefing via [[Reporting Agent]] |

## Code References

- Agent implementation: `src/agents/researcher/`
- Qdrant client: `src/db/qdrant.ts`
- Qdrant SWRE client: `src/db/qdrant.ts` (qdrantSwre instance)

## Related Pages

- [[Qdrant]] for collection details and vector dimensions
- [[Google Drive Integration]] for document retrieval setup
- [[Orchestrator]] for how research is triggered
- [[Scheduler Agent]] for pre-meeting research integration
- [[Data Flow]] for the research flow diagram
- [[Security]] for SWRE read-only enforcement
