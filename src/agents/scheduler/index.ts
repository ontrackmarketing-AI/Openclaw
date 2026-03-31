import { google, calendar_v3 } from "googleapis";
import { BaseAgent, AgentEvent, AgentResult } from "../base.js";
import { config } from "../../config/index.js";
import { logger } from "../../config/logger.js";
import * as projectsRepo from "../../db/repositories/projects.js";
import * as tasksRepo from "../../db/repositories/tasks.js";
import * as contactsRepo from "../../db/repositories/contacts.js";
import * as notesRepo from "../../db/repositories/notes.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface CalendarEvent {
  id: string;
  summary: string;
  start: string;
  end: string;
  attendees: string[];
  description: string;
  location: string;
}

export interface ConflictPair {
  eventA: CalendarEvent;
  eventB: CalendarEvent;
  overlapMinutes: number;
}

export interface TimeBlockSuggestion {
  start: string;
  end: string;
  type: "deep_work" | "admin" | "break";
  reason: string;
}

export interface PreBrief {
  event: CalendarEvent;
  attendeeDetails: Array<{
    name: string;
    email: string;
    type: string | null;
    isVip: boolean;
    notes: string | null;
  }>;
  relatedProjects: Array<{
    id: string;
    name: string;
    status: string;
  }>;
  openTasks: Array<{
    id: string;
    title: string;
    priority: number;
    dueDate: string | null;
  }>;
  recentNotes: Array<{
    id: string;
    snippet: string;
    createdAt: Date;
  }>;
  briefingSummary: string;
}

export interface DailyScheduleSummary {
  date: string;
  events: CalendarEvent[];
  conflicts: ConflictPair[];
  suggestedBlocks: TimeBlockSuggestion[];
  totalMeetingHours: number;
  freeHours: number;
}

// ---------------------------------------------------------------------------
// Scheduler Agent
// ---------------------------------------------------------------------------

export class SchedulerAgent extends BaseAgent {
  constructor() {
    super("scheduler");
  }

  // -----------------------------------------------------------------------
  // Google Calendar client
  // -----------------------------------------------------------------------

  /**
   * Create a Google Calendar API client using OAuth2 credentials from config
   * (client_id, client_secret, refresh_token).
   */
  getCalendarClient(): calendar_v3.Calendar {
    const { clientId, clientSecret, refreshToken, redirectUri } = config.google;

    if (!clientId || !clientSecret || !refreshToken) {
      throw new Error(
        "Google OAuth2 credentials not configured. Set GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, and GOOGLE_REFRESH_TOKEN.",
      );
    }

    const oauth2Client = new google.auth.OAuth2(
      clientId,
      clientSecret,
      redirectUri,
    );

    oauth2Client.setCredentials({ refresh_token: refreshToken });

    return google.calendar({ version: "v3", auth: oauth2Client });
  }

  // -----------------------------------------------------------------------
  // Fetch upcoming events
  // -----------------------------------------------------------------------

  /**
   * Fetch events from Google Calendar for the next N hours. Returns an array
   * of { id, summary, start, end, attendees, description, location }.
   */
  async getUpcomingEvents(hours: number = 24): Promise<CalendarEvent[]> {
    await this.log("fetch_upcoming_events", undefined, { hours });

    try {
      const calendar = this.getCalendarClient();
      const now = new Date();
      const timeMax = new Date(now.getTime() + hours * 60 * 60 * 1000);

      const response = await calendar.events.list({
        calendarId: "primary",
        timeMin: now.toISOString(),
        timeMax: timeMax.toISOString(),
        singleEvents: true,
        orderBy: "startTime",
        maxResults: 50,
      });

      const events: CalendarEvent[] = (response.data.items ?? []).map(
        (item) => ({
          id: item.id ?? "",
          summary: item.summary ?? "(No title)",
          start:
            item.start?.dateTime ?? item.start?.date ?? now.toISOString(),
          end: item.end?.dateTime ?? item.end?.date ?? now.toISOString(),
          attendees: (item.attendees ?? [])
            .map((a) => a.email ?? "")
            .filter(Boolean),
          description: item.description ?? "",
          location: item.location ?? "",
        }),
      );

      await this.log("events_fetched", undefined, {
        count: events.length,
        hours,
      });

      return events;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error("Failed to fetch calendar events", { error: message });
      await this.log("fetch_events_error", undefined, { error: message });
      throw err;
    }
  }

