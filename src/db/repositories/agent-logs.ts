import { query } from "../connection.js";

export interface AgentLog {
  id: string;
  agent: string;
  event: string;
  project_id: string | null;
  metadata: Record<string, unknown>;
  created_at: Date;
}

export interface LogInput {
  agent: string;
  event: string;
  project_id?: string;
  metadata?: Record<string, unknown>;
}

/**
 * Create a new agent log entry.
 */
export async function log(input: LogInput): Promise<AgentLog> {
  const result = await query<AgentLog>(
    `INSERT INTO agent_logs (agent, event, project_id, metadata)
     VALUES ($1, $2, $3, $4)
     RETURNING *`,
    [
      input.agent,
      input.event,
      input.project_id ?? null,
      JSON.stringify(input.metadata ?? {}),
    ],
  );
  return result.rows[0]!;
}

export async function getByAgent(agent: string): Promise<AgentLog[]> {
  const result = await query<AgentLog>(
    "SELECT * FROM agent_logs WHERE agent = $1 ORDER BY created_at DESC",
    [agent],
  );
  return result.rows;
}

/**
 * Get agent logs from the last 24 hours.
 */
export async function getRecent(limit = 100): Promise<AgentLog[]> {
  const result = await query<AgentLog>(
    "SELECT * FROM agent_logs WHERE created_at > now() - INTERVAL '24 hours' ORDER BY created_at DESC LIMIT $1",
    [limit],
  );
  return result.rows;
}
