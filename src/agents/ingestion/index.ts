import Fuse from "fuse.js";
import OpenAI from "openai";
import { v4 as uuidv4 } from "uuid";
import { BaseAgent, AgentEvent, AgentResult } from "../base.js";
import { config } from "../../config/index.js";
import { logger } from "../../config/logger.js";
import * as projectsRepo from "../../db/repositories/projects.js";
import * as notesRepo from "../../db/repositories/notes.js";
import * as tasksRepo from "../../db/repositories/tasks.js";
import { qdrant } from "../../db/qdrant.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const CHUNK_SIZE = 512; // tokens (approximation: 1 token ~ 4 chars)
const CHUNK_OVERLAP = 50;
const EMBEDDING_MODEL = "text-embedding-3-small";
const COLLECTION = "bryson_notes";

/** Characters per token approximation for chunking. */
const CHARS_PER_TOKEN = 4;

// ---------------------------------------------------------------------------
// Vision prompt — contains all known abbreviations from the PRD
// ---------------------------------------------------------------------------

const VISION_SYSTEM_PROMPT = `You are a precise handwriting-to-structured-data extraction system for Bryson Stevens' personal operating system (OpenClaw).

Bryson writes quick notes by hand. Your job is to extract EVERY piece of information faithfully — tasks, decisions, questions, project references, dates, names, and any other content.

KNOWN ABBREVIATIONS — expand these when you encounter them:
- TTT = Texas Tree Tops (client / project)
- SWRE = Southwest Real Estate (client / project)
- HS = Helium Solutions (Bryson's agency)
- OTM = OnTrack Marketing (Bryson's SaaS product)
- GHL = GoHighLevel (CRM platform)
- ST = Search Tuners (partnership with Mike)
- DW = deep work
- MTG = meeting
- FU = follow up
- ASAP = as soon as possible
- EOD = end of day
- EOW = end of week
- WK = week
- Q = question

INSTRUCTIONS:
1. Transcribe ALL handwritten text exactly as written, preserving abbreviations in the raw text.
2. Identify and extract every task (anything that implies something needs to be done).
3. Identify project references — match to the known abbreviations above or flag as unknown.
4. Identify decisions (things Bryson has decided).
5. Identify questions (things Bryson is uncertain about or needs answered).
6. Note any dates, deadlines, or time references.
7. If something is ambiguous or you cannot read it, mark it as "[unclear]" — do NOT guess.

OUTPUT FORMAT — respond with valid JSON only, no markdown fences:
{
  "raw_text": "Full transcription of all handwritten text",
  "tasks": [
    {
      "title": "Task description (expanded abbreviations)",
      "project_ref": "Project abbreviation or null",
      "priority_hint": "high/medium/low or null",
      "due_hint": "Any deadline mentioned or null"
    }
  ],
  "decisions": [
    {
      "text": "What was decided",
      "project_ref": "Project abbreviation or null"
    }
  ],
  "questions": [
    {
      "text": "The question",
      "project_ref": "Project abbreviation or null"
    }
  ],
  "project_refs": ["List of all project abbreviations found"],
  "unclear_items": ["List of anything you could not confidently read"]
}`;

const VISION_USER_PROMPT =
  "Extract all content from this handwritten notebook page. Follow the output format exactly.";

// ---------------------------------------------------------------------------
// Structured extraction types
// ---------------------------------------------------------------------------

interface ExtractedNote {
  raw_text: string;
  tasks: {
    title: string;
    project_ref: string | null;
    priority_hint: string | null;
    due_hint: string | null;
  }[];
  decisions: { text: string; project_ref: string | null }[];
  questions: { text: string; project_ref: string | null }[];
  project_refs: string[];
  unclear_items: string[];
}

interface IngestionResult {
  noteId: string;
  projectId: string | null;
  taskCount: number;
  decisionCount: number;
  questionCount: number;
  unclearCount: number;
  matchedProjects: { ref: string; projectId: string; projectName: string }[];
  unmatchedRefs: string[];
}

// ---------------------------------------------------------------------------
// Ingestion Agent
// ---------------------------------------------------------------------------