  // -----------------------------------------------------------------------
  // Pre-brief generation
  // -----------------------------------------------------------------------

  /**
   * Generate a pre-meeting brief for a given calendar event:
   * 1. Look up attendees in contacts table
   * 2. Find associated projects
   * 3. Pull recent notes and open tasks for those projects
   * 4. Use Claude to generate a pre-brief with who's in the meeting,
   *    project context, open items, and suggested talking points
   */
  async generatePreBrief(event: CalendarEvent): Promise<PreBrief> {
    await this.log("generate_pre_brief", undefined, {
      eventId: event.id,
      summary: event.summary,
    });

    // 1. Look up attendees in contacts table
    const attendeeDetails: PreBrief["attendeeDetails"] = [];
    const relatedProjectIds = new Set<string>();

    for (const email of event.attendees) {
      try {
        const contact = await contactsRepo.getByEmail(email);
        if (contact) {
          attendeeDetails.push({
            name: contact.name,
            email,
            type: contact.type,
            isVip: contact.is_vip,
            notes: contact.notes,
          });
          if (contact.project_ids) {
            for (const pid of contact.project_ids) {
              relatedProjectIds.add(pid);
            }
          }
        } else {
          // Try by any handle as fallback
          const contactByHandle = await contactsRepo.findByAnyHandle(email);
          if (contactByHandle) {
            attendeeDetails.push({
              name: contactByHandle.name,
              email,
              type: contactByHandle.type,
              isVip: contactByHandle.is_vip,
              notes: contactByHandle.notes,
            });
            if (contactByHandle.project_ids) {
              for (const pid of contactByHandle.project_ids) {
                relatedProjectIds.add(pid);
              }
            }
          } else {
            attendeeDetails.push({
              name: email.split("@")[0] ?? email,
              email,
              type: null,
              isVip: false,
              notes: null,
            });
          }
        }
      } catch (err) {
        logger.warn("Failed to look up contact", {
          email,
          error: err instanceof Error ? err.message : String(err),
        });
        attendeeDetails.push({
          name: email.split("@")[0] ?? email,
          email,
          type: null,
          isVip: false,
          notes: null,
        });
      }
    }

    // 2. Find associated projects
    const relatedProjects: PreBrief["relatedProjects"] = [];
    for (const pid of relatedProjectIds) {
      try {
        const project = await projectsRepo.getById(pid);
        if (project) {
          relatedProjects.push({
            id: project.id,
            name: project.name,
            status: project.status,
          });
        }
      } catch {
        // Skip projects that fail to load
      }
    }

    // If no project matched via contacts, try keyword matching on event title
    if (relatedProjects.length === 0) {
      try {
        const activeProjects = await projectsRepo.getActive();
        for (const project of activeProjects) {
          const titleLower = event.summary.toLowerCase();
          const projNameLower = project.name.toLowerCase();
          const clientLower = (project.client ?? "").toLowerCase();
          if (
            titleLower.includes(projNameLower) ||
            projNameLower.includes(titleLower) ||
            (clientLower && titleLower.includes(clientLower))
          ) {
            relatedProjects.push({
              id: project.id,
              name: project.name,
              status: project.status,
            });
          }
        }
      } catch {
        // Best-effort
      }
    }

    // 3. Pull recent notes and open tasks for those projects
    const openTasks: PreBrief["openTasks"] = [];
    const recentNotes: PreBrief["recentNotes"] = [];

    for (const project of relatedProjects) {
      try {
        const tasks = await tasksRepo.getByProjectId(project.id);
        const open = tasks.filter((t) => t.status === "open");
        for (const t of open.slice(0, 5)) {
          openTasks.push({
            id: t.id,
            title: t.title,
            priority: t.priority,
            dueDate: t.due_date,
          });
        }
      } catch {
        // Skip on error
      }

      try {
        const notes = await notesRepo.getByProjectId(project.id);
        for (const n of notes.slice(0, 3)) {
          recentNotes.push({
            id: n.id,
            snippet: (n.raw_text ?? "").slice(0, 200),
            createdAt: n.created_at,
          });
        }
      } catch {
        // Skip on error
      }
    }

    // 4. Use Claude to generate a pre-brief
    const attendeeBlock =
      attendeeDetails.length > 0
        ? attendeeDetails
            .map(
              (a) =>
                `- ${a.name} (${a.email})${a.isVip ? " [VIP]" : ""}${a.type ? ` | ${a.type}` : ""}${a.notes ? `\n  Context: ${a.notes}` : ""}`,
            )
            .join("\n")
        : "No attendees listed.";

    const projectBlock =
      relatedProjects.length > 0
        ? relatedProjects.map((p) => `- ${p.name} (${p.status})`).join("\n")
        : "No directly related projects identified.";

    const taskBlock =
      openTasks.length > 0
        ? openTasks
            .map(
              (t) =>
                `- [P${t.priority}] ${t.title}${t.dueDate ? ` (due ${t.dueDate})` : ""}`,
            )
            .join("\n")
        : "No open tasks.";

    const notesBlock =
      recentNotes.length > 0
        ? recentNotes.map((n) => `- ${n.snippet}`).join("\n")
        : "No recent notes.";

    const briefingSummary = await this.callClaude(
      `You are Bryson Stevens' executive assistant AI. Generate a concise pre-meeting brief that Bryson can scan in 30 seconds. Focus on what matters: who he is meeting, what they care about, open items, and suggested talking points.

Bryson runs Helium Solutions (AI marketing automation agency), Search Tuners (referral marketing partnership with Mike), and OnTrack Marketing (SaaS in development).`,
      `Meeting: ${event.summary}
Time: ${event.start} to ${event.end}
Location: ${event.location || "Not specified"}
Description: ${event.description || "None"}

Attendees:
${attendeeBlock}

Related Projects:
${projectBlock}

Open Tasks:
${taskBlock}

Recent Notes:
${notesBlock}

Generate a pre-brief with:
1. Quick summary of who is in the meeting and why
2. Key context from projects and tasks
3. Open items to potentially address
4. 3-4 suggested talking points`,
      { maxTokens: 1024 },
    );

    await this.log("pre_brief_generated", undefined, {
      eventId: event.id,
      attendeeCount: attendeeDetails.length,
      projectCount: relatedProjects.length,
      taskCount: openTasks.length,
    });

    return {
      event,
      attendeeDetails,
      relatedProjects,
      openTasks,
      recentNotes,
      briefingSummary,
    };
  }

