import { BaseAgent, AgentEvent, AgentResult } from "../base.js";
import { logger } from "../../config/logger.js";
import * as projectsRepo from "../../db/repositories/projects.js";
import * as tasksRepo from "../../db/repositories/tasks.js";
import * as escalationsRepo from "../../db/repositories/escalations.js";
import * as agentLogsRepo from "../../db/repositories/agent-logs.js";
import * as inboxEventsRepo from "../../db/repositories/inbox-events.js";
import * as notesRepo from "../../db/repositories/notes.js";
import { SchedulerAgent } from "../scheduler/index.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface BriefingData {
  date: string;
  pendingEscalations: escalationsRepo.Escalation[];
  handledOvernight: Array<{
    agent: string;
    event: string;
    summary: string;
  }>;
  calendarEvents: Array<{
    summary: string;
    time: string;
    hasBrief: boolean;
  }>;
  openTasks: tasksRepo.Task[];
  overdueTasks: tasksRepo.Task[];
  topPriorities: string[];
  inboxSummary: string;
  stats: {
    totalOpenTasks: number;
    tasksCompletedLast24h: number;
    escalationsPending: number;
    notesIngestedLast24h: number;
  };
}

export interface ProjectStatusData {
  project: projectsRepo.Project;
  openTasks: tasksRepo.Task[];
  completedTasks: tasksRepo.Task[];
  recentNotes: notesRepo.Note[];
  recentInboxEvents: inboxEventsRepo.InboxEvent[];
  escalationHistory: escalationsRepo.Escalation[];
  narrativeSummary: string;
}

// ---------------------------------------------------------------------------
// Reporting Agent
// ---------------------------------------------------------------------------

export class ReportingAgent extends BaseAgent {
  private scheduler: SchedulerAgent;

  constructor() {
    super("reporting");
    this.scheduler = new SchedulerAgent();
  }

  // -----------------------------------------------------------------------
  // Daily Briefing
  // -----------------------------------------------------------------------

