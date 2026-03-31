import { BaseAgent, AgentEvent, AgentResult } from "../base.js";
import { logger } from "../../config/logger.js";
import { redis } from "../../db/redis.js";
import * as projectsRepo from "../../db/repositories/projects.js";
import * as tasksRepo from "../../db/repositories/tasks.js";
import * as escalationsRepo from "../../db/repositories/escalations.js";
import * as inboxEventsRepo from "../../db/repositories/inbox-events.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ProjectContext {
  projects: projectsRepo.Project[];
  tasksByProject: Record<string, tasksRepo.Task[]>;
  loadedAt: string;
}

const CONTEXT_CACHE_KEY = "cache:project_context";
const CONTEXT_TTL_SECONDS = 3600; // 1 hour

// ---------------------------------------------------------------------------
// Orchestrator
// ---------------------------------------------------------------------------

export class OrchestratorAgent extends BaseAgent {
  constructor() {
    super("orchestrator");
  }

  // -----------------------------------------------------------------------
  // Project context management
  // -----------------------------------------------------------------------

  /**
   * Load all active projects and their recent tasks from the database,
   * serialise to Redis with a 1-hour TTL.
   */
  async loadProjectContext(): Promise<ProjectContext> {
    await this.log("load_project_context");

    const projects = await projectsRepo.getActive();
    const tasksByProject: Record<string, tasksRepo.Task[]> = {};

    for (const project of projects) {
      tasksByProject[project.id] = await tasksRepo.getByProjectId(project.id);
    }

    const ctx: ProjectContext = {
      projects,
      tasksByProject,
      loadedAt: new Date().toISOString(),
    };

    await redis.set(CONTEXT_CACHE_KEY, JSON.stringify(ctx), "EX", CONTEXT_TTL_SECONDS);
    await this.log("project_context_cached", undefined, {
      projectCount: projects.length,
    });

    return ctx;
  }

  /**
   * Return the cached project context, or load fresh if the cache is empty /
   * expired.
   */
  async getProjectContext(): Promise<ProjectContext> {
    const cached = await redis.get(CONTEXT_CACHE_KEY);
    if (cached) {
      try {
        return JSON.parse(cached) as ProjectContext;
      } catch {
        logger.warn("Corrupt project context cache — reloading");
      }
    }
    return this.loadProjectContext();
  }

  // -----------------------------------------------------------------------
  // Event routing
  // -----------------------------------------------------------------------

  /**
   * Determine which agent should handle an event based on its type.
   * Returns the agent name string used to look up the singleton.
   */
  routeEvent(event: AgentEvent): string {
    const routeMap: Record<string, string> = {
      notebook_image: "ingestion",
      gmail_thread: "inbox",
      imessage_message: "inbox",
      telegram_command: "inbox",
      telegram_callback: "inbox",
      research_request: "research",
      calendar_check: "scheduler",
      briefing_request: "reporting",
      project_status_request: "reporting",
      scheduled_cycle: "orchestrator",
      escalation_response: "orchestrator",
    };

    return routeMap[event.type] ?? "orchestrator";
  }

  // -----------------------------------------------------------------------
  // Result processing
  // -----------------------------------------------------------------------

  /**
   * After an agent finishes, the orchestrator decides whether to execute the
   * result directly, queue a follow-up, or escalate to Bryson.
   */
  async processResults(result: AgentResult): Promise<void> {
    await this.log("process_result", undefined, {
      agent: result.agent,
      status: result.status,
    });

    switch (result.status) {
      case "success":
        // Nothing else to do — agent completed its work.
        await this.log("result_executed", undefined, {
          agent: result.agent,
          message: result.message,
        });
        break;

      case "partial":
        // Agent did some work but something remains. Queue for the next cycle.
        await redis.rpush(
          "queue:follow_up",
          JSON.stringify({
            agent: result.agent,
            data: result.data,
            queuedAt: new Date().toISOString(),
          }),
        );
        await this.log("result_queued", undefined, {
          agent: result.agent,
          message: result.message,
        });
        break;

      case "escalate":
        if (result.escalation) {
          await escalationsRepo.create({
            type: result.agent,
            project_id: result.escalation.projectId,
            task_id: result.escalation.taskId,
            inbox_event_id: result.escalation.inboxEventId,
            summary: result.escalation.summary,
            context: result.escalation.context,
            options: result.escalation.options,
          });
          await this.log("result_escalated", result.escalation.projectId, {
            summary: result.escalation.summary,
          });
        }
        break;

      case "error":
        logger.error(`Agent ${result.agent} returned error: ${result.message}`);
        await this.log("result_error", undefined, {
          agent: result.agent,
          message: result.message,
        });
        break;
    }
  }