export class IngestionAgent extends BaseAgent {
  private openai: OpenAI;

  constructor() {
    super("ingestion");
    this.openai = new OpenAI({ apiKey: config.openai.apiKey });
  }

  // -----------------------------------------------------------------------
  // Main pipeline
  // -----------------------------------------------------------------------

  /**
   * Full ingestion pipeline: Vision -> structure -> match -> store -> embed.
   */
  async processImage(
    imageBuffer: Buffer,
    source: string = "telegram",
  ): Promise<IngestionResult> {
    await this.log("process_image_start", undefined, { source });

    // 1. Extract with Claude Vision
    const extracted = await this.extractWithVision(imageBuffer);
    await this.log("vision_extraction_complete", undefined, {
      taskCount: extracted.tasks.length,
      projectRefs: extracted.project_refs,
    });

    // 2. Match project references to known projects
    const { matched, unmatched } = await this.matchProjects(
      extracted.project_refs,
    );

    // Pick the primary project (first matched, or null)
    const primaryProjectId =
      matched.length > 0 ? matched[0]!.projectId : null;

    // 3. Store the note in PostgreSQL
    const note = await this.storeNote(extracted, primaryProjectId, source);

    // 4. Create tasks from extracted items
    for (const task of extracted.tasks) {
      const taskProjectMatch = matched.find(
        (m) => m.ref === task.project_ref,
      );
      await tasksRepo.create({
        project_id: taskProjectMatch?.projectId ?? primaryProjectId ?? undefined,
        source: "notebook",
        source_ref: note.id,
        title: task.title,
        priority: task.priority_hint === "high" ? 1 : task.priority_hint === "low" ? 5 : 3,
        due_date: task.due_hint ?? undefined,
      });
    }

    // 5. Embed the note text into Qdrant
    await this.embedChunks(extracted.raw_text, note.id, primaryProjectId);

    const result: IngestionResult = {
      noteId: note.id,
      projectId: primaryProjectId,
      taskCount: extracted.tasks.length,
      decisionCount: extracted.decisions.length,
      questionCount: extracted.questions.length,
      unclearCount: extracted.unclear_items.length,
      matchedProjects: matched,
      unmatchedRefs: unmatched,
    };

    await this.log("process_image_complete", primaryProjectId, {
      noteId: note.id,
      taskCount: result.taskCount,
    });

    return result;
  }

  // -----------------------------------------------------------------------
  // Vision extraction
  // -----------------------------------------------------------------------

  /**
   * Call Claude Vision to extract structured data from a notebook image.
   */
  async extractWithVision(imageBuffer: Buffer): Promise<ExtractedNote> {
    const imageBase64 = imageBuffer.toString("base64");

    // Detect media type from buffer magic bytes
    const mediaType = this.detectMediaType(imageBuffer);

    const raw = await this.callClaudeVision(
      VISION_SYSTEM_PROMPT,
      VISION_USER_PROMPT,
      imageBase64,
      mediaType,
      { maxTokens: 4096 },
    );

    try {
      // Strip markdown fences if Claude wraps them despite instructions
      const cleaned = raw.replace(/^```(?:json)?\n?/m, "").replace(/\n?```$/m, "");
      const parsed = JSON.parse(cleaned) as ExtractedNote;
      return parsed;
    } catch (err) {
      logger.error("Failed to parse Vision extraction JSON", {
        error: err instanceof Error ? err.message : String(err),
        rawLength: raw.length,
      });
      // Return a minimal structure so the pipeline doesn't crash
      return {
        raw_text: raw,
        tasks: [],
        decisions: [],
        questions: [],
        project_refs: [],
        unclear_items: ["Failed to parse structured output — raw text preserved"],
      };
    }
  }

  // -----------------------------------------------------------------------
  // Project matching
  // -----------------------------------------------------------------------

