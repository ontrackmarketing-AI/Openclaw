import { query } from "../connection.js";

export interface InboxEvent {
  id: string;
  channel: string;
  external_id: string | null;
  sender: string | null;
  contact_id: string | null;
  project_id: string | null;
  subject: string | null;
  body_summary: string | null;
  intent: string | null;
  agent_action: string | null;
  escalated: boolean;
  processed_at: Date;
}

export interface CreateInboxEventInput {
  channel: string;
  external_id?: string;
  sender?: string;
  contact_id?: string;
  project_id?: string;
  subject?: string;
  body_summary?: string;
  intent?: string;
  agent_action?: string;
  escalated?: boolean;
}

export async function create(
  input: CreateInboxEventInput,
): Promise<InboxEvent> {
  const result = await query<InboxEvent>(
    `INSERT INTO inbox_events (channel, external_id, sender, contact_id, project_id, subject, body_summary, intent, agent_action, escalated)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
     RETURNING *`,
    [
      input.channel,
      input.external_id ?? null,
      input.sender ?? null,
      input.contact_id ?? null,
      input.project_id ?? null,
      input.subject ?? null,
      input.body_summary ?? null,
      input.intent ?? null,
      input.agent_action ?? null,
      input.escalated ?? false,
    ],
  );
  return result.rows[0]!;
}

export async function getByChannel(channel: string): Promise<InboxEvent[]> {
  const result = await query<InboxEvent>(
    "SELECT * FROM inbox_events WHERE channel = $1 ORDER BY processed_at DESC",
    [channel],
  );
  return result.rows;
}

export async function getRecent(limit = 50): Promise<InboxEvent[]> {
  const result = await query<InboxEvent>(
    "SELECT * FROM inbox_events ORDER BY processed_at DESC LIMIT $1",
    [limit],
  );
  return result.rows;
}

/**
 * Check if an event with the given channel + external_id already exists.
 * Useful to avoid duplicate processing.
 */
export async function isDuplicate(
  channel: string,
  externalId: string,
): Promise<boolean> {
  const result = await query<{ exists: boolean }>(
    "SELECT EXISTS(SELECT 1 FROM inbox_events WHERE channel = $1 AND external_id = $2) AS exists",
    [channel, externalId],
  );
  return result.rows[0]?.exists ?? false;
}