  // -----------------------------------------------------------------------
  // Conflict detection
  // -----------------------------------------------------------------------

  /**
   * Find overlapping events and return an array of conflict pairs with
   * overlap duration in minutes.
   */
  detectConflicts(events: CalendarEvent[]): ConflictPair[] {
    const conflicts: ConflictPair[] = [];
    const sorted = [...events].sort(
      (a, b) => new Date(a.start).getTime() - new Date(b.start).getTime(),
    );

    for (let i = 0; i < sorted.length; i++) {
      for (let j = i + 1; j < sorted.length; j++) {
        const a = sorted[i]!;
        const b = sorted[j]!;

        const aStart = new Date(a.start).getTime();
        const aEnd = new Date(a.end).getTime();
        const bStart = new Date(b.start).getTime();
        const bEnd = new Date(b.end).getTime();

        // Overlap: A starts before B ends AND B starts before A ends
        if (aStart < bEnd && bStart < aEnd) {
          const overlapStart = Math.max(aStart, bStart);
          const overlapEnd = Math.min(aEnd, bEnd);
          const overlapMinutes = Math.round(
            (overlapEnd - overlapStart) / 60_000,
          );

          if (overlapMinutes > 0) {
            conflicts.push({ eventA: a, eventB: b, overlapMinutes });
          }
        } else {
          // Events are sorted, so if B starts after A ends, no more
          // overlaps for A against later events
          break;
        }
      }
    }

    return conflicts;
  }