  // -----------------------------------------------------------------------
  // Scheduled cycle
  // -----------------------------------------------------------------------

  /**
   * Called by the cron job. Walks through each inbox, processes queued
   * ingestion images, refreshes context, and triggers the daily briefing if
   * it is morning.
   */
  async runScheduledCycle(): Promise<AgentResult> {
    await this.log("scheduled_cycle_start");

    try {
      // 1. Refresh project context
      await this.loadProjectContext();

      // 2. Process queued ingestion images
      const ingestionQueueLength = await redis.llen("queue:ingestion");
      const processedIngestion: string[] = [];
      for (let i = 0; i < ingestionQueueLength; i++) {
        const item = await redis.lpop("queue:ingestion");
        if (item) processedIngestion.push(item);
      }

      // 3. Process follow-up queue items
      const followUpLength = await redis.llen("queue:follow_up");
      const processedFollowUps: string[] = [];
      for (let i = 0; i < followUpLength; i++) {
        const item = await redis.lpop("queue:follow_up");
        if (item) processedFollowUps.push(item);
      }

      // 4. Check pending escalations
      const pendingEscalations = await escalationsRepo.getPending();

      // 5. Gather recent inbox events for a summary
      const recentInbox = await inboxEventsRepo.getRecent(20);

      await this.log("scheduled_cycle_complete", undefined, {
        ingestionProcessed: processedIngestion.length,
        followUpsProcessed: processedFollowUps.length,
        pendingEscalations: pendingEscalations.length,
        recentInboxEvents: recentInbox.length,
      });

      return {
        status: "success",
        agent: this.name,
        message: `Cycle complete: ${processedIngestion.length} ingestion items, ${processedFollowUps.length} follow-ups, ${pendingEscalations.length} pending escalations`,
        data: {
          ingestionProcessed: processedIngestion.length,
          followUpsProcessed: processedFollowUps.length,
          pendingEscalations: pendingEscalations.length,
          queuedIngestionPaths: processedIngestion,
          followUpItems: processedFollowUps,
        },
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error("Scheduled cycle failed", { error: message });
      await this.log("scheduled_cycle_error", undefined, { error: message });
      return {
        status: "error",
        agent: this.name,
        message: `Scheduled cycle failed: ${message}`,
      };
    }
  }

  // -----------------------------------------------------------------------
  // Main process entry
  // -----------------------------------------------------------------------

  async process(event: AgentEvent): Promise<AgentResult> {
    switch (event.type) {
      case "scheduled_cycle":
        return this.runScheduledCycle();

      case "escalation_response": {
        const escalationId = event.data["escalationId"] as string | undefined;
        const action = event.data["action"] as string | undefined;
        if (!escalationId || !action) {
          return {
            status: "error",
            agent: this.name,
            message: "escalation_response requires escalationId and action",
          };
        }
        if (action === "dismiss") {
          await escalationsRepo.markDismissed(escalationId);
        } else {
          await escalationsRepo.markActioned(escalationId);
        }
        await this.log("escalation_handled", undefined, {
          escalationId,
          action,
        });
        return {
          status: "success",
          agent: this.name,
          message: `Escalation ${escalationId} ${action}`,
        };
      }

      default:
        return {
          status: "error",
          agent: this.name,
          message: `Orchestrator cannot directly process event type: ${event.type}`,
        };
    }
  }
}