  /**
   * The core function. Aggregates data from all systems and uses Claude to
   * derive top 3 priorities. Returns a structured BriefingData object.
   */
  async generateDailyBriefing(): Promise<BriefingData> {
    await this.log("briefing_generation_start");

    const now = new Date();
    const todayStr = now.toLocaleDateString("en-US", {
      weekday: "long",
      year: "numeric",
      month: "long",
      day: "numeric",
    });

    // 1. Pending escalations (status='pending')
    let pendingEscalations: escalationsRepo.Escalation[] = [];
    try {
      pendingEscalations = await escalationsRepo.getPending();
    } catch (err) {
      logger.error("Failed to fetch pending escalations", {
        error: err instanceof Error ? err.message : String(err),
      });
    }

    // 2. Agent actions from last 24h from agent_logs
    let recentLogs: agentLogsRepo.AgentLog[] = [];
    try {
      recentLogs = await agentLogsRepo.getRecent(200);
    } catch (err) {
      logger.error("Failed to fetch recent agent logs", {
        error: err instanceof Error ? err.message : String(err),
      });
    }

    const handledOvernight = recentLogs
      .filter(
        (l) =>
          l.event.includes("complete") ||
          l.event.includes("handled") ||
          l.event.includes("processed") ||
          l.event.includes("stored") ||
          l.event.includes("sent"),
      )
      .slice(0, 15)
      .map((l) => {
        const meta = l.metadata ?? {};
        const detail =
          (meta["message"] as string) ??
          (meta["subject"] as string) ??
          (meta["query"] as string) ??
          "";
        return {
          agent: l.agent,
          event: l.event,
          summary: detail
            ? `${l.agent}: ${l.event} - ${detail}`
            : `${l.agent}: ${l.event}`,
        };
      });

    // 3. Calendar events for today (call schedulerAgent if available)
    let calendarEvents: BriefingData["calendarEvents"] = [];
    try {
      const events = await this.scheduler.getUpcomingEvents(16);
      calendarEvents = events.map((e) => ({
        summary: e.summary,
        time: formatTime(e.start),
        hasBrief: true,
      }));
    } catch (err) {
      logger.warn("Could not fetch calendar for briefing", {
        error: err instanceof Error ? err.message : String(err),
      });
    }

    // 4. Open tasks sorted by priority
    let openTasks: tasksRepo.Task[] = [];
    let overdueTasks: tasksRepo.Task[] = [];
    try {
      openTasks = await tasksRepo.getOpen();
    } catch (err) {
      logger.error("Failed to fetch open tasks", {
        error: err instanceof Error ? err.message : String(err),
      });
    }
    try {
      overdueTasks = await tasksRepo.getOverdue();
    } catch (err) {
      logger.error("Failed to fetch overdue tasks", {
        error: err instanceof Error ? err.message : String(err),
      });
    }

    // Inbox summary
    let recentInbox: inboxEventsRepo.InboxEvent[] = [];
    try {
      recentInbox = await inboxEventsRepo.getRecent(30);
    } catch (err) {
      logger.error("Failed to fetch recent inbox events", {
        error: err instanceof Error ? err.message : String(err),
      });
    }
    const inboxSummary = this.summarizeInbox(recentInbox);

    // Notes ingested in last 24h
    let notesIngestedLast24h = 0;
    try {
      const allNotes = await notesRepo.getAll();
      const cutoff = new Date(now.getTime() - 24 * 60 * 60 * 1000);
      notesIngestedLast24h = allNotes.filter(
        (n) => new Date(n.created_at) >= cutoff,
      ).length;
    } catch {
      // Non-critical
    }

    // Tasks completed count from logs
    const tasksCompletedLast24h = recentLogs.filter(
      (l) =>
        l.event.includes("done") ||
        l.event.includes("completed") ||
        l.event.includes("task_closed"),
    ).length;

    // 5. Use Claude to derive top 3 priorities from all the data
    const topPriorities = await this.deriveTopPriorities({
      pendingEscalations,
      openTasks,
      overdueTasks,
      calendarEvents,
      handledOvernight,
    });

    const stats: BriefingData["stats"] = {
      totalOpenTasks: openTasks.length,
      tasksCompletedLast24h,
      escalationsPending: pendingEscalations.length,
      notesIngestedLast24h,
    };

    const data: BriefingData = {
      date: todayStr,
      pendingEscalations,
      handledOvernight,
      calendarEvents,
      openTasks,
      overdueTasks,
      topPriorities,
      inboxSummary,
      stats,
    };

    await this.log("briefing_generated", undefined, {
      escalationCount: pendingEscalations.length,
      handledCount: handledOvernight.length,
      calendarCount: calendarEvents.length,
      openTaskCount: openTasks.length,
      overdueCount: overdueTasks.length,
    });

    return data;
  }

  // -----------------------------------------------------------------------
  // Format briefing for Telegram
  // -----------------------------------------------------------------------

