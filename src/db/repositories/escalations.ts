import { query } from "../connection.js";

export interface Escalation {
  id: string;
  type: string | null;
  project_id: string | null;
  task_id: string | null;
  inbox_event_id: string | null;
  summary: string;
  context: string | null;
  options: Record<string, unknown> | null;
  status: string;
  telegram_message_id: string | null;
  created_at: Date;
  actioned_at: Date | null;
}

export interface CreateEscalationInput {
  type?: string;
  project_id?: string;
  task_id?: string;
  inbox_event_id?: string;
  summary: string;
  context?: string;
  options?: Record<string, unknown>;
  telegram_message_id?: string;
}

export async function create(
  input: CreateEscalationInput,
): Promise<Escalation> {
  const result = await query<Escalation>(
    `INSERT INTO escalations (type, project_id, task_id, inbox_event_id, summary, context, options, telegram_message_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     RETURNING *`,
    [
      input.type ?? null,
      input.project_id ?? null,
      input.task_id ?? null,
      input.inbox_event_id ?? null,
      input.summary,
      input.context ?? null,
      input.options ? JSON.stringify(input.options) : null,
      input.telegram_message_id ?? null,
    ],
  );
  return result.rows[0]!;
}

export async function getPending(): Promise<Escalation[]> {
  const result = await query<Escalation>(
    "SELECT * FROM escalations WHERE status = 'pending' ORDER BY created_at ASC",
  );
  return result.rows;
}

export async function getById(id: string): Promise<Escalation | null> {
  const result = await query<Escalation>(
    "SELECT * FROM escalations WHERE id = $1",
    [id],
  );
  return result.rows[0] ?? null;
}

export async function markActioned(id: string): Promise<Escalation | null> {
  const result = await query<Escalation>(
    "UPDATE escalations SET status = 'actioned', actioned_at = now() WHERE id = $1 RETURNING *",
    [id],
  );
  return result.rows[0] ?? null;
}

export async function markDismissed(id: string): Promise<Escalation | null> {
  const result = await query<Escalation>(
    "UPDATE escalations SET status = 'dismissed', actioned_at = now() WHERE id = $1 RETURNING *",
    [id],
  );
  return result.rows[0] ?? null;
}