  /**
   * Fuzzy-match extracted project references against the projects table.
   */
  async matchProjects(refs: string[]): Promise<{
    matched: { ref: string; projectId: string; projectName: string }[];
    unmatched: string[];
  }> {
    if (refs.length === 0) return { matched: [], unmatched: [] };

    const projects = await projectsRepo.getAll();

    // Build a Fuse index over project names, clients, and common abbreviations
    const searchItems = projects.map((p) => ({
      id: p.id,
      name: p.name,
      client: p.client ?? "",
      aliases: this.getProjectAliases(p.name),
    }));

    const fuse = new Fuse(searchItems, {
      keys: ["name", "client", "aliases"],
      threshold: 0.4,
      includeScore: true,
    });

    const matched: { ref: string; projectId: string; projectName: string }[] = [];
    const unmatched: string[] = [];

    for (const ref of refs) {
      const results = fuse.search(ref);
      if (results.length > 0 && results[0]!.score !== undefined && results[0]!.score < 0.4) {
        const best = results[0]!.item;
        matched.push({ ref, projectId: best.id, projectName: best.name });
      } else {
        unmatched.push(ref);
      }
    }

    await this.log("project_matching_complete", undefined, {
      matchedCount: matched.length,
      unmatchedCount: unmatched.length,
      unmatchedRefs: unmatched,
    });

    return { matched, unmatched };
  }

  // -----------------------------------------------------------------------
  // Storage
  // -----------------------------------------------------------------------

  /**
   * Write the structured note to PostgreSQL.
   */
  async storeNote(
    structured: ExtractedNote,
    projectId: string | null,
    source: string = "notebook",
  ): Promise<notesRepo.Note> {
    const note = await notesRepo.create({
      project_id: projectId ?? undefined,
      source,
      raw_text: structured.raw_text,
      structured: structured as unknown as Record<string, unknown>,
    });

    await this.log("note_stored", projectId ?? undefined, { noteId: note.id });
    return note;
  }

  // -----------------------------------------------------------------------
  // Embedding
  // -----------------------------------------------------------------------

  /**
   * Chunk text into ~512-token segments with 50-token overlap,
   * embed each chunk with OpenAI text-embedding-3-small,
   * and write to the bryson_notes Qdrant collection.
   */
  async embedChunks(
    text: string,
    noteId: string,
    projectId: string | null,
  ): Promise<string[]> {
    const chunks = this.chunkText(text);
    if (chunks.length === 0) return [];

    const pointIds: string[] = [];

    // Embed all chunks in a single API call (batch)
    const embeddingResponse = await this.openai.embeddings.create({
      model: EMBEDDING_MODEL,
      input: chunks,
    });

    const points = embeddingResponse.data.map((item, idx) => {
      const pointId = uuidv4();
      pointIds.push(pointId);
      return {
        id: pointId,
        vector: item.embedding,
        payload: {
          note_id: noteId,
          project_id: projectId,
          chunk_index: idx,
          text: chunks[idx],
          created_at: new Date().toISOString(),
        },
      };
    });

    await qdrant.upsert(COLLECTION, { points });

    // Update the note record with qdrant point IDs
    // We do a raw update since the repo doesn't expose qdrant_ids update
    await notesRepo.create; // noop reference — we update via the note object below
    // Actually, notes repo doesn't have an update method, so we store qdrant_ids during creation.
    // For post-creation update, we go direct:
    const { query: dbQuery } = await import("../../db/connection.js");
    await dbQuery("UPDATE notes SET qdrant_ids = $1 WHERE id = $2", [
      pointIds,
      noteId,
    ]);

    await this.log("chunks_embedded", projectId ?? undefined, {
      noteId,
      chunkCount: chunks.length,
      pointIds,
    });

    return pointIds;
  }

  // -----------------------------------------------------------------------
  // Telegram confirmation
  // -----------------------------------------------------------------------