  // -----------------------------------------------------------------------
  // Time block suggestions
  // -----------------------------------------------------------------------

  /**
   * Analyze calendar density, find gaps, and suggest blocks for deep work
   * vs admin vs break. Returns array of { start, end, type, reason }.
   */
  suggestTimeBlocks(events: CalendarEvent[]): TimeBlockSuggestion[] {
    const suggestions: TimeBlockSuggestion[] = [];

    if (events.length === 0) {
      const today = new Date();
      const dayStart = new Date(today);
      dayStart.setHours(9, 0, 0, 0);
      const dayEnd = new Date(today);
      dayEnd.setHours(17, 0, 0, 0);

      suggestions.push({
        start: dayStart.toISOString(),
        end: dayEnd.toISOString(),
        type: "deep_work",
        reason: "No meetings scheduled. Use the full day for deep, focused work.",
      });
      return suggestions;
    }

    const sorted = [...events].sort(
      (a, b) => new Date(a.start).getTime() - new Date(b.start).getTime(),
    );

    // Determine work-day boundaries from first event's date
    const dayRef = new Date(sorted[0]!.start);
    const workStart = new Date(dayRef);
    workStart.setHours(8, 0, 0, 0);
    const workEnd = new Date(dayRef);
    workEnd.setHours(18, 0, 0, 0);

    // Collect all gaps
    const gaps: Array<{ start: Date; end: Date }> = [];

    // Gap before first event
    const firstStart = new Date(sorted[0]!.start);
    if (firstStart.getTime() > workStart.getTime()) {
      gaps.push({ start: workStart, end: firstStart });
    }

    // Gaps between events
    for (let i = 0; i < sorted.length - 1; i++) {
      const currentEnd = new Date(sorted[i]!.end);
      const nextStart = new Date(sorted[i + 1]!.start);
      if (nextStart.getTime() > currentEnd.getTime()) {
        gaps.push({ start: currentEnd, end: nextStart });
      }
    }

    // Gap after last event
    const lastEnd = new Date(sorted[sorted.length - 1]!.end);
    if (lastEnd.getTime() < workEnd.getTime()) {
      gaps.push({ start: lastEnd, end: workEnd });
    }

    for (const gap of gaps) {
      const durationMin = Math.round(
        (gap.end.getTime() - gap.start.getTime()) / 60_000,
      );

      if (durationMin < 15) {
        continue; // Too short
      }

      if (durationMin >= 90) {
        suggestions.push({
          start: gap.start.toISOString(),
          end: gap.end.toISOString(),
          type: "deep_work",
          reason: `${durationMin} min block. Enough for a deep work session on a priority task.`,
        });
      } else if (durationMin >= 30) {
        suggestions.push({
          start: gap.start.toISOString(),
          end: gap.end.toISOString(),
          type: "admin",
          reason: `${durationMin} min block. Good for emails, Slack catch-up, or quick admin tasks.`,
        });
      } else {
        suggestions.push({
          start: gap.start.toISOString(),
          end: gap.end.toISOString(),
          type: "break",
          reason: `${durationMin} min gap. Step away, stretch, or grab coffee.`,
        });
      }
    }

    // Warn about back-to-back meetings
    let consecutiveCount = 0;
    for (let i = 0; i < sorted.length - 1; i++) {
      const currentEnd = new Date(sorted[i]!.end).getTime();
      const nextStart = new Date(sorted[i + 1]!.start).getTime();
      if (nextStart - currentEnd < 10 * 60 * 1000) {
        consecutiveCount++;
      }
    }

    if (consecutiveCount >= 3) {
      suggestions.push({
        start: "",
        end: "",
        type: "break",
        reason: `Warning: ${consecutiveCount + 1} back-to-back meetings detected. Consider rescheduling one to create buffer time.`,
      });
    }

    return suggestions;
  }

  // -----------------------------------------------------------------------
  // Daily schedule summary
  // -----------------------------------------------------------------------

