import { Router, type Request, type Response } from "express";
import crypto from "node:crypto";
import { config } from "../../config/index.js";
import { logger } from "../../config/logger.js";
import { notesRepo } from "../../db/repositories/index.js";

export const webhooksRouter = Router();

// ---------------------------------------------------------------------------
// POST /webhooks/telegram  -- Telegram Bot API webhook
// Telegram sends updates here. The bot instance handles them via its
// webhookCallback, but we verify the secret token header first.
// The actual handler is mounted in server/index.ts via bot.webhookCallback().
// This route exists as a fallback / documentation placeholder.
// ---------------------------------------------------------------------------
webhooksRouter.post("/telegram", (req: Request, res: Response) => {
  // If we reach here, the bot's webhookCallback middleware didn't handle it.
  // This can happen if the bot isn't initialised yet.
  const secretHeader = req.headers["x-telegram-bot-api-secret-token"];
  if (
    config.telegram.webhookSecret &&
    secretHeader !== config.telegram.webhookSecret
  ) {
    logger.warn("Telegram webhook: invalid secret token");
    res.status(403).json({ error: "Invalid secret token" });
    return;
  }

  logger.warn("Telegram webhook: received update but bot handler not attached");
  res.status(200).json({ ok: true });
});

// ---------------------------------------------------------------------------
// POST /webhooks/n8n  -- Receive events from n8n workflows
// ---------------------------------------------------------------------------
interface N8nEvent {
  type: string;
  workflow?: string;
  data?: Record<string, unknown>;
}

webhooksRouter.post("/n8n", async (req: Request, res: Response) => {
  try {
    const event = req.body as N8nEvent;

    if (!event.type) {
      res.status(400).json({ error: "Missing event type" });
      return;
    }

    // Verify n8n webhook secret if configured
    if (config.n8n.apiKey) {
      const authHeader = req.headers["x-n8n-secret"] ?? req.headers.authorization;
      const token =
        typeof authHeader === "string"
          ? authHeader.replace("Bearer ", "")
          : "";
      if (token !== config.n8n.apiKey) {
        logger.warn("n8n webhook: invalid secret", { type: event.type });
        res.status(403).json({ error: "Invalid n8n secret" });
        return;
      }
    }

    logger.info("n8n webhook received", {
      type: event.type,
      workflow: event.workflow,
    });

    // Route events to appropriate handlers
    switch (event.type) {
      case "gmail.new_email":
      case "calendar.event":
      case "drive.file_changed":
        // These would be routed to the appropriate agent
        // For now, log and acknowledge
        logger.info("n8n event queued for processing", { type: event.type });
        break;

      case "ingest": {
        const rawText =
          typeof event.data?.["raw_text"] === "string"
            ? event.data["raw_text"]
            : undefined;
        if (rawText) {
          await notesRepo.create({
            raw_text: rawText,
            source: `n8n:${event.workflow ?? "unknown"}`,
          });
        }
        break;
      }

      default:
        logger.warn("n8n webhook: unknown event type", { type: event.type });
    }

    res.json({ ok: true, received: event.type });
  } catch (err) {
    logger.error("n8n webhook error", { error: err });
    res.status(500).json({ error: "Failed to process n8n event" });
  }
});

// ---------------------------------------------------------------------------
// POST /webhooks/ghl  -- Receive GHL (GoHighLevel) webhook events
// ---------------------------------------------------------------------------
interface GhlEvent {
  type?: string;
  event?: string;
  contactId?: string;
  locationId?: string;
  [key: string]: unknown;
}

function verifyGhlSignature(
  payload: string,
  signature: string | undefined,
  secret: string,
): boolean {
  if (!signature) return false;
  const expected = crypto
    .createHmac("sha256", secret)
    .update(payload)
    .digest("hex");
  return crypto.timingSafeEqual(
    Buffer.from(signature),
    Buffer.from(expected),
  );
}

webhooksRouter.post("/ghl", async (req: Request, res: Response) => {
  try {
    // Verify GHL signature if secret is configured
    if (config.ghl.apiKey) {
      const signature = req.headers["x-ghl-signature"] as string | undefined;
      const rawBody =
        typeof req.body === "string" ? req.body : JSON.stringify(req.body);
      if (!verifyGhlSignature(rawBody, signature, config.ghl.apiKey)) {
        logger.warn("GHL webhook: invalid signature");
        res.status(403).json({ error: "Invalid GHL signature" });
        return;
      }
    }

    const event = req.body as GhlEvent;
    const eventType = event.type ?? event.event ?? "unknown";

    logger.info("GHL webhook received", {
      type: eventType,
      contactId: event.contactId,
      locationId: event.locationId,
    });

    // Route GHL events
    switch (eventType) {
      case "contact.created":
      case "contact.updated":
        logger.info("GHL contact event", { type: eventType, contactId: event.contactId });
        break;

      case "opportunity.created":
      case "opportunity.status_changed":
        logger.info("GHL opportunity event", { type: eventType });
        break;

      case "task.completed":
        logger.info("GHL task event", { type: eventType });
        break;

      default:
        logger.info("GHL event (unhandled type)", { type: eventType });
    }

    res.json({ ok: true, received: eventType });
  } catch (err) {
    logger.error("GHL webhook error", { error: err });
    res.status(500).json({ error: "Failed to process GHL event" });
  }
});
