import { Router, type Request, type Response } from "express";
import {
  projectsRepo,
  tasksRepo,
  escalationsRepo,
} from "../../db/repositories/index.js";
import { logger } from "../../config/logger.js";

export const briefingRouter = Router();

// GET /api/briefing
briefingRouter.get("/", async (_req: Request, res: Response) => {
  try {
    const [projects, openTasks, overdueTasks, pendingEscalations] =
      await Promise.all([
        projectsRepo.getActive(),
        tasksRepo.getOpen(),
        tasksRepo.getOverdue(),
        escalationsRepo.getPending(),
      ]);

    const briefing = {
      generated_at: new Date().toISOString(),
      summary: {
        active_projects: projects.length,
        open_tasks: openTasks.length,
        overdue_tasks: overdueTasks.length,
        pending_escalations: pendingEscalations.length,
      },
      overdue_tasks: overdueTasks.map((t) => ({
        id: t.id,
        title: t.title,
        due_date: t.due_date,
        project_id: t.project_id,
        priority: t.priority,
      })),
      pending_escalations: pendingEscalations.map((e) => ({
        id: e.id,
        type: e.type,
        summary: e.summary,
        created_at: e.created_at,
      })),
      projects: projects.map((p) => ({
        id: p.id,
        name: p.name,
        client: p.client,
        priority: p.priority,
        task_count: openTasks.filter((t) => t.project_id === p.id).length,
      })),
      top_tasks: openTasks.slice(0, 10).map((t) => ({
        id: t.id,
        title: t.title,
        priority: t.priority,
        due_date: t.due_date,
        project_id: t.project_id,
      })),
    };

    res.json({ data: briefing });
  } catch (err) {
    logger.error("Failed to generate briefing", { error: err });
    res.status(500).json({ error: "Failed to generate briefing" });
  }
});
