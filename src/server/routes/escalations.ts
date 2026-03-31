import { Router, type Request, type Response } from "express";
import { escalationsRepo } from "../../db/repositories/index.js";
import { logger } from "../../config/logger.js";

export const escalationsRouter = Router();

// GET /api/escalations
escalationsRouter.get("/", async (_req: Request, res: Response) => {
  try {
    const escalations = await escalationsRepo.getPending();
    res.json({ data: escalations });
  } catch (err) {
    logger.error("Failed to list escalations", { error: err });
    res.status(500).json({ error: "Failed to list escalations" });
  }
});

// POST /api/escalations/:id/action
escalationsRouter.post("/:id/action", async (req: Request, res: Response) => {
  try {
    const id = req.params["id"] as string;
    if (!id) {
      res.status(400).json({ error: "Missing escalation id" });
      return;
    }

    const existing = await escalationsRepo.getById(id);
    if (!existing) {
      res.status(404).json({ error: "Escalation not found" });
      return;
    }

    if (existing.status !== "pending") {
      res.status(409).json({ error: "Escalation already actioned" });
      return;
    }

    const { action } = req.body as Record<string, unknown>;
    if (!action || typeof action !== "string") {
      res
        .status(400)
        .json({ error: "action is required and must be a string" });
      return;
    }

    const validActions = ["approve", "dismiss", "edit", "handle_myself", "escalate"];
    if (!validActions.includes(action)) {
      res
        .status(400)
        .json({ error: `Invalid action. Must be one of: ${validActions.join(", ")}` });
      return;
    }

    let result;
    if (action === "dismiss") {
      result = await escalationsRepo.markDismissed(id);
    } else {
      result = await escalationsRepo.markActioned(id);
    }

    logger.info("Escalation actioned", { escalationId: id, action });
    res.json({ data: result });
  } catch (err) {
    logger.error("Failed to action escalation", {
      error: err,
      id: req.params["id"],
    });
    res.status(500).json({ error: "Failed to action escalation" });
  }
});
