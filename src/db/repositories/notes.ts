import { query } from "../connection.js";

export interface Note {
  id: string;
  project_id: string | null;
  source: string | null;
  raw_text: string | null;
  structured: Record<string, unknown> | null;
  image_path: string | null;
  qdrant_ids: string[] | null;
  created_at: Date;
}

export interface CreateNoteInput {
  project_id?: string;
  source?: string;
  raw_text?: string;
  structured?: Record<string, unknown>;
  image_path?: string;
  qdrant_ids?: string[];
}

export async function getAll(): Promise<Note[]> {
  const result = await query<Note>(
    "SELECT * FROM notes ORDER BY created_at DESC",
  );
  return result.rows;
}

export async function getById(id: string): Promise<Note | null> {
  const result = await query<Note>("SELECT * FROM notes WHERE id = $1", [id]);
  return result.rows[0] ?? null;
}

export async function getByProjectId(projectId: string): Promise<Note[]> {
  const result = await query<Note>(
    "SELECT * FROM notes WHERE project_id = $1 ORDER BY created_at DESC",
    [projectId],
  );
  return result.rows;
}

export async function create(input: CreateNoteInput): Promise<Note> {
  const result = await query<Note>(
    `INSERT INTO notes (project_id, source, raw_text, structured, image_path, qdrant_ids)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING *`,
    [
      input.project_id ?? null,
      input.source ?? null,
      input.raw_text ?? null,
      input.structured ? JSON.stringify(input.structured) : null,
      input.image_path ?? null,
      input.qdrant_ids ?? null,
    ],
  );
  return result.rows[0]!;
}
