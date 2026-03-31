import { BaseAgent, AgentEvent, AgentResult } from "../base.js";
import { logger } from "../../config/logger.js";
import * as projectsRepo from "../../db/repositories/projects.js";
import * as tasksRepo from "../../db/repositories/tasks.js";
import * as notesRepo from "../../db/repositories/notes.js";
import * as contactsRepo from "../../db/repositories/contacts.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface CalendarEvent {
  id: string;
  summary: string;
  description: string | null;
  start: string; // ISO datetime
  end: string;
  location: string | null;
  attendees: { email: string; displayName?: string; responseStatus?: string }[];
  organizer: { email: string; displayName?: string };
  htmlLink: string;
}

interface Conflict {
  event1: CalendarEvent;
  event2: CalendarEvent;
  overlapMinutes: number;
}

interface TimeBlockSuggestion {
  start: string;
  end: string;
  durationMinutes: number;
  type: "deep_work" | "admin" | "break";
  reason: string;
}

interface PreBrief {
  event: CalendarEvent;
  contactInfo: contactsRepo.Contact | null;
  projectContext: string | null;
  recentNotes: string[];
  openTasks: string[];
  suggestedPrep: string;
}

// ---------------------------------------------------------------------------
// Scheduler Agent
// ---------------------------------------------------------------------------

export class SchedulerAgent extends BaseAgent {
  constructor() {
    super("scheduler");
  }

  // -----------------------------------------------------------------------
  // Fetch upcoming events from Google Calendar
  // -----------------------------------------------------------------------