  /**
   * Format as the Telegram message from the PRD. Uses simple text formatting
   * with no emoji for Telegram MarkdownV2 compatibility. Special characters
   * are escaped.
   */
  formatBriefing(data: BriefingData): string {
    const sections: string[] = [];

    // Header
    sections.push(`MORNING BRIEFING \\-\\- ${escapeMarkdownV2(data.date)}`);

    // NEEDS YOU TODAY (pending escalations)
    sections.push("");
    sections.push(
      `NEEDS YOU TODAY \\(${data.pendingEscalations.length}\\)`,
    );
    if (data.pendingEscalations.length > 0) {
      for (const esc of data.pendingEscalations) {
        const projectLabel = esc.project_id ?? "general";
        sections.push(
          `  \\- ${escapeMarkdownV2(projectLabel)}: ${escapeMarkdownV2(esc.summary)}`,
        );
      }
    } else {
      sections.push("  No pending escalations\\.");
    }

    // Overdue tasks
    if (data.overdueTasks.length > 0) {
      sections.push("");
      sections.push(`OVERDUE \\(${data.overdueTasks.length}\\)`);
      for (const task of data.overdueTasks.slice(0, 5)) {
        sections.push(
          `  \\- ${escapeMarkdownV2(task.title)}${task.due_date ? ` \\(was due ${escapeMarkdownV2(task.due_date)}\\)` : ""}`,
        );
      }
      if (data.overdueTasks.length > 5) {
        sections.push(
          `  \\.\\.\\. and ${data.overdueTasks.length - 5} more overdue`,
        );
      }
    }

    // HANDLED OVERNIGHT
    sections.push("");
    sections.push(
      `HANDLED OVERNIGHT \\(${data.handledOvernight.length}\\)`,
    );
    if (data.handledOvernight.length > 0) {
      for (const item of data.handledOvernight.slice(0, 8)) {
        sections.push(`  \\- ${escapeMarkdownV2(item.summary)}`);
      }
      if (data.handledOvernight.length > 8) {
        sections.push(
          `  \\.\\.\\. and ${data.handledOvernight.length - 8} more actions`,
        );
      }
    } else {
      sections.push("  No overnight actions\\.");
    }

    // TODAY'S CALENDAR
    sections.push("");
    sections.push("TODAY'S CALENDAR");
    if (data.calendarEvents.length > 0) {
      for (const event of data.calendarEvents) {
        const briefNote = event.hasBrief
          ? " \\-\\- prep brief ready"
          : "";
        sections.push(
          `  \\- ${escapeMarkdownV2(event.time)} \\-\\- ${escapeMarkdownV2(event.summary)}${briefNote}`,
        );
      }
    } else {
      sections.push("  No meetings today\\.");
    }

    // TOP 3 PRIORITIES
    sections.push("");
    sections.push("TOP 3 PRIORITIES");
    if (data.topPriorities.length > 0) {
      for (let i = 0; i < data.topPriorities.length; i++) {
        sections.push(
          `${i + 1}\\. ${escapeMarkdownV2(data.topPriorities[i]!)}`,
        );
      }
    } else {
      sections.push("  No priorities derived\\.");
    }

    return sections.join("\n");
  }

  // -----------------------------------------------------------------------
  // Project status report
  // -----------------------------------------------------------------------

