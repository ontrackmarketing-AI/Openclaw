import { Router, type Request, type Response } from "express";
import { tasksRepo } from "../../db/repositories/index.js";
import { logger } from "../../config/logger.js";

export const tasksRouter = Router();

// GET /api/tasks
tasksRouter.get("/", async (req: Request, res: Response) => {
  try {
    const { status, project_id } = req.query;

    let tasks;
    if (status === "open") {
      tasks = await tasksRepo.getOpen();
    } else if (typeof project_id === "string" && project_id) {
      tasks = await tasksRepo.getByProjectId(project_id);
    } else {
      tasks = await tasksRepo.getAll();
    }

    // Apply additional filters client-side if both status and project_id provided
    if (typeof status === "string" && status && typeof project_id === "string" && project_id) {
      const allForProject = await tasksRepo.getByProjectId(project_id);
      tasks = allForProject.filter((t) => t.status === status);
    }

    res.json({ data: tasks });
  } catch (err) {
    logger.error("Failed to list tasks", { error: err });
    res.status(500).json({ error: "Failed to list tasks" });
  }
});

// POST /api/tasks
tasksRouter.post("/", async (req: Request, res: Response) => {
  try {
    const { title, project_id, source, source_ref, description, status, priority, due_date } =
      req.body as Record<string, unknown>;

    if (!title || typeof title !== "string") {
      res.status(400).json({ error: "title is required and must be a string" });
      return;
    }

    const task = await tasksRepo.create({
      title,
      project_id: typeof project_id === "string" ? project_id : undefined,
      source: typeof source === "string" ? source : undefined,
      source_ref: typeof source_ref === "string" ? source_ref : undefined,
      description: typeof description === "string" ? description : undefined,
      status: typeof status === "string" ? status : undefined,
      priority: typeof priority === "number" ? priority : undefined,
      due_date: typeof due_date === "string" ? due_date : undefined,
    });

    logger.info("Task created", { taskId: task.id, title: task.title });
    res.status(201).json({ data: task });
  } catch (err) {
    logger.error("Failed to create task", { error: err });
    res.status(500).json({ error: "Failed to create task" });
  }
});

// PATCH /api/tasks/:id
tasksRouter.patch("/:id", async (req: Request, res: Response) => {
  try {
    const id = req.params["id"] as string;
    if (!id) {
      res.status(400).json({ error: "Missing task id" });
      return;
    }

    const existing = await tasksRepo.getById(id);
    if (!existing) {
      res.status(404).json({ error: "Task not found" });
      return;
    }

    const {
      title,
      description,
      status,
      priority,
      due_date,
      project_id,
      agent_handled,
      escalated_to_bryson,
      escalation_reason,
    } = req.body as Record<string, unknown>;

    const task = await tasksRepo.update(id, {
      title: typeof title === "string" ? title : undefined,
      description: typeof description === "string" ? description : undefined,
      status: typeof status === "string" ? status : undefined,
      priority: typeof priority === "number" ? priority : undefined,
      due_date: typeof due_date === "string" ? due_date : (due_date === null ? null : undefined),
      project_id: typeof project_id === "string" ? project_id : undefined,
      agent_handled: typeof agent_handled === "boolean" ? agent_handled : undefined,
      escalated_to_bryson:
        typeof escalated_to_bryson === "boolean" ? escalated_to_bryson : undefined,
      escalation_reason:
        typeof escalation_reason === "string" ? escalation_reason : undefined,
    });

    logger.info("Task updated", { taskId: id });
    res.json({ data: task });
  } catch (err) {
    logger.error("Failed to update task", { error: err, id: req.params["id"] });
    res.status(500).json({ error: "Failed to update task" });
  }
});
