import OpenAI from "openai";
import { v4 as uuidv4 } from "uuid";
import { BaseAgent, AgentEvent, AgentResult } from "../base.js";
import { config } from "../../config/index.js";
import { logger } from "../../config/logger.js";
import { qdrant } from "../../db/qdrant.js";
import type { CollectionName } from "../../db/qdrant.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const TAVILY_API_URL = "https://api.tavily.com/search";
const EMBEDDING_MODEL = "text-embedding-3-small";
const EMBEDDING_DIMENSIONS = 1536;
const RESEARCH_COLLECTION: CollectionName = "bryson_research";
const QDRANT_SEARCH_LIMIT = 10;
const CHUNK_SIZE = 1000;
const CHUNK_OVERLAP = 200;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface WebSearchResult {
  title: string;
  url: string;
  content: string;
  score: number;
}

interface DriveSearchResult {
  id: string;
  name: string;
  mimeType: string;
  snippet: string;
  webViewLink: string;
}

export interface QdrantSearchResult {
  id: string;
  text: string;
  score: number;
  payload: Record<string, unknown>;
}

export interface ResearchSummary {
  query: string;
  synthesis: string;
  sources: { title: string; url?: string; type: string }[];
  keyFindings: string[];
  suggestedActions: string[];
}

export interface ResearchSource {
  source: string;
  content: string;
}

// ---------------------------------------------------------------------------
// Research Agent
// ---------------------------------------------------------------------------

export class ResearchAgent extends BaseAgent {
  private openai: OpenAI;

  constructor() {
    super("research");
    this.openai = new OpenAI({ apiKey: config.openai.apiKey });
  }

  // -----------------------------------------------------------------------
  // Embedding helper
  // -----------------------------------------------------------------------

  /**
   * Embed a text string using OpenAI text-embedding-3-small (1536 dimensions).
   */
  async embedText(text: string): Promise<number[]> {
    const response = await this.openai.embeddings.create({
      model: EMBEDDING_MODEL,
      input: text,
      dimensions: EMBEDDING_DIMENSIONS,
    });

    const embedding = response.data[0]?.embedding;
    if (!embedding) {
      throw new Error("Failed to generate embedding — empty response");
    }
    return embedding;
  }

  // -----------------------------------------------------------------------
  // Main orchestration
  // -----------------------------------------------------------------------

  /**
   * Orchestrate a complete research task: search multiple sources, synthesise,
   * store.
   */
  async research(
    query: string,
    projectId?: string,
  ): Promise<ResearchSummary> {
    await this.log("research_start", projectId, { query });

    // Run searches in parallel
    const [webResults, qdrantResults] = await Promise.all([
      this.searchWeb(query).catch((err) => {
        logger.error("Web search failed", {
          error: err instanceof Error ? err.message : String(err),
        });
        return [] as WebSearchResult[];
      }),
      this.searchQdrant(query, "bryson_notes").catch((err) => {
        logger.error("Qdrant search failed", {
          error: err instanceof Error ? err.message : String(err),
        });
        return [] as QdrantSearchResult[];
      }),
    ]);

    // Also search bryson_research for prior research
    const priorResearch = await this.searchQdrant(
      query,
      "bryson_research",
    ).catch(() => [] as QdrantSearchResult[]);

    // Build unified sources array for synthesis
    const sources: ResearchSource[] = [
      ...webResults.map((r) => ({
        source: `[Web] ${r.title} (${r.url})`,
        content: r.content,
      })),
      ...qdrantResults.map((r) => ({
        source: `[Notes] score=${r.score.toFixed(2)}`,
        content: r.text,
      })),
      ...priorResearch.map((r) => ({
        source: `[Prior Research] score=${r.score.toFixed(2)}`,
        content: r.text,
      })),
    ];

    // Synthesise all results
    const summary = await this.synthesize(query, sources);

    // Store the research output
    if (projectId) {
      await this.storeResearch(summary.synthesis, projectId, {
        query: summary.query,
        key_findings: summary.keyFindings,
        suggested_actions: summary.suggestedActions,
        sources: summary.sources,
      });
    } else {
      await this.storeResearch(summary.synthesis, "unscoped", {
        query: summary.query,
        key_findings: summary.keyFindings,
        suggested_actions: summary.suggestedActions,
        sources: summary.sources,
      });
    }

    await this.log("research_complete", projectId, {
      query,
      webResultCount: webResults.length,
      qdrantResultCount: qdrantResults.length,
      keyFindings: summary.keyFindings.length,
    });

    return summary;
  }

  // -----------------------------------------------------------------------
  // Web search via Tavily
  // -----------------------------------------------------------------------

