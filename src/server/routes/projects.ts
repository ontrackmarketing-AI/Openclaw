import { Router, type Request, type Response } from "express";
import { projectsRepo } from "../../db/repositories/index.js";
import { logger } from "../../config/logger.js";

export const projectsRouter = Router();

// GET /api/projects
projectsRouter.get("/", async (_req: Request, res: Response) => {
  try {
    const projects = await projectsRepo.getAll();
    res.json({ data: projects });
  } catch (err) {
    logger.error("Failed to list projects", { error: err });
    res.status(500).json({ error: "Failed to list projects" });
  }
});

// GET /api/projects/:id
projectsRouter.get("/:id", async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    if (!id) {
      res.status(400).json({ error: "Missing project id" });
      return;
    }

    const project = await projectsRepo.getById(id);
    if (!project) {
      res.status(404).json({ error: "Project not found" });
      return;
    }

    res.json({ data: project });
  } catch (err) {
    logger.error("Failed to get project", { error: err, id: req.params["id"] });
    res.status(500).json({ error: "Failed to get project" });
  }
});