  /**
   * Format a human-readable Telegram message summarising the ingestion result.
   */
  formatConfirmation(result: IngestionResult): string {
    const lines: string[] = [];
    lines.push("📓 *Notebook Ingested*\n");

    if (result.matchedProjects.length > 0) {
      const names = result.matchedProjects
        .map((m) => m.projectName)
        .join(", ");
      lines.push(`*Projects:* ${names}`);
    }

    lines.push(`*Tasks found:* ${result.taskCount}`);
    lines.push(`*Decisions:* ${result.decisionCount}`);
    lines.push(`*Questions:* ${result.questionCount}`);

    if (result.unclearCount > 0) {
      lines.push(`\n⚠️ ${result.unclearCount} unclear items need your review.`);
    }

    if (result.unmatchedRefs.length > 0) {
      lines.push(
        `\n❓ Unmatched project refs: ${result.unmatchedRefs.join(", ")}`,
      );
    }

    return lines.join("\n");
  }

  // -----------------------------------------------------------------------
  // Entry point
  // -----------------------------------------------------------------------

  async process(event: AgentEvent): Promise<AgentResult> {
    if (event.type !== "notebook_image") {
      return {
        status: "error",
        agent: this.name,
        message: `Ingestion agent cannot handle event type: ${event.type}`,
      };
    }

    try {
      const imageBase64 = event.data["imageBase64"] as string | undefined;
      const imagePath = event.data["imagePath"] as string | undefined;
      const source = (event.data["source"] as string) ?? "telegram";

      let imageBuffer: Buffer;
      if (imageBase64) {
        imageBuffer = Buffer.from(imageBase64, "base64");
      } else if (imagePath) {
        const fs = await import("node:fs/promises");
        imageBuffer = await fs.readFile(imagePath);
      } else {
        return {
          status: "error",
          agent: this.name,
          message: "No image data provided (need imageBase64 or imagePath)",
        };
      }

      const result = await this.processImage(imageBuffer, source);
      const confirmation = this.formatConfirmation(result);

      return {
        status: result.unclearCount > 0 || result.unmatchedRefs.length > 0
          ? "partial"
          : "success",
        agent: this.name,
        message: confirmation,
        data: result as unknown as Record<string, unknown>,
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error("Ingestion agent error", { error: message });
      await this.log("process_error", event.projectId, { error: message });
      return { status: "error", agent: this.name, message };
    }
  }

  // -----------------------------------------------------------------------
  // Helpers
  // -----------------------------------------------------------------------

  private chunkText(text: string): string[] {
    if (!text || text.trim().length === 0) return [];

    const chunkChars = CHUNK_SIZE * CHARS_PER_TOKEN;
    const overlapChars = CHUNK_OVERLAP * CHARS_PER_TOKEN;
    const chunks: string[] = [];

    let start = 0;
    while (start < text.length) {
      const end = Math.min(start + chunkChars, text.length);
      const chunk = text.slice(start, end).trim();
      if (chunk.length > 0) {
        chunks.push(chunk);
      }
      start += chunkChars - overlapChars;
    }

    return chunks;
  }

  private detectMediaType(
    buffer: Buffer,
  ): "image/jpeg" | "image/png" | "image/webp" | "image/gif" {
    if (buffer[0] === 0xff && buffer[1] === 0xd8) return "image/jpeg";
    if (
      buffer[0] === 0x89 &&
      buffer[1] === 0x50 &&
      buffer[2] === 0x4e &&
      buffer[3] === 0x47
    )
      return "image/png";
    if (
      buffer[0] === 0x52 &&
      buffer[1] === 0x49 &&
      buffer[2] === 0x46 &&
      buffer[3] === 0x46
    )
      return "image/webp";
    if (buffer[0] === 0x47 && buffer[1] === 0x49 && buffer[2] === 0x46)
      return "image/gif";
    return "image/jpeg"; // default fallback
  }

  private getProjectAliases(name: string): string {
    const aliasMap: Record<string, string[]> = {
      "Texas Tree Tops": ["TTT", "texas tree", "tree tops"],
      "Southwest Real Estate": ["SWRE", "southwest", "sw real estate"],
      "Helium Solutions": ["HS", "helium"],
      "OnTrack Marketing": ["OTM", "ontrack", "on track"],
      "Search Tuners": ["ST", "search tuners", "searchtuners"],
    };

    for (const [key, aliases] of Object.entries(aliasMap)) {
      if (name.toLowerCase().includes(key.toLowerCase())) {
        return aliases.join(" ");
      }
    }
    return "";
  }
}