  /**
   * Search the web using the Tavily API. Returns top 5 results with titles,
   * URLs, and content snippets.
   */
  async searchWeb(query: string): Promise<WebSearchResult[]> {
    const apiKey = config.tavily.apiKey;
    if (!apiKey) {
      logger.warn("TAVILY_API_KEY not set — skipping web search");
      return [];
    }

    await this.log("web_search", undefined, { query });

    const response = await fetch(TAVILY_API_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        api_key: apiKey,
        query,
        search_depth: "advanced",
        include_answer: false,
        max_results: 5,
      }),
      signal: AbortSignal.timeout(15_000),
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`Tavily API error: HTTP ${response.status} — ${body}`);
    }

    const data = (await response.json()) as {
      results: {
        title: string;
        url: string;
        content: string;
        score: number;
      }[];
    };

    return (data.results ?? []).slice(0, 5).map((r) => ({
      title: r.title,
      url: r.url,
      content: r.content,
      score: r.score,
    }));
  }

  // -----------------------------------------------------------------------
  // Google Drive search
  // -----------------------------------------------------------------------

  /**
   * Search Google Drive for documents matching the query.
   */
  async searchDrive(
    query: string,
    folderId?: string,
  ): Promise<DriveSearchResult[]> {
    let google: typeof import("googleapis").google;
    try {
      const mod = await import("googleapis");
      google = mod.google;
    } catch {
      logger.warn("googleapis not available — skipping Drive search");
      return [];
    }

    const authToken = process.env["GOOGLE_ACCESS_TOKEN"];
    if (!authToken) {
      logger.warn("GOOGLE_ACCESS_TOKEN not set — skipping Drive search");
      return [];
    }

    const auth = new google.auth.OAuth2();
    auth.setCredentials({ access_token: authToken });
    const drive = google.drive({ version: "v3", auth });

    await this.log("drive_search", undefined, { query, folderId });

    let q = `fullText contains '${query.replace(/'/g, "\\'")}'`;
    if (folderId) {
      q += ` and '${folderId}' in parents`;
    }

    try {
      const response = await drive.files.list({
        q,
        pageSize: 10,
        fields: "files(id, name, mimeType, webViewLink)",
      });

      return (response.data.files ?? []).map((f) => ({
        id: f.id ?? "",
        name: f.name ?? "",
        mimeType: f.mimeType ?? "",
        snippet: "",
        webViewLink: f.webViewLink ?? "",
      }));
    } catch (err) {
      logger.error("Drive search failed", {
        error: err instanceof Error ? err.message : String(err),
      });
      return [];
    }
  }

  // -----------------------------------------------------------------------
  // Qdrant semantic search
  // -----------------------------------------------------------------------

  /**
   * Embed the query with OpenAI text-embedding-3-small, then search the
   * specified Qdrant collection. Returns scored results with payloads.
   */
  async searchQdrant(
    query: string,
    collection: string,
    limit: number = QDRANT_SEARCH_LIMIT,
  ): Promise<QdrantSearchResult[]> {
    await this.log("qdrant_search", undefined, { query, collection });

    const queryVector = await this.embedText(query);

    const results = await qdrant.search(collection, {
      vector: queryVector,
      limit,
      with_payload: true,
      score_threshold: 0.5,
    });

    return results.map((r) => ({
      id: typeof r.id === "string" ? r.id : String(r.id),
      text: (r.payload?.["text"] as string) ?? "",
      score: r.score,
      payload: (r.payload as Record<string, unknown>) ?? {},
    }));
  }

  // -----------------------------------------------------------------------
  // Synthesis
  // -----------------------------------------------------------------------

  /**
   * Use Claude to produce a structured research summary from all sources.
   * Prompt instructs Claude to cite sources, highlight key findings, and
   * note gaps.
   */
  async synthesize(
    query: string,
    sources: ResearchSource[],
  ): Promise<ResearchSummary> {
    const sourcesBlock =
      sources.length > 0
        ? sources
            .map((s, i) => `[Source ${i + 1}] ${s.source}\n${s.content}`)
            .join("\n\n")
        : "No sources found.";

    const raw = await this.callClaude(
      `You are a research synthesiser for Bryson Stevens' personal operating system (OpenClaw).

Bryson runs Helium Solutions (AI marketing automation agency), Search Tuners (referral marketing partnership with Mike), and OnTrack Marketing (SaaS in development).

Given search results from multiple sources, produce a comprehensive yet concise research summary.

Requirements:
- Cite sources by number (e.g. [Source 1]) throughout the synthesis
- Highlight key findings as distinct bullet points
- Note any gaps or areas that need further investigation
- Be specific and actionable — Bryson uses these summaries to make business decisions

Respond with valid JSON only (no markdown fences):
{
  "synthesis": "A 2-4 paragraph synthesis of all findings, citing sources",
  "sources": [{"title": "...", "url": "...", "type": "web|note|prior_research"}],
  "key_findings": ["Bullet point findings"],
  "suggested_actions": ["Concrete next steps for Bryson"]
}`,
      `Research query: "${query}"

--- SOURCES ---
${sourcesBlock}

Synthesise these results into a structured research summary.`,
      { maxTokens: 2048 },
    );

    try {
      const cleaned = raw
        .replace(/^```(?:json)?\n?/m, "")
        .replace(/\n?```$/m, "");
      const parsed = JSON.parse(cleaned) as {
        synthesis: string;
        sources: { title: string; url?: string; type: string }[];
        key_findings: string[];
        suggested_actions: string[];
      };

      return {
        query,
        synthesis: parsed.synthesis,
        sources: parsed.sources ?? [],
        keyFindings: parsed.key_findings ?? [],
        suggestedActions: parsed.suggested_actions ?? [],
      };
    } catch (err) {
      logger.error("Failed to parse synthesis JSON", {
        error: err instanceof Error ? err.message : String(err),
      });
      return {
        query,
        synthesis: raw,
        sources: [],
        keyFindings: [],
        suggestedActions: [],
      };
    }
  }

  // -----------------------------------------------------------------------
  // Store research (with chunking)
  // -----------------------------------------------------------------------

  /**
   * Chunk the summary, embed each chunk with OpenAI, and store in the
   * bryson_research Qdrant collection with project metadata.
   */
  async storeResearch(
    summary: string,
    projectId: string,
    metadata: Record<string, unknown> = {},
  ): Promise<string[]> {
    const chunks = this.chunkText(summary, CHUNK_SIZE, CHUNK_OVERLAP);
    const pointIds: string[] = [];

    // Embed all chunks in parallel (batched)
    const embeddings = await Promise.all(
      chunks.map((chunk) => this.embedText(chunk)),
    );

    const points = chunks.map((chunk, i) => {
      const pointId = uuidv4();
      pointIds.push(pointId);
      return {
        id: pointId,
        vector: embeddings[i]!,
        payload: {
          text: chunk,
          chunk_index: i,
          total_chunks: chunks.length,
          project_id: projectId,
          created_at: new Date().toISOString(),
          ...metadata,
        },
      };
    });

    if (points.length > 0) {
      await qdrant.upsert(RESEARCH_COLLECTION, { points });
    }

    await this.log("research_stored", projectId, {
      pointIds,
      chunkCount: chunks.length,
    });

    return pointIds;
  }

  // -----------------------------------------------------------------------
  // Text chunking helper
  // -----------------------------------------------------------------------

  /**
   * Split text into overlapping chunks for embedding storage.
   */
  private chunkText(
    text: string,
    chunkSize: number,
    overlap: number,
  ): string[] {
    if (text.length <= chunkSize) {
      return [text];
    }

    const chunks: string[] = [];
    let start = 0;

    while (start < text.length) {
      let end = start + chunkSize;

      // Try to break at a sentence boundary
      if (end < text.length) {
        const slice = text.slice(start, end);
        const lastPeriod = slice.lastIndexOf(". ");
        const lastNewline = slice.lastIndexOf("\n");
        const breakPoint = Math.max(lastPeriod, lastNewline);
        if (breakPoint > chunkSize * 0.5) {
          end = start + breakPoint + 1;
        }
      }

      chunks.push(text.slice(start, Math.min(end, text.length)).trim());
      start = end - overlap;

      if (start >= text.length) break;
    }

    return chunks.filter((c) => c.length > 0);
  }

  // -----------------------------------------------------------------------
  // Entry point
  // -----------------------------------------------------------------------

  async process(event: AgentEvent): Promise<AgentResult> {
    if (event.type !== "research_request") {
      return {
        status: "error",
        agent: this.name,
        message: `Research agent cannot handle event type: ${event.type}`,
      };
    }

    try {
      const query = event.data["query"] as string;
      if (!query) {
        return {
          status: "error",
          agent: this.name,
          message: "Research request requires a query",
        };
      }

      const projectId =
        event.projectId ?? (event.data["projectId"] as string | undefined);
      const summary = await this.research(query, projectId);

      return {
        status: "success",
        agent: this.name,
        message: `Research complete: "${query}" — ${summary.keyFindings.length} key findings`,
        data: summary as unknown as Record<string, unknown>,
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error("Research agent error", { error: message });
      await this.log("research_error", event.projectId, { error: message });
      return { status: "error", agent: this.name, message };
    }
  }
}

// ---------------------------------------------------------------------------
// Singleton
// ---------------------------------------------------------------------------

export const researchAgent = new ResearchAgent();
