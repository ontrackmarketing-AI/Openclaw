import { Router, type Request, type Response } from "express";
import { notesRepo } from "../../db/repositories/index.js";
import { logger } from "../../config/logger.js";

export const notesRouter = Router();

// GET /api/notes
notesRouter.get("/", async (req: Request, res: Response) => {
  try {
    const { project_id } = req.query;

    let notes;
    if (typeof project_id === "string" && project_id) {
      notes = await notesRepo.getByProjectId(project_id);
    } else {
      notes = await notesRepo.getAll();
    }

    res.json({ data: notes });
  } catch (err) {
    logger.error("Failed to list notes", { error: err });
    res.status(500).json({ error: "Failed to list notes" });
  }
});
