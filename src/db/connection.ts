import pg from "pg";
import { config } from "../config/index.js";

const { Pool } = pg;

export const pool = new Pool({
  connectionString: config.database.url,
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
});

pool.on("error", (err) => {
  console.error("[pg] Unexpected pool error:", err.message);
});

pool.on("connect", () => {
  console.log("[pg] New client connected");
});

/**
 * Execute a parameterized query and return the result rows.
 */
export async function query<T extends pg.QueryResultRow = pg.QueryResultRow>(
  text: string,
  params?: unknown[],
): Promise<pg.QueryResult<T>> {
  const start = Date.now();
  const result = await pool.query<T>(text, params);
  const duration = Date.now() - start;

  if (duration > 1000) {
    console.warn(`[pg] Slow query (${duration}ms):`, text.slice(0, 120));
  }

  return result;
}

/**
 * Get a single client from the pool for transactions.
 */
export async function getClient(): Promise<pg.PoolClient> {
  return pool.connect();
}

/**
 * Run a callback inside a transaction.
 */
export async function withTransaction<T>(
  fn: (client: pg.PoolClient) => Promise<T>,
): Promise<T> {
  const client = await getClient();
  try {
    await client.query("BEGIN");
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Gracefully shut down the connection pool.
 */
export async function shutdown(): Promise<void> {
  console.log("[pg] Shutting down connection pool...");
  await pool.end();
  console.log("[pg] Pool closed");
}

// Graceful shutdown on process signals
const signals: NodeJS.Signals[] = ["SIGINT", "SIGTERM"];
for (const signal of signals) {
  process.on(signal, () => {
    void shutdown();
  });
}
