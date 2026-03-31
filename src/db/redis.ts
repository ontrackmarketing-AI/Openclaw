import Redis from "ioredis";
import { config } from "../config/index.js";

export const redis = new Redis(config.redis.url, {
  maxRetriesPerRequest: null,
  retryStrategy(times) {
    const delay = Math.min(times * 200, 5000);
    console.log(`[redis] Reconnecting in ${delay}ms (attempt ${times})`);
    return delay;
  },
  reconnectOnError(err) {
    const targetErrors = ["READONLY", "ECONNRESET", "ETIMEDOUT"];
    return targetErrors.some((e) => err.message.includes(e));
  },
  lazyConnect: false,
});

redis.on("connect", () => {
  console.log("[redis] Connected");
});

redis.on("ready", () => {
  console.log("[redis] Ready");
});

redis.on("error", (err) => {
  console.error("[redis] Error:", err.message);
});

redis.on("close", () => {
  console.log("[redis] Connection closed");
});

/**
 * Gracefully disconnect from Redis.
 */
export async function shutdownRedis(): Promise<void> {
  console.log("[redis] Shutting down...");
  await redis.quit();
  console.log("[redis] Disconnected");
}

const signals: NodeJS.Signals[] = ["SIGINT", "SIGTERM"];
for (const signal of signals) {
  process.on(signal, () => {
    void shutdownRedis();
  });
}