  /**
   * Generate a status report for one project: open tasks, recent notes,
   * recent inbox events, escalation history.
   */
  async generateProjectStatus(projectId: string): Promise<ProjectStatusData> {
    await this.log("project_status_start", projectId);

    const project = await projectsRepo.getById(projectId);
    if (!project) {
      throw new Error(`Project not found: ${projectId}`);
    }

    // Fetch all project data in parallel
    const [allTasks, recentNotes, allEscalations, recentInbox] =
      await Promise.all([
        tasksRepo.getByProjectId(projectId).catch(() => [] as tasksRepo.Task[]),
        notesRepo.getByProjectId(projectId).catch(() => [] as notesRepo.Note[]),
        escalationsRepo.getPending().catch(
          () => [] as escalationsRepo.Escalation[],
        ),
        inboxEventsRepo.getRecent(50).catch(
          () => [] as inboxEventsRepo.InboxEvent[],
        ),
      ]);

    const openTasks = allTasks.filter((t) => t.status === "open");
    const completedTasks = allTasks.filter((t) => t.status === "done");

    // Filter escalations and inbox events to this project
    const escalationHistory = allEscalations.filter(
      (e) => e.project_id === projectId,
    );
    const recentInboxEvents = recentInbox.filter(
      (e) => e.project_id === projectId,
    );

    // Generate narrative summary with Claude
    const narrativeSummary = await this.callClaude(
      `You are a project status report generator for Bryson Stevens' personal OS.
Generate a concise project status update. Be specific and actionable. Under 200 words.`,
      `Project: ${project.name}${project.client ? ` (Client: ${project.client})` : ""}
Priority: P${project.priority} | Status: ${project.status}

Open Tasks (${openTasks.length}):
${openTasks
  .slice(0, 10)
  .map(
    (t) =>
      `- ${t.title} (P${t.priority}${t.due_date ? `, due ${t.due_date}` : ""})`,
  )
  .join("\n") || "None"}

Completed Tasks: ${completedTasks.length}

Recent Notes (${recentNotes.length}):
${recentNotes
  .slice(0, 5)
  .map((n) => `- ${(n.raw_text ?? "").slice(0, 120)}`)
  .join("\n") || "None"}

Pending Escalations (${escalationHistory.length}):
${escalationHistory.map((e) => `- ${e.summary}`).join("\n") || "None"}

Recent Inbox Activity (${recentInboxEvents.length}):
${recentInboxEvents
  .slice(0, 5)
  .map(
    (e) =>
      `- [${e.channel}] ${e.subject ?? e.body_summary ?? "no subject"}`,
  )
  .join("\n") || "None"}

Write a brief status update with key observations and recommended next steps.`,
      { maxTokens: 512 },
    );

    const statusData: ProjectStatusData = {
      project,
      openTasks,
      completedTasks,
      recentNotes: recentNotes.slice(0, 10),
      recentInboxEvents: recentInboxEvents.slice(0, 10),
      escalationHistory,
      narrativeSummary,
    };

    await this.log("project_status_generated", projectId, {
      openTaskCount: openTasks.length,
      completedTaskCount: completedTasks.length,
      noteCount: recentNotes.length,
      escalationCount: escalationHistory.length,
    });

    return statusData;
  }

  // -----------------------------------------------------------------------
  // Format project status for Telegram
  // -----------------------------------------------------------------------

  /**
   * Format a ProjectStatusData as a Telegram-compatible message with
   * MarkdownV2 escaping (no emoji).
   */
  formatProjectStatus(data: ProjectStatusData): string {
    const sections: string[] = [];

    // Header
    sections.push(
      `PROJECT STATUS: ${escapeMarkdownV2(data.project.name)}`,
    );
    if (data.project.client) {
      sections.push(`Client: ${escapeMarkdownV2(data.project.client)}`);
    }
    sections.push(
      `Priority: P${data.project.priority} | Status: ${escapeMarkdownV2(data.project.status)}`,
    );

    // Narrative
    sections.push("");
    sections.push(escapeMarkdownV2(data.narrativeSummary));

    // Tasks
    sections.push("");
    sections.push(
      `TASKS: ${data.openTasks.length} open, ${data.completedTasks.length} completed`,
    );
    if (data.openTasks.length > 0) {
      for (const task of data.openTasks.slice(0, 5)) {
        const due = task.due_date
          ? ` \\(due ${escapeMarkdownV2(task.due_date)}\\)`
          : "";
        sections.push(
          `  \\- \\[P${task.priority}\\] ${escapeMarkdownV2(task.title)}${due}`,
        );
      }
      if (data.openTasks.length > 5) {
        sections.push(
          `  \\.\\.\\. and ${data.openTasks.length - 5} more open tasks`,
        );
      }
    }

    // Recent notes
    if (data.recentNotes.length > 0) {
      sections.push("");
      sections.push(`RECENT NOTES \\(${data.recentNotes.length}\\)`);
      for (const note of data.recentNotes.slice(0, 3)) {
        const snippet = (note.raw_text ?? "").slice(0, 100);
        sections.push(`  \\- ${escapeMarkdownV2(snippet)}`);
      }
    }

    // Inbox activity
    if (data.recentInboxEvents.length > 0) {
      sections.push("");
      sections.push(
        `RECENT INBOX \\(${data.recentInboxEvents.length}\\)`,
      );
      for (const evt of data.recentInboxEvents.slice(0, 3)) {
        const label =
          evt.subject ?? evt.body_summary ?? "no subject";
        sections.push(
          `  \\- \\[${escapeMarkdownV2(evt.channel)}\\] ${escapeMarkdownV2(label)}`,
        );
      }
    }

    // Escalations
    if (data.escalationHistory.length > 0) {
      sections.push("");
      sections.push(
        `ESCALATIONS \\(${data.escalationHistory.length}\\)`,
      );
      for (const esc of data.escalationHistory) {
        sections.push(`  \\- ${escapeMarkdownV2(esc.summary)}`);
      }
    }

    return sections.join("\n");
  }

