import "dotenv/config";
import { QdrantClient } from "@qdrant/js-client-rest";
import cron from "node-cron";
import { config } from "./config/index.js";
import { logger } from "./config/logger.js";
import { pool } from "./db/connection.js";
import { redis } from "./db/redis.js";
import { createServer } from "./server/index.js";
import { setupWebhook, launchPolling, stopBot, sendBriefingDirect } from "./telegram/bot.js";

// ---------------------------------------------------------------------------
// Qdrant clients
// ---------------------------------------------------------------------------
const qdrant = new QdrantClient({
  url: config.qdrant.url,
});

const qdrantSwre = config.qdrant.swreUrl
  ? new QdrantClient({ url: config.qdrant.swreUrl })
  : null;

async function initQdrantCollections(): Promise<void> {
  const collections = [
    { name: "openclaw_notes", size: 1536 },
    { name: "openclaw_emails", size: 1536 },
    { name: "openclaw_contacts", size: 1536 },
  ];

  for (const { name, size } of collections) {
    try {
      const exists = await qdrant.collectionExists(name);
      if (!exists.exists) {
        await qdrant.createCollection(name, {
          vectors: { size, distance: "Cosine" },
        });
        logger.info(`Qdrant collection created: ${name}`);
      } else {
        logger.debug(`Qdrant collection exists: ${name}`);
      }
    } catch (err) {
      logger.error(`Failed to init Qdrant collection: ${name}`, { error: err });
    }
  }

  // SWRE-specific collection
  if (qdrantSwre) {
    try {
      const name = "swre_knowledge";
      const exists = await qdrantSwre.collectionExists(name);
      if (!exists.exists) {
        await qdrantSwre.createCollection(name, {
          vectors: { size: 1536, distance: "Cosine" },
        });
        logger.info(`Qdrant SWRE collection created: ${name}`);
      }
    } catch (err) {
      logger.error("Failed to init SWRE Qdrant collection", { error: err });
    }
  }
}

// ---------------------------------------------------------------------------
// Database health checks
// ---------------------------------------------------------------------------
async function checkPostgres(): Promise<void> {
  const result = await pool.query("SELECT 1 AS ok");
  if (result.rows[0]?.ok !== 1) {
    throw new Error("PostgreSQL health check failed");
  }
  logger.info("PostgreSQL connected");
}

async function checkRedis(): Promise<void> {
  const pong = await redis.ping();
  if (pong !== "PONG") {
    throw new Error("Redis health check failed");
  }
  logger.info("Redis connected");
}

// ---------------------------------------------------------------------------
// Cron jobs
// ---------------------------------------------------------------------------
const cronJobs: cron.ScheduledTask[] = [];

function startCronJobs(): void {
  // Morning briefing: 8:00 AM CST daily
  // CST is UTC-6, so 8 AM CST = 14:00 UTC
  const briefingJob = cron.schedule(
    "0 14 * * *",
    async () => {
      logger.info("Cron: morning briefing triggered");
      try {
        await sendBriefingDirect();
      } catch (err) {
        logger.error("Cron: morning briefing failed", { error: err });
      }
    },
    { timezone: "America/Chicago" },
  );
  cronJobs.push(briefingJob);

  // Gmail check: every 15 minutes
  const gmailJob = cron.schedule("*/15 * * * *", () => {
    logger.debug("Cron: Gmail check triggered");
    // TODO: invoke Gmail check agent
  });
  cronJobs.push(gmailJob);

  // Calendar pre-brief: every hour
  const calendarJob = cron.schedule("0 * * * *", () => {
    logger.debug("Cron: calendar pre-brief triggered");
    // TODO: invoke calendar agent
  });
  cronJobs.push(calendarJob);

  // Ingestion queue processing: every 5 minutes
  const ingestionJob = cron.schedule("*/5 * * * *", () => {
    logger.debug("Cron: ingestion queue triggered");
    // TODO: invoke ingestion agent
  });
  cronJobs.push(ingestionJob);

  logger.info("Cron jobs started", {
    jobs: ["morning_briefing", "gmail_check", "calendar_prebrief", "ingestion_queue"],
  });
}

function stopCronJobs(): void {
  for (const job of cronJobs) {
    job.stop();
  }
  cronJobs.length = 0;
  logger.info("Cron jobs stopped");
}

// ---------------------------------------------------------------------------
// Graceful shutdown
// ---------------------------------------------------------------------------
let isShuttingDown = false;

async function gracefulShutdown(signal: string): Promise<void> {
  if (isShuttingDown) return;
  isShuttingDown = true;

  logger.info(`Received ${signal}. Starting graceful shutdown...`);

  // Stop accepting new requests
  stopBot();
  stopCronJobs();

  // Close connections with a timeout
  const shutdownTimeout = setTimeout(() => {
    logger.error("Shutdown timed out after 10s, forcing exit");
    process.exit(1);
  }, 10_000);

  try {
    await Promise.allSettled([
      pool.end().then(() => logger.info("PostgreSQL pool closed")),
      redis.quit().then(() => logger.info("Redis disconnected")),
    ]);

    clearTimeout(shutdownTimeout);
    logger.info("Graceful shutdown complete");
    process.exit(0);
  } catch (err) {
    logger.error("Error during shutdown", { error: err });
    clearTimeout(shutdownTimeout);
    process.exit(1);
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function main(): Promise<void> {
  logger.info("==================================================");
  logger.info("  OpenClaw Personal OS starting...");
  logger.info("==================================================");
  logger.info(`Environment: ${config.app.env}`);

  // 1. Database connections
  await checkPostgres();
  await checkRedis();

  // 2. Qdrant collections
  await initQdrantCollections();

  // 3. Express server
  const app = createServer();
  const port = config.app.port;

  // 4. Telegram bot
  if (config.telegram.botToken) {
    if (config.app.isProduction) {
      // Webhook mode in production
      const webhookUrl = `${process.env["APP_BASE_URL"] ?? `http://localhost:${port}`}/webhooks/telegram`;
      const webhookMiddleware = setupWebhook(webhookUrl);
      app.use(webhookMiddleware);
      logger.info("Telegram bot configured in webhook mode");
    } else {
      // Polling mode in development
      void launchPolling().catch((err) => {
        logger.error("Failed to launch Telegram bot in polling mode", {
          error: err,
        });
      });
    }
  } else {
    logger.warn("TELEGRAM_BOT_TOKEN not set; Telegram bot disabled");
  }

  // 5. Start HTTP server
  const server = app.listen(port, () => {
    logger.info(`Server listening on port ${port}`);
  });

  // 6. Cron jobs
  startCronJobs();

  // 7. Register shutdown handlers
  const signals: NodeJS.Signals[] = ["SIGINT", "SIGTERM"];
  for (const signal of signals) {
    process.on(signal, () => {
      // Also close the HTTP server
      server.close(() => {
        logger.info("HTTP server closed");
      });
      void gracefulShutdown(signal);
    });
  }

  process.on("uncaughtException", (err) => {
    logger.error("Uncaught exception", { error: err.message, stack: err.stack });
    void gracefulShutdown("uncaughtException");
  });

  process.on("unhandledRejection", (reason) => {
    logger.error("Unhandled rejection", {
      reason: reason instanceof Error ? reason.message : String(reason),
    });
  });

  logger.info("==================================================");
  logger.info("  OpenClaw Personal OS ready.");
  logger.info("==================================================");
}

main().catch((err) => {
  logger.error("Fatal startup error", { error: err });
  process.exit(1);
});
