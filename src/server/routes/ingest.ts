import { Router, type Request, type Response } from "express";
import { notesRepo } from "../../db/repositories/index.js";
import { logger } from "../../config/logger.js";

export const ingestRouter = Router();

// POST /api/ingest
ingestRouter.post("/", async (req: Request, res: Response) => {
  try {
    const { raw_text, source, project_id, image_path } = req.body as Record<
      string,
      unknown
    >;

    if (!raw_text && !image_path) {
      res
        .status(400)
        .json({ error: "Either raw_text or image_path is required" });
      return;
    }

    const note = await notesRepo.create({
      raw_text: typeof raw_text === "string" ? raw_text : undefined,
      source: typeof source === "string" ? source : "manual",
      project_id: typeof project_id === "string" ? project_id : undefined,
      image_path: typeof image_path === "string" ? image_path : undefined,
    });

    logger.info("Note ingested", { noteId: note.id, source: note.source });
    res.status(201).json({ data: note, message: "Ingestion queued" });
  } catch (err) {
    logger.error("Failed to ingest note", { error: err });
    res.status(500).json({ error: "Failed to ingest note" });
  }
});