  // -----------------------------------------------------------------------
  // Entry point
  // -----------------------------------------------------------------------

  async process(event: AgentEvent): Promise<AgentResult> {
    switch (event.type) {
      case "briefing_request": {
        try {
          const data = await this.generateDailyBriefing();
          const formatted = this.formatBriefing(data);
          return {
            status: "success",
            agent: this.name,
            message: formatted,
            data: {
              date: data.date,
              pendingEscalations: data.pendingEscalations.length,
              handledOvernight: data.handledOvernight.length,
              calendarEvents: data.calendarEvents.length,
              topPriorities: data.topPriorities,
              stats: data.stats,
            },
          };
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          logger.error("Briefing generation failed", { error: message });
          await this.log("briefing_error", undefined, { error: message });
          return { status: "error", agent: this.name, message };
        }
      }

      case "project_status_request": {
        const projectId =
          event.projectId ?? (event.data["projectId"] as string);
        if (!projectId) {
          return {
            status: "error",
            agent: this.name,
            message: "project_status_request requires a projectId",
          };
        }
        try {
          const statusData = await this.generateProjectStatus(projectId);
          const formatted = this.formatProjectStatus(statusData);
          return {
            status: "success",
            agent: this.name,
            message: formatted,
            data: {
              projectName: statusData.project.name,
              openTasks: statusData.openTasks.length,
              completedTasks: statusData.completedTasks.length,
              recentNotes: statusData.recentNotes.length,
              escalations: statusData.escalationHistory.length,
            },
          };
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          logger.error("Project status generation failed", {
            error: message,
          });
          await this.log("project_status_error", projectId, {
            error: message,
          });
          return { status: "error", agent: this.name, message };
        }
      }

      default:
        return {
          status: "error",
          agent: this.name,
          message: `Reporting agent cannot handle event type: ${event.type}`,
        };
    }
  }

  // -----------------------------------------------------------------------
  // Private helpers
  // -----------------------------------------------------------------------

