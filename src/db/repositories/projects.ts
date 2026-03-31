import { query } from "../connection.js";

export interface Project {
  id: string;
  name: string;
  client: string | null;
  status: string;
  priority: number;
  metadata: Record<string, unknown>;
  created_at: Date;
  updated_at: Date;
}

export interface CreateProjectInput {
  name: string;
  client?: string;
  status?: string;
  priority?: number;
  metadata?: Record<string, unknown>;
}

export interface UpdateProjectInput {
  name?: string;
  client?: string;
  status?: string;
  priority?: number;
  metadata?: Record<string, unknown>;
}

export async function getAll(): Promise<Project[]> {
  const result = await query<Project>(
    "SELECT * FROM projects ORDER BY priority ASC, name ASC",
  );
  return result.rows;
}

export async function getById(id: string): Promise<Project | null> {
  const result = await query<Project>(
    "SELECT * FROM projects WHERE id = $1",
    [id],
  );
  return result.rows[0] ?? null;
}

export async function getByName(name: string): Promise<Project | null> {
  const result = await query<Project>(
    "SELECT * FROM projects WHERE LOWER(name) = LOWER($1)",
    [name],
  );
  return result.rows[0] ?? null;
}

export async function create(input: CreateProjectInput): Promise<Project> {
  const result = await query<Project>(
    `INSERT INTO projects (name, client, status, priority, metadata)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING *`,
    [
      input.name,
      input.client ?? null,
      input.status ?? "active",
      input.priority ?? 3,
      JSON.stringify(input.metadata ?? {}),
    ],
  );
  return result.rows[0]!;
}

export async function update(
  id: string,
  input: UpdateProjectInput,
): Promise<Project | null> {
  const fields: string[] = [];
  const values: unknown[] = [];
  let idx = 1;

  if (input.name !== undefined) {
    fields.push(`name = $${idx++}`);
    values.push(input.name);
  }
  if (input.client !== undefined) {
    fields.push(`client = $${idx++}`);
    values.push(input.client);
  }
  if (input.status !== undefined) {
    fields.push(`status = $${idx++}`);
    values.push(input.status);
  }
  if (input.priority !== undefined) {
    fields.push(`priority = $${idx++}`);
    values.push(input.priority);
  }
  if (input.metadata !== undefined) {
    fields.push(`metadata = $${idx++}`);
    values.push(JSON.stringify(input.metadata));
  }

  if (fields.length === 0) return getById(id);

  fields.push(`updated_at = now()`);
  values.push(id);

  const result = await query<Project>(
    `UPDATE projects SET ${fields.join(", ")} WHERE id = $${idx} RETURNING *`,
    values,
  );
  return result.rows[0] ?? null;
}

export async function getActive(): Promise<Project[]> {
  const result = await query<Project>(
    "SELECT * FROM projects WHERE status = 'active' ORDER BY priority ASC, name ASC",
  );
  return result.rows;
}