  /**
   * Combines getUpcomingEvents + detectConflicts + suggestTimeBlocks into
   * one comprehensive summary object.
   */
  async getDailyScheduleSummary(): Promise<DailyScheduleSummary> {
    await this.log("daily_schedule_summary_start");

    const events = await this.getUpcomingEvents(24);
    const conflicts = this.detectConflicts(events);
    const suggestedBlocks = this.suggestTimeBlocks(events);

    // Calculate total meeting time
    let totalMeetingMs = 0;
    for (const event of events) {
      const start = new Date(event.start).getTime();
      const end = new Date(event.end).getTime();
      totalMeetingMs += Math.max(0, end - start);
    }
    const totalMeetingHours =
      Math.round((totalMeetingMs / (1000 * 60 * 60)) * 10) / 10;

    // Assume a 10-hour working day
    const freeHours =
      Math.round(Math.max(0, 10 - totalMeetingHours) * 10) / 10;

    const summary: DailyScheduleSummary = {
      date: new Date().toISOString().split("T")[0]!,
      events,
      conflicts,
      suggestedBlocks,
      totalMeetingHours,
      freeHours,
    };

    await this.log("daily_schedule_summary_complete", undefined, {
      eventCount: events.length,
      conflictCount: conflicts.length,
      suggestedBlockCount: suggestedBlocks.length,
      totalMeetingHours,
      freeHours,
    });

    return summary;
  }

  // -----------------------------------------------------------------------
  // Entry point
  // -----------------------------------------------------------------------

  async process(event: AgentEvent): Promise<AgentResult> {
    if (event.type !== "calendar_check") {
      return {
        status: "error",
        agent: this.name,
        message: `Scheduler agent cannot handle event type: ${event.type}`,
      };
    }

    try {
      const action = (event.data["action"] as string) ?? "daily_summary";

      switch (action) {
        case "daily_summary": {
          const summary = await this.getDailyScheduleSummary();
          return {
            status: summary.conflicts.length > 0 ? "partial" : "success",
            agent: this.name,
            message: `Daily schedule: ${summary.events.length} events, ${summary.conflicts.length} conflicts, ${summary.freeHours}h free`,
            data: summary as unknown as Record<string, unknown>,
            escalation:
              summary.conflicts.length > 0
                ? {
                    summary: `${summary.conflicts.length} scheduling conflict(s) detected`,
                    context: summary.conflicts
                      .map(
                        (c) =>
                          `"${c.eventA.summary}" overlaps "${c.eventB.summary}" by ${c.overlapMinutes}min`,
                      )
                      .join("\n"),
                  }
                : undefined,
          };
        }

        case "pre_brief": {
          const eventId = event.data["eventId"] as string;
          if (!eventId) {
            return {
              status: "error",
              agent: this.name,
              message: "pre_brief action requires an eventId",
            };
          }

          const events = await this.getUpcomingEvents(72);
          const targetEvent = events.find((e) => e.id === eventId);
          if (!targetEvent) {
            return {
              status: "error",
              agent: this.name,
              message: `Event ${eventId} not found in upcoming events`,
            };
          }

          const brief = await this.generatePreBrief(targetEvent);
          return {
            status: "success",
            agent: this.name,
            message: `Pre-brief generated for: ${targetEvent.summary}`,
            data: brief as unknown as Record<string, unknown>,
          };
        }

        case "upcoming": {
          const hours = (event.data["hours"] as number) ?? 24;
          const events = await this.getUpcomingEvents(hours);
          return {
            status: "success",
            agent: this.name,
            message: `Found ${events.length} events in next ${hours} hours`,
            data: { events } as Record<string, unknown>,
          };
        }

        default:
          return {
            status: "error",
            agent: this.name,
            message: `Unknown scheduler action: ${action}`,
          };
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error("Scheduler agent error", { error: message });
      await this.log("scheduler_error", event.projectId, { error: message });
      return { status: "error", agent: this.name, message };
    }
  }
}

// ---------------------------------------------------------------------------
// Singleton
// ---------------------------------------------------------------------------

export const schedulerAgent = new SchedulerAgent();