  /**
   * Use Claude to derive the top 3 priorities from all aggregated data.
   */
  private async deriveTopPriorities(context: {
    pendingEscalations: escalationsRepo.Escalation[];
    openTasks: tasksRepo.Task[];
    overdueTasks: tasksRepo.Task[];
    calendarEvents: BriefingData["calendarEvents"];
    handledOvernight: BriefingData["handledOvernight"];
  }): Promise<string[]> {
    try {
      const escalationBlock =
        context.pendingEscalations.length > 0
          ? context.pendingEscalations
              .map((e) => `- [${e.type ?? "general"}] ${e.summary}`)
              .join("\n")
          : "None";

      const overdueBlock =
        context.overdueTasks.length > 0
          ? context.overdueTasks
              .slice(0, 5)
              .map(
                (t) =>
                  `- ${t.title} (P${t.priority}, due ${t.due_date})`,
              )
              .join("\n")
          : "None";

      const topTasksBlock = context.openTasks
        .slice(0, 10)
        .map(
          (t) =>
            `- ${t.title} (P${t.priority}${t.due_date ? `, due ${t.due_date}` : ""})`,
        )
        .join("\n") || "None";

      const calendarBlock =
        context.calendarEvents.length > 0
          ? context.calendarEvents
              .map((e) => `- ${e.time}: ${e.summary}`)
              .join("\n")
          : "No meetings today";

      const raw = await this.callClaude(
        `You are Bryson Stevens' executive assistant. Based on today's data, identify the TOP 3 priorities Bryson should focus on today.

Each priority should be a single, actionable sentence. Consider urgency (overdue/escalations), importance (project priority), and time-sensitivity (meetings today).

Respond with valid JSON only (no markdown fences):
["Priority 1 text", "Priority 2 text", "Priority 3 text"]`,
        `PENDING ESCALATIONS:
${escalationBlock}

OVERDUE TASKS:
${overdueBlock}

TOP OPEN TASKS (by priority):
${topTasksBlock}

TODAY'S CALENDAR:
${calendarBlock}

OVERNIGHT ACTIONS (${context.handledOvernight.length} total):
${context.handledOvernight.slice(0, 5).map((h) => `- ${h.summary}`).join("\n") || "None"}

What are the top 3 priorities for today?`,
        { maxTokens: 512 },
      );

      const cleaned = raw
        .replace(/^```(?:json)?\n?/m, "")
        .replace(/\n?```$/m, "")
        .trim();
      const parsed = JSON.parse(cleaned);

      if (Array.isArray(parsed)) {
        return parsed.slice(0, 3).map(String);
      }

      return [
        "Review pending escalations",
        "Address overdue tasks",
        "Prepare for today's meetings",
      ];
    } catch (err) {
      logger.error("Failed to derive top priorities via Claude", {
        error: err instanceof Error ? err.message : String(err),
      });
      // Fallback: generate priorities heuristically
      const priorities: string[] = [];

      if (context.pendingEscalations.length > 0) {
        priorities.push(
          `Address ${context.pendingEscalations.length} pending escalation(s)`,
        );
      }
      if (context.overdueTasks.length > 0) {
        priorities.push(
          `Resolve ${context.overdueTasks.length} overdue task(s)`,
        );
      }
      if (context.calendarEvents.length > 0) {
        priorities.push(
          `Prepare for ${context.calendarEvents.length} meeting(s) today`,
        );
      }
      if (context.openTasks.length > 0 && priorities.length < 3) {
        const top = context.openTasks[0];
        if (top) {
          priorities.push(`Focus on: ${top.title}`);
        }
      }

      return priorities.slice(0, 3);
    }
  }

  /**
   * Summarize recent inbox events into a one-line string.
   */
  private summarizeInbox(events: inboxEventsRepo.InboxEvent[]): string {
    if (events.length === 0) return "No new inbox activity.";

    const byChannel: Record<string, number> = {};
    let urgentCount = 0;

    for (const e of events) {
      byChannel[e.channel] = (byChannel[e.channel] ?? 0) + 1;
      if (
        e.intent === "urgent" ||
        e.intent === "action_needed" ||
        e.escalated
      ) {
        urgentCount++;
      }
    }

    const parts = Object.entries(byChannel).map(
      ([chan, count]) => `${count} ${chan}`,
    );
    const urgentNote =
      urgentCount > 0 ? ` (${urgentCount} need attention)` : "";
    return `${parts.join(", ")}${urgentNote}`;
  }
}

// ---------------------------------------------------------------------------
// Telegram MarkdownV2 escaping
// ---------------------------------------------------------------------------

/**
 * Escape special characters for Telegram MarkdownV2 format.
 * Characters that need escaping: _ * [ ] ( ) ~ ` > # + - = | { } . !
 */
function escapeMarkdownV2(text: string): string {
  return text.replace(/([_*\[\]()~`>#+\-=|{}.!\\])/g, "\\$1");
}

/**
 * Format an ISO datetime string as a human-readable time (e.g. "9:30 AM").
 */
function formatTime(isoString: string): string {
  try {
    const date = new Date(isoString);
    return date.toLocaleTimeString("en-US", {
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
    });
  } catch {
    return isoString;
  }
}

// ---------------------------------------------------------------------------
// Singleton
// ---------------------------------------------------------------------------

export const reportingAgent = new ReportingAgent();