  /**
   * Fetch events from Google Calendar for the next N hours.
   */
  async getUpcomingEvents(hours: number = 24): Promise<CalendarEvent[]> {
    let google: typeof import("googleapis").google;
    try {
      const mod = await import("googleapis");
      google = mod.google;
    } catch {
      logger.warn("googleapis not available — returning empty calendar");
      return [];
    }

    const authToken = process.env["GOOGLE_ACCESS_TOKEN"];
    if (!authToken) {
      logger.warn("GOOGLE_ACCESS_TOKEN not set — skipping calendar fetch");
      return [];
    }

    const auth = new google.auth.OAuth2();
    auth.setCredentials({ access_token: authToken });
    const calendar = google.calendar({ version: "v3", auth });

    const now = new Date();
    const timeMax = new Date(now.getTime() + hours * 60 * 60 * 1000);

    await this.log("fetch_calendar", undefined, { hours });

    try {
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
          summary: item.summary ?? "(no title)",
          description: item.description ?? null,
          start: item.start?.dateTime ?? item.start?.date ?? "",
          end: item.end?.dateTime ?? item.end?.date ?? "",
          location: item.location ?? null,
          attendees: (item.attendees ?? []).map((a) => ({
            email: a.email ?? "",
            displayName: a.displayName ?? undefined,
            responseStatus: a.responseStatus ?? undefined,
          })),
          organizer: {
            email: item.organizer?.email ?? "",
            displayName: item.organizer?.displayName ?? undefined,
          },
          htmlLink: item.htmlLink ?? "",
        }),
      );

      await this.log("calendar_fetched", undefined, {
        eventCount: events.length,
        timeRange: `${hours}h`,
      });

      return events;
    } catch (err) {
      logger.error("Calendar fetch failed", {
        error: err instanceof Error ? err.message : String(err),
      });
      return [];
    }
  }

  // -----------------------------------------------------------------------
  // Pre-brief generation
  // -----------------------------------------------------------------------

  /**
   * Generate a pre-brief for an upcoming meeting.
   * Pulls contact info, project context, recent notes, and open tasks.
   */
  async generatePreBrief(event: CalendarEvent): Promise<PreBrief> {
    await this.log("generate_prebrief", undefined, {
      eventId: event.id,
      summary: event.summary,
    });

    // Look up attendees in contacts
    let contactInfo: contactsRepo.Contact | null = null;
    for (const attendee of event.attendees) {
      const contact = await contactsRepo.findByAnyHandle(attendee.email);
      if (contact) {
        contactInfo = contact;
        break;
      }
    }

    // Try to find related project
    let projectContext: string | null = null;
    let recentNotes: string[] = [];
    let openTasks: string[] = [];

    if (contactInfo?.project_ids && contactInfo.project_ids.length > 0) {
      const projectId = contactInfo.project_ids[0]!;
      const project = await projectsRepo.getById(projectId);

      if (project) {
        projectContext = `${project.name}${project.client ? ` (${project.client})` : ""} — Priority ${project.priority}, Status: ${project.status}`;

        const notes = await notesRepo.getByProjectId(project.id);
        recentNotes = notes
          .slice(0, 3)
          .map(
            (n) =>
              n.raw_text?.slice(0, 200) ??
              JSON.stringify(n.structured)?.slice(0, 200) ??
              "",
          )
          .filter((t) => t.length > 0);

        const tasks = await tasksRepo.getByProjectId(project.id);
        openTasks = tasks
          .filter((t) => t.status === "open")
          .slice(0, 5)
          .map(
            (t) =>
              `${t.title}${t.due_date ? ` (due ${t.due_date})` : ""} — P${t.priority}`,
          );
      }
    }

    // Generate prep suggestions using Claude
    const suggestedPrep = await this.generatePrepSuggestion(
      event,
      contactInfo,
      projectContext,
      recentNotes,
      openTasks,
    );

    const preBrief: PreBrief = {
      event,
      contactInfo,
      projectContext,
      recentNotes,
      openTasks,
      suggestedPrep,
    };

    await this.log("prebrief_generated", undefined, {
      eventId: event.id,
      hasContact: !!contactInfo,
      hasProject: !!projectContext,
    });

    return preBrief;
  }

  private async generatePrepSuggestion(
    event: CalendarEvent,
    contact: contactsRepo.Contact | null,
    projectContext: string | null,
    recentNotes: string[],
    openTasks: string[],
  ): Promise<string> {
    const contactSection = contact
      ? `Contact: ${contact.name}${contact.type ? ` (${contact.type})` : ""}${contact.is_vip ? " — VIP" : ""}${contact.notes ? `\nNotes: ${contact.notes}` : ""}`
      : "No matching contact in system.";

    const projectSection = projectContext
      ? `Project: ${projectContext}`
      : "No linked project.";

    const notesSection =
      recentNotes.length > 0
        ? `Recent Notes:\n${recentNotes.map((n) => `  - ${n}`).join("\n")}`
        : "No recent notes.";

    const tasksSection =
      openTasks.length > 0
        ? `Open Tasks:\n${openTasks.map((t) => `  - ${t}`).join("\n")}`
        : "No open tasks.";

    return this.callClaude(
      `You are a meeting prep assistant for Bryson Stevens. Bryson runs Helium Solutions (AI marketing automation agency), Search Tuners (referral marketing with Mike), and OnTrack Marketing (SaaS).

Based on the meeting details and available context, suggest 2-4 specific preparation items. Be concise and actionable.`,
      `Meeting: ${event.summary}
Time: ${event.start} to ${event.end}
${event.description ? `Description: ${event.description}` : ""}
${event.location ? `Location: ${event.location}` : ""}
Attendees: ${event.attendees.map((a) => a.displayName ?? a.email).join(", ")}

${contactSection}
${projectSection}
${notesSection}
${tasksSection}

What should Bryson prepare for this meeting?`,
      { maxTokens: 512 },
    );
  }

  // -----------------------------------------------------------------------
  // Conflict detection
  // -----------------------------------------------------------------------

  /**
   * Find overlapping events in a list of calendar events.
   */
  detectConflicts(events: CalendarEvent[]): Conflict[] {
    const conflicts: Conflict[] = [];
    const sorted = [...events].sort(
      (a, b) => new Date(a.start).getTime() - new Date(b.start).getTime(),
    );

    for (let i = 0; i < sorted.length; i++) {
      for (let j = i + 1; j < sorted.length; j++) {
        const event1 = sorted[i]!;
        const event2 = sorted[j]!;

        const start1 = new Date(event1.start).getTime();
        const end1 = new Date(event1.end).getTime();
        const start2 = new Date(event2.start).getTime();
        const end2 = new Date(event2.end).getTime();

        // Check for overlap: event2 starts before event1 ends
        if (start2 < end1) {
          const overlapStart = Math.max(start1, start2);
          const overlapEnd = Math.min(end1, end2);
          const overlapMinutes = Math.round(
            (overlapEnd - overlapStart) / 60_000,
          );

          if (overlapMinutes > 0) {
            conflicts.push({ event1, event2, overlapMinutes });
          }
        } else {
          // Since sorted, no more overlaps possible for event1
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
   * Analyse calendar density and suggest deep work / admin / break blocks.
   */
  suggestTimeBlocks(events: CalendarEvent[]): TimeBlockSuggestion[] {
    const suggestions: TimeBlockSuggestion[] = [];
    const sorted = [...events].sort(
      (a, b) => new Date(a.start).getTime() - new Date(b.start).getTime(),
    );

    if (sorted.length === 0) {
      // Full day free — suggest a deep work block
      const today = new Date();
      today.setHours(9, 0, 0, 0);
      const end = new Date(today);
      end.setHours(12, 0, 0, 0);

      suggestions.push({
        start: today.toISOString(),
        end: end.toISOString(),
        durationMinutes: 180,
        type: "deep_work",
        reason: "No meetings today — ideal for a 3-hour deep work block.",
      });
      return suggestions;
    }

    // Work hours: 8 AM to 6 PM
    const dayStart = new Date(sorted[0]!.start);
    dayStart.setHours(8, 0, 0, 0);
    const dayEnd = new Date(dayStart);
    dayEnd.setHours(18, 0, 0, 0);

    // Find gaps between events
    let cursor = dayStart.getTime();

    for (const event of sorted) {
      const eventStart = new Date(event.start).getTime();
      const eventEnd = new Date(event.end).getTime();

      if (eventStart > cursor) {
        const gapMinutes = Math.round((eventStart - cursor) / 60_000);

        if (gapMinutes >= 120) {
          suggestions.push({
            start: new Date(cursor).toISOString(),
            end: new Date(eventStart).toISOString(),
            durationMinutes: gapMinutes,
            type: "deep_work",
            reason: `${gapMinutes}-minute gap before "${event.summary}" — good for focused work.`,
          });
        } else if (gapMinutes >= 30) {
          suggestions.push({
            start: new Date(cursor).toISOString(),
            end: new Date(eventStart).toISOString(),
            durationMinutes: gapMinutes,
            type: "admin",
            reason: `${gapMinutes}-minute gap — good for emails, quick tasks, or admin.`,
          });
        } else if (gapMinutes >= 10) {
          suggestions.push({
            start: new Date(cursor).toISOString(),
            end: new Date(eventStart).toISOString(),
            durationMinutes: gapMinutes,
            type: "break",
            reason: `Short ${gapMinutes}-minute gap — take a break.`,
          });
        }
      }

      cursor = Math.max(cursor, eventEnd);
    }

    // After last event until end of work day
    if (cursor < dayEnd.getTime()) {
      const remainingMinutes = Math.round(
        (dayEnd.getTime() - cursor) / 60_000,
      );
      if (remainingMinutes >= 60) {
        suggestions.push({
          start: new Date(cursor).toISOString(),
          end: dayEnd.toISOString(),
          durationMinutes: remainingMinutes,
          type: "deep_work",
          reason: `${remainingMinutes} minutes after last meeting — finish the day with focused work.`,
        });
      }
    }

    return suggestions;
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
      const hours =
        (event.data["hours"] as number | undefined) ?? 24;
      const generateBriefs =
        (event.data["generateBriefs"] as boolean | undefined) ?? true;

      await this.log("calendar_check_start", undefined, { hours });

      const events = await this.getUpcomingEvents(hours);

      // Detect conflicts
      const conflicts = this.detectConflicts(events);
      if (conflicts.length > 0) {
        await this.log("conflicts_detected", undefined, {
          count: conflicts.length,
        });
      }

      // Suggest time blocks
      const timeBlocks = this.suggestTimeBlocks(events);

      // Generate pre-briefs for upcoming meetings
      const preBriefs: PreBrief[] = [];
      if (generateBriefs) {
        for (const ev of events.slice(0, 5)) {
          // Limit to next 5 events
          try {
            const brief = await this.generatePreBrief(ev);
            preBriefs.push(brief);
          } catch (err) {
            logger.error("Pre-brief generation failed", {
              eventId: ev.id,
              error: err instanceof Error ? err.message : String(err),
            });
          }
        }
      }

      await this.log("calendar_check_complete", undefined, {
        eventCount: events.length,
        conflictCount: conflicts.length,
        timeBlockCount: timeBlocks.length,
        preBriefCount: preBriefs.length,
      });

      return {
        status: conflicts.length > 0 ? "partial" : "success",
        agent: this.name,
        message: `Calendar: ${events.length} events, ${conflicts.length} conflicts, ${timeBlocks.length} suggested time blocks`,
        data: {
          events: events.map((e) => ({
            id: e.id,
            summary: e.summary,
            start: e.start,
            end: e.end,
            attendeeCount: e.attendees.length,
          })),
          conflicts: conflicts.map((c) => ({
            event1: c.event1.summary,
            event2: c.event2.summary,
            overlapMinutes: c.overlapMinutes,
          })),
          timeBlocks,
          preBriefs: preBriefs.map((pb) => ({
            event: pb.event.summary,
            hasContact: !!pb.contactInfo,
            hasProject: !!pb.projectContext,
            suggestedPrep: pb.suggestedPrep,
          })),
        },
        escalation:
          conflicts.length > 0
            ? {
                summary: `📅 ${conflicts.length} scheduling conflict(s) detected`,
                context: conflicts
                  .map(
                    (c) =>
                      `"${c.event1.summary}" overlaps with "${c.event2.summary}" by ${c.overlapMinutes}min`,
                  )
                  .join("\n"),
              }
            : undefined,
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error("Scheduler agent error", { error: message });
      await this.log("scheduler_error", undefined, { error: message });
      return { status: "error", agent: this.name, message };
    }
  }
}
