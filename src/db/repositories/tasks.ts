import { query } from "../connection.js";

export interface Task {
  id: string;
  project_id: string | null;
  source: string | null;
  source_ref: string | null;
  title: string;
  description: string | null;
  status: string;
  priority: number;
  due_date: string | null;
  agent_handled: boolean;
  escalated_to_bryson: boolean;
  escalation_reason: string | null;
  created_at: Date;
  updated_at: Date;
}

export interface CreateTaskInput {
  project_id?: string;
  source?: string;
  source_ref?: string;
  title: string;
  description?: string;
  status?: string;
  priority?: number;
  due_date?: string;
  agent_handled?: boolean;
}

export interface UpdateTaskInput {
  project_id?: string;
  source?: string;
  source_ref?: string;
  title?: string;
  description?: string;
  status?: string;
  priority?: number;
  due_date?: string | null;
  agent_handled?: boolean;
  escalated_to_bryson?: boolean;
  escalation_reason?: string;
}

export async function getAll(): Promise<Task[]> {
  const result = await query<Task>(
    "SELECT * FROM tasks ORDER BY priority ASC, created_at DESC",
  );
  return result.rows;
}

export async function getById(id: string): Promise<Task | null> {
  const result = await query<Task>("SELECT * FROM tasks WHERE id = $1", [id]);
  return result.rows[0] ?? null;
}

export async function getByProjectId(projectId: string): Promise<Task[]> {
  const result = await query<Task>(
    "SELECT * FROM tasks WHERE project_id = $1 ORDER BY priority ASC, created_at DESC",
    [projectId],
  );
  return result.rows;
}

export async function getOpen(): Promise<Task[]> {
  const result = await query<Task>(
    "SELECT * FROM tasks WHERE status = 'open' ORDER BY priority ASC, created_at DESC",
  );
  return result.rows;
}

export async function getOverdue(): Promise<Task[]> {
  const result = await query<Task>(
    "SELECT * FROM tasks WHERE status = 'open' AND due_date < CURRENT_DATE ORDER BY due_date ASC, priority ASC",
  );
  return result.rows;
}

export async function create(input: CreateTaskInput): Promise<Task> {
  const result = await query<Task>(
    `INSERT INTO tasks (project_id, source, source_ref, title, description, status, priority, due_date, agent_handled)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     RETURNING *`,
    [
      input.project_id ?? null,
      input.source ?? null,
      input.source_ref ?? null,
      input.title,
      input.description ?? null,
      input.status ?? "open",
      input.priority ?? 3,
      input.due_date ?? null,
      input.agent_handled ?? false,
    ],
  );
  return result.rows[0]!;
}

export async function update(
  id: string,
  input: UpdateTaskInput,
): Promise<Task | null> {
  const fields: string[] = [];
  const values: unknown[] = [];
  let idx = 1;

  if (input.project_id !== undefined) {
    fields.push(`project_id = $${idx++}`);
    values.push(input.project_id);
  }
  if (input.source !== undefined) {
    fields.push(`source = $${idx++}`);
    values.push(input.source);
  }
  if (input.source_ref !== undefined) {
    fields.push(`source_ref = $${idx++}`);
    values.push(input.source_ref);
  }
  if (input.title !== undefined) {
    fields.push(`title = $${idx++}`);
    values.push(input.title);
  }
  if (input.description !== undefined) {
    fields.push(`description = $${idx++}`);
    values.push(input.description);
  }
  if (input.status !== undefined) {
    fields.push(`status = $${idx++}`);
    values.push(input.status);
  }
  if (input.priority !== undefined) {
    fields.push(`priority = $${idx++}`);
    values.push(input.priority);
  }
  if (input.due_date !== undefined) {
    fields.push(`due_date = $${idx++}`);
    values.push(input.due_date);
  }
  if (input.agent_handled !== undefined) {
    fields.push(`agent_handled = $${idx++}`);
    values.push(input.agent_handled);
  }
  if (input.escalated_to_bryson !== undefined) {
    fields.push(`escalated_to_bryson = $${idx++}`);
    values.push(input.escalated_to_bryson);
  }
  if (input.escalation_reason !== undefined) {
    fields.push(`escalation_reason = $${idx++}`);
    values.push(input.escalation_reason);
  }

  if (fields.length === 0) return getById(id);

  fields.push(`updated_at = now()`);
  values.push(id);

  const result = await query<Task>(
    `UPDATE tasks SET ${fields.join(", ")} WHERE id = $${idx} RETURNING *`,
    values,
  );
  return result.rows[0] ?? null;
}

export async function markDone(id: string): Promise<Task | null> {
  const result = await query<Task>(
    "UPDATE tasks SET status = 'done', updated_at = now() WHERE id = $1 RETURNING *",
    [id],
  );
  return result.rows[0] ?? null;
}

export async function markEscalated(
  id: string,
  reason: string,
): Promise<Task | null> {
  const result = await query<Task>(
    `UPDATE tasks SET escalated_to_bryson = true, escalation_reason = $2, updated_at = now()
     WHERE id = $1 RETURNING *`,
    [id, reason],
  );
  return result.rows[0] ?? null;
}
