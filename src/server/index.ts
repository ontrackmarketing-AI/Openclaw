import express, { type Request, type Response, type NextFunction } from "express";
import helmet from "helmet";
import cors from "cors";
import { config } from "../config/index.js";
import { logger } from "../config/logger.js";
import { authMiddleware } from "./middleware/auth.js";
import { projectsRouter } from "./routes/projects.js";
import { tasksRouter } from "./routes/tasks.js";
import { escalationsRouter } from "./routes/escalations.js";
import { notesRouter } from "./routes/notes.js";
import { ingestRouter } from "./routes/ingest.js";
import { contactsRouter } from "./routes/contacts.js";
import { webhooksRouter } from "./routes/webhooks.js";
import { briefingRouter } from "./routes/briefing.js";

export function createServer() {
  const app = express();

  // ---------------------------------------------------------------------------
  // Global middleware
  // ---------------------------------------------------------------------------
  app.use(helmet());
  app.use(cors());
  app.use(express.json({ limit: "10mb" }));
  app.use(express.urlencoded({ extended: true }));

  // Request logging
  app.use((req: Request, _res: Response, next: NextFunction) => {
    logger.debug(`${req.method} ${req.path}`, {
      ip: req.ip,
      userAgent: req.get("user-agent"),
    });
    next();
  });

  // ---------------------------------------------------------------------------
  // Health check (no auth)
  // ---------------------------------------------------------------------------
  app.get("/health", (_req: Request, res: Response) => {
    res.json({
      status: "ok",
      service: "openclaw",
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
    });
  });

  // ---------------------------------------------------------------------------
  // Auth middleware (skips /health and /webhooks/telegram)
  // ---------------------------------------------------------------------------
  app.use(authMiddleware);

  // ---------------------------------------------------------------------------
  // Webhook routes (before API routes since /webhooks/telegram has own auth)
  // ---------------------------------------------------------------------------
  app.use("/webhooks", webhooksRouter);

  // ---------------------------------------------------------------------------
  // API routes
  // ---------------------------------------------------------------------------
  app.use("/api/projects", projectsRouter);
  app.use("/api/tasks", tasksRouter);
  app.use("/api/escalations", escalationsRouter);
  app.use("/api/notes", notesRouter);
  app.use("/api/ingest", notesRouter); // POST /api/ingest handled by notesRouter
  app.use("/api/contacts", contactsRouter);
  app.use("/api/briefing", briefingRouter);

  // ---------------------------------------------------------------------------
  // 404 handler
  // ---------------------------------------------------------------------------
  app.use((_req: Request, res: Response) => {
    res.status(404).json({ error: "Not found" });
  });

  // ---------------------------------------------------------------------------
  // Error handling middleware
  // ---------------------------------------------------------------------------
  app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
    logger.error("Unhandled server error", {
      error: err.message,
      stack: err.stack,
    });
    res.status(500).json({
      error: config.app.isProduction
        ? "Internal server error"
        : err.message,
    });
  });

  return app;
}

let serverInstance: ReturnType<typeof import("node:http").createServer> | null = null;

export async function startServer(): Promise<void> {
  const app = createServer();
  const port = config.app.port;

  return new Promise((resolve) => {
    serverInstance = app.listen(port, () => {
      logger.info(`Server listening on port ${port}`);
      resolve();
    });
  });
}

export function getServerInstance() {
  return serverInstance;
}

export async function stopServer(): Promise<void> {
  if (!serverInstance) return;
  return new Promise((resolve, reject) => {
    serverInstance!.close((err) => {
      if (err) {
        logger.error("Error closing server", { error: err.message });
        reject(err);
      } else {
        logger.info("Server closed");
        serverInstance = null;
        resolve();
      }
    });
  });
}

/**
 * Returns the Express app for attaching the Telegram bot webhook.
 * Call createServer() once, then use getApp() to mount the bot.
 */
export { createServer as getApp };
