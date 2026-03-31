import { BaseAgent, AgentEvent, AgentResult } from "../base.js";
import { logger } from "../../config/logger.js";
import * as escalationsRepo from "../../db/repositories/escalations.js";
import * as tasksRepo from "../../db/repositories/tasks.js";
import * as projectsRepo from "../../db/repositories/projects.js";
import * as notesRepo from "../../db/repositories/notes.js";
import * as agentLogs from "../../db/repositories/agent-logs.js";
import * as inboxEventsRepo from "../../db/repositories/inbox-events.js";
import { SchedulerAgent } from "../scheduler/index.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface DailyBriefingData {
  date: string;
  pendingEscalations: escalationsRepo.Escalation[];
  handledOvernight: string[];
  calendarEvents: { title: string; time: string; attendees: string }[];
  topPriorities: { title: string; project: string; dueDate: string | null }[];
  overdueTasks: tasksRepo.Task[];
  recentInboxSummary: string;
  stats: {
    totalOpenTasks: number;
    tasksCompletedToday: number;
    escalationsResolved: number;
    notesIngested: number;
  };
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
  // Daily briefing
  // -----------------------------------------------------------------------

  /**
   * Aggregate the last 24 hours of data across all systems and produce
   * a structured briefing.
   */
  async generateDailyBriefing(): Promise<DailyBriefingData> {
    await this.log("briefing_generation_start");

    const now = new Date();
    const twentyFourHoursAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    const todayStr = now.toLocaleDateString("en-US", {
      weekday: "long",
      year: "numeric",
      month: "long",
      day: "numeric",
    });

    // 1. Pending escalations
    const pendingEscalations = await escalationsRepo.getPending();

    // 2. Agent actions completed overnight (from agent_logs)
    const recentLogs = await agentLogs.getRecent(200);
    const handledOvernight = recentLogs
      .filter(
        (l) =>
          l.event.includes("complete") ||
          l.event.includes("handled") ||
          l.event.includes("processed") ||
          l.event.includes("stored"),
      )
      .slice(0, 10)
      .map((l) => {
        const meta = l.metadata;
        const detail =
          (meta["message"] as string) ??
          (meta["noteId"] as string) ??
          (meta["threadId"] as string) ??
          "";
        return `[${l.agent}] ${l.event}${detail ? `: ${detail}` : ""}`;
      });

    // 3. Today's calendar events
    let calendarEvents: { title: string; time: string; attendees: string }[] =
      [];
    try {
      const events = await this.scheduler.getUpcomingEvents(16); // next 16 hours
      calendarEvents = events.map((e) => ({
        title: e.summary,
        time: formatTime(e.start),
        attendees: e.attendees
          .map((a) => a.displayName ?? a.email)
          .join(", "),
      }));
    } catch (err) {
      logger.warn("Could not fetch calendar for briefing", {
        error: err instanceof Error ? err.message : String(err),
      });
    }

    // 4. Top 3 priorities (highest urgency tasks across top-priority projects)
    const topPriorities = await this.computeTopPriorities();

    // 5. Overdue tasks
    const overdueTasks = await tasksRepo.getOverdue();

    // 6. Recent inbox summary
    const recentInbox = await inboxEventsRepo.getRecent(20);
    const recentInboxSummary = this.summarizeRecentInbox(recentInbox);

    // 7. Stats
    const allOpenTasks = await tasksRepo.getOpen();
    const recentNotes = await this.getNotesCreatedSince(twentyFourHoursAgo);
    // Count resolved escalations: check logs for escalation_handled events
    const escalationsResolved = recentLogs.filter(
      (l) =>
        l.event === "escalation_handled" ||
        l.event === "result_escalated",
    ).length;

    // Tasks completed — look for tasks updated to "done" recently
    // We approximate by checking agent logs for "done" events
    const tasksCompletedToday = recentLogs.filter(
      (l) => l.event.includes("done") || l.event.includes("completed"),
    ).length;

    const data: DailyBriefingData = {
      date: todayStr,
      pendingEscalations,
      handledOvernight,
      calendarEvents,
      topPriorities,
      overdueTasks,
      recentInboxSummary,
      stats: {
        totalOpenTasks: allOpenTasks.length,
        tasksCompletedToday,
        escalationsResolved,
        notesIngested: recentNotes.length,
      },
    };

    await this.log("briefing_generated", undefined, {
      pendingEscalations: pendingEscalations.length,
      handledOvernight: handledOvernight.length,
      calendarEvents: calendarEvents.length,
      overdueTasks: overdueTasks.length,
    });

    return data;
  }

  // -----------------------------------------------------------------------
  // Format briefing for Telegram
  // -----------------------------------------------------------------------

  /**
   * Format the structured briefing data as a Telegram message.
   * Matches the PRD Section 3 format.
   */
  formatBriefing(data: DailyBriefingData): string {
    const sections: string[] = [];

    // Header
    sections.push(`☀️ *Daily Briefing — ${data.date}*`);

    // Stats bar
    sections.push(
      `\n📊 ${data.stats.totalOpenTasks} open tasks | ${data.stats.tasksCompletedToday} completed | ${data.stats.notesIngested} notes ingested`,
    );

    // NEEDS YOU TODAY
    if (data.pendingEscalations.length > 0) {
      sections.push("\n🚨 *NEEDS YOU TODAY*");
      for (const esc of data.pendingEscalations) {
        const typeTag = esc.type ? `[${esc.type}] ` : "";
        sections.push(`  • ${typeTag}${esc.summary}`);
      }
    } else {
      sections.push("\n✨ *No pending escalations — clean slate.*");
    }

    // OVERDUE
    if (data.overdueTasks.length > 0) {
      sections.push("\n⏰ *OVERDUE*");
      for (const task of data.overdueTasks.slice(0, 5)) {
        sections.push(
          `  • ${task.title}${task.due_date ? ` (was due ${task.due_date})` : ""} — P${task.priority}`,
        );
      }
      if (data.overdueTasks.length > 5) {
        sections.push(
          `  ... and ${data.overdueTasks.length - 5} more overdue`,
        );
      }
    }

    // HANDLED OVERNIGHT
    if (data.handledOvernight.length > 0) {
      sections.push("\n✅ *HANDLED OVERNIGHT*");
      for (const item of data.handledOvernight.slice(0, 8)) {
        sections.push(`  • ${item}`);
      }
      if (data.handledOvernight.length > 8) {
        sections.push(
          `  ... and ${data.handledOvernight.length - 8} more actions`,
        );
      }
    }

    // TODAY'S CALENDAR
    if (data.calendarEvents.length > 0) {
      sections.push("\n📅 *TODAY'S CALENDAR*");
      for (const event of data.calendarEvents) {
        sections.push(`  • ${event.time} — *${event.title}*`);
        if (event.attendees) {
          sections.push(`    _with ${event.attendees}_`);
        }
      }
    } else {
      sections.push("\n📅 *No meetings today.*");
    }

    // TOP PRIORITIES
    if (data.topPriorities.length > 0) {
      sections.push("\n🎯 *TOP PRIORITIES*");
      for (const p of data.topPriorities) {
        const due = p.dueDate ? ` (due ${p.dueDate})` : "";
        sections.push(`  • ${p.title} — _${p.project}_${due}`);
      }
    }

    // INBOX SUMMARY
    if (data.recentInboxSummary) {
      sections.push(`\n📬 *INBOX* — ${data.recentInboxSummary}`);
    }

    return sections.join("\n");
  }

  // -----------------------------------------------------------------------
  // Project status report
  // -----------------------------------------------------------------------

  /**
   * Generate a status report for a single project.
   */
  async generateProjectStatus(projectId: string): Promise<string> {
    await this.log("project_status_start", projectId);

    const project = await projectsRepo.getById(projectId);
    if (!project) {
      return `Project not found: ${projectId}`;
    }

    const openTasks = await tasksRepo.getByProjectId(projectId);
    const activeTasks = openTasks.filter((t) => t.status === "open");
    const doneTasks = openTasks.filter((t) => t.status === "done");
    const recentNotes = await notesRepo.getByProjectId(projectId);
    const pendingEscalations = (await escalationsRepo.getPending()).filter(
      (e) => e.project_id === projectId,
    );

    // Use Claude to generate a narrative summary
    const narrative = await this.callClaude(
      `You are a project status report generator for Bryson Stevens' personal operating system.
Generate a concise project status update (under 200 words). Be specific and actionable.`,
      `Project: ${project.name}${project.client ? ` (Client: ${project.client})` : ""}
Priority: ${project.priority}
Status: ${project.status}

Open Tasks (${activeTasks.length}):
${activeTasks.slice(0, 10).map((t) => `  - ${t.title} (P${t.priority}${t.due_date ? `, due ${t.due_date}` : ""})`).join("\n")}

Completed Tasks: ${doneTasks.length}

Recent Notes (${recentNotes.length}):
${recentNotes.slice(0, 3).map((n) => `  - ${n.raw_text?.slice(0, 100) ?? "structured note"} (${n.created_at})`).join("\n")}

Pending Escalations: ${pendingEscalations.length}
${pendingEscalations.map((e) => `  - ${e.summary}`).join("\n")}

Generate a brief status update.`,
      { maxTokens: 512 },
    );

    const report = [
      `📊 *Project Status: ${project.name}*`,
      project.client ? `Client: ${project.client}` : "",
      `Priority: P${project.priority} | Status: ${project.status}`,
      "",
      narrative,
      "",
      `📝 ${activeTasks.length} open tasks | ✅ ${doneTasks.length} completed | 📄 ${recentNotes.length} notes`,
      pendingEscalations.length > 0
        ? `🚨 ${pendingEscalations.length} pending escalation(s)`
        : "",
    ]
      .filter(Boolean)
      .join("\n");

    await this.log("project_status_generated", projectId, {
      openTasks: activeTasks.length,
      notes: recentNotes.length,
    });

    return report;
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
              pendingEscalations: data.pendingEscalations.length,
              calendarEvents: data.calendarEvents.length,
              topPriorities: data.topPriorities,
              stats: data.stats,
            },
          };
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          logger.error("Briefing generation failed", { error: message });
          return { status: "error", agent: this.name, message };
        }
      }

      case "project_status_request": {
        const projectId = event.projectId ?? (event.data["projectId"] as string);
        if (!projectId) {
          return {
            status: "error",
            agent: this.name,
            message: "project_status_request requires a projectId",
          };
        }
        try {
          const report = await this.generateProjectStatus(projectId);
          return {
            status: "success",
            agent: this.name,
            message: report,
          };
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          logger.error("Project status generation failed", { error: message });
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
  // Helpers
  // -----------------------------------------------------------------------

  /**
   * Derive top 3 priorities by combining task urgency with project priority.
   */
  private async computeTopPriorities(): Promise<
    { title: string; project: string; dueDate: string | null }[]
  > {
    const openTasks = await tasksRepo.getOpen();
    const projects = await projectsRepo.getActive();
    const projectMap = new Map(projects.map((p) => [p.id, p]));

    // Score = task priority * project priority (lower is more urgent)
    // Also boost overdue tasks
    const scored = openTasks.map((task) => {
      const project = task.project_id
        ? projectMap.get(task.project_id)
        : null;
      const projectPriority = project?.priority ?? 5;
      let score = task.priority * projectPriority;

      // Boost overdue tasks
      if (task.due_date) {
        const dueDate = new Date(task.due_date);
        const now = new Date();
        if (dueDate < now) {
          score = score * 0.5; // Overdue = double urgency
        } else {
          const daysUntilDue = (dueDate.getTime() - now.getTime()) / 86_400_000;
          if (daysUntilDue <= 2) {
            score = score * 0.7; // Due within 2 days
          }
        }
      }

      return {
        task,
        project,
        score,
      };
    });

    scored.sort((a, b) => a.score - b.score);

    return scored.slice(0, 3).map((s) => ({
      title: s.task.title,
      project: s.project?.name ?? "Unassigned",
      dueDate: s.task.due_date,
    }));
  }

  private summarizeRecentInbox(
    events: inboxEventsRepo.InboxEvent[],
  ): string {
    if (events.length === 0) return "No new inbox activity.";

    const byChan: Record<string, number> = {};
    let urgentCount = 0;
    for (const e of events) {
      byChan[e.channel] = (byChan[e.channel] ?? 0) + 1;
      if (e.intent === "urgent" || e.intent === "action_needed") {
        urgentCount++;
      }
    }

    const parts = Object.entries(byChan).map(
      ([chan, count]) => `${count} ${chan}`,
    );
    const urgentNote =
      urgentCount > 0 ? ` (${urgentCount} need attention)` : "";
    return `${parts.join(", ")}${urgentNote}`;
  }

  private async getNotesCreatedSince(since: Date): Promise<notesRepo.Note[]> {
    // The notes repo doesn't have a "since" filter, so we get all and filter.
    // In production, you'd add a proper query. For now, get recent and filter.
    const allNotes = await notesRepo.getAll();
    return allNotes.filter((n) => new Date(n.created_at) >= since);
  }
}

// ---------------------------------------------------------------------------
// Utility
// ---------------------------------------------------------------------------

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
