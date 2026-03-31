import { Telegraf, Markup } from "telegraf";
import type { Context, NarrowedContext } from "telegraf";
import type { Update } from "telegraf/types";
import { config } from "../../config/index.js";
import { logger } from "../../config/logger.js";
import * as agentLogs from "../../db/repositories/agent-logs.js";
import * as escalationsRepo from "../../db/repositories/escalations.js";
import * as tasksRepo from "../../db/repositories/tasks.js";
import * as projectsRepo from "../../db/repositories/projects.js";
import * as notesRepo from "../../db/repositories/notes.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface TelegramCommand {
  command: string;
  args: string;
  chatId: string;
  messageId: number;
}

export interface BriefingData {
  pendingEscalations: escalationsRepo.Escalation[];
  handledOvernight: string[];
  calendarEvents: { title: string; time: string; attendees: string }[];
  topPriorities: { title: string; project: string; dueDate: string | null }[];
  date: string;
}

// ---------------------------------------------------------------------------
// Telegram Sub-Agent
// ---------------------------------------------------------------------------

export class TelegramSubAgent {
  private bot: Telegraf;
  private authorizedChatId: string;

  constructor() {
    this.bot = new Telegraf(config.telegram.botToken ?? "");
    this.authorizedChatId = config.telegram.brysonChatId ?? "";
  }

  /** Return the underlying Telegraf instance for webhook/polling setup. */
  getBot(): Telegraf {
    return this.bot;
  }

  // -----------------------------------------------------------------------
  // Authorization check
  // -----------------------------------------------------------------------

  private isAuthorized(chatId: string | number): boolean {
    return String(chatId) === this.authorizedChatId;
  }

  // -----------------------------------------------------------------------
  // Command routing
  // -----------------------------------------------------------------------

  /**
   * Route a Telegram slash command to the appropriate handler.
   * Returns the response text to send back.
   */
  async handleCommand(
    command: string,
    args: string,
    chatId: string,
  ): Promise<string> {
    if (!this.isAuthorized(chatId)) {
      return "Unauthorized.";
    }

    await agentLogs.log({
      agent: "inbox.telegram",
      event: "command_received",
      metadata: { command, args },
    });

    switch (command) {
      case "brief":
        return "Generating briefing... (use the reporting agent to produce full briefing)";

      case "status": {
        const projects = await projectsRepo.getActive();
        if (projects.length === 0) return "No active projects.";
        const lines = projects.map(
          (p, i) =>
            `${i + 1}. *${p.name}*${p.client ? ` (${p.client})` : ""} — P${p.priority}`,
        );
        return `📋 *Active Projects*\n\n${lines.join("\n")}`;
      }

      case "tasks": {
        const projectName = args.trim();
        let tasks: tasksRepo.Task[];
        if (projectName) {
          const project = await projectsRepo.getByName(projectName);
          if (!project) return `No project found matching "${projectName}".`;
          tasks = await tasksRepo.getByProjectId(project.id);
          tasks = tasks.filter((t) => t.status === "open");
        } else {
          tasks = await tasksRepo.getOpen();
        }

        if (tasks.length === 0) return "No open tasks.";
        const lines = tasks.slice(0, 15).map(
          (t) =>
            `• ${t.title}${t.due_date ? ` (due ${t.due_date})` : ""} — P${t.priority}`,
        );
        const header = projectName
          ? `📝 *Open Tasks — ${projectName}*`
          : "📝 *All Open Tasks*";
        return `${header}\n\n${lines.join("\n")}${tasks.length > 15 ? `\n\n... and ${tasks.length - 15} more` : ""}`;
      }

      case "escalations": {
        const pending = await escalationsRepo.getPending();
        if (pending.length === 0) return "No pending escalations.";
        const lines = pending.map(
          (e, i) => `${i + 1}. ${e.summary}${e.type ? ` [${e.type}]` : ""}`,
        );
        return `🚨 *Pending Escalations*\n\n${lines.join("\n")}`;
      }

      case "done": {
        const taskTitle = args.trim();
        if (!taskTitle) return "Usage: /done <task title or ID>";
        // Try by ID first, then by title search
        let task = await tasksRepo.getById(taskTitle);
        if (!task) {
          const openTasks = await tasksRepo.getOpen();
          task =
            openTasks.find((t) =>
              t.title.toLowerCase().includes(taskTitle.toLowerCase()),
            ) ?? null;
        }
        if (!task) return `No open task matching "${taskTitle}".`;
        await tasksRepo.update(task.id, { status: "done" });
        return `✅ Marked done: ${task.title}`;
      }

      case "skip": {
        const escalationId = args.trim();
        if (!escalationId) return "Usage: /skip <escalation ID>";
        const escalation = await escalationsRepo.getById(escalationId);
        if (!escalation) return "Escalation not found.";
        await escalationsRepo.markDismissed(escalation.id);
        return `⏭ Skipped escalation: ${escalation.summary}`;
      }

      case "approve": {
        const approveId = args.trim();
        if (!approveId) return "Usage: /approve <escalation ID>";
        const esc = await escalationsRepo.getById(approveId);
        if (!esc) return "Escalation not found.";
        await escalationsRepo.markActioned(esc.id);
        return `✅ Approved: ${esc.summary}`;
      }

      case "note": {
        const noteText = args.trim();
        if (!noteText) return "Usage: /note <text>";
        await notesRepo.create({
          source: "telegram",
          raw_text: noteText,
        });
        return `📝 Note saved.`;
      }

      case "ingest":
        return "Send a photo of your notebook page and I'll ingest it.";

      default:
        return `Unknown command: /${command}. Available: /brief, /status, /tasks, /escalations, /done, /skip, /approve, /note, /ingest`;
    }
  }

  // -----------------------------------------------------------------------
  // Sending messages
  // -----------------------------------------------------------------------

  /**
   * Send an escalation to Bryson with inline keyboard buttons.
   */
  async sendEscalation(
    escalation: escalationsRepo.Escalation,
  ): Promise<number | null> {
    try {
      const text = [
        `🚨 *Escalation*${escalation.type ? ` — ${escalation.type}` : ""}`,
        "",
        escalation.summary,
        "",
        escalation.context ? `_${escalation.context}_` : "",
      ]
        .filter(Boolean)
        .join("\n");

      const keyboard = Markup.inlineKeyboard([
        Markup.button.callback("✅ Handle", `handle:${escalation.id}`),
        Markup.button.callback("⏭ Skip", `skip:${escalation.id}`),
        Markup.button.callback("✏️ Edit", `edit:${escalation.id}`),
      ]);

      const msg = await this.bot.telegram.sendMessage(
        this.authorizedChatId,
        text,
        { parse_mode: "Markdown", ...keyboard },
      );

      // Store the telegram message ID on the escalation record
      const { query: dbQuery } = await import("../../db/connection.js");
      await dbQuery(
        "UPDATE escalations SET telegram_message_id = $1 WHERE id = $2",
        [String(msg.message_id), escalation.id],
      );

      await agentLogs.log({
        agent: "inbox.telegram",
        event: "escalation_sent",
        metadata: { escalationId: escalation.id },
      });

      return msg.message_id;
    } catch (err) {
      logger.error("Failed to send escalation to Telegram", {
        error: err instanceof Error ? err.message : String(err),
        escalationId: escalation.id,
      });
      return null;
    }
  }

  // -----------------------------------------------------------------------
  // Briefing
  // -----------------------------------------------------------------------

  /**
   * Format and send the morning briefing.
   */
  async sendBriefing(data: BriefingData): Promise<void> {
    const text = this.formatBriefingMessage(data);

    try {
      await this.bot.telegram.sendMessage(this.authorizedChatId, text, {
        parse_mode: "Markdown",
      });

      await agentLogs.log({
        agent: "inbox.telegram",
        event: "briefing_sent",
        metadata: { date: data.date },
      });
    } catch (err) {
      logger.error("Failed to send briefing", {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  private formatBriefingMessage(data: BriefingData): string {
    const sections: string[] = [];

    sections.push(`☀️ *Daily Briefing — ${data.date}*`);

    // Needs You Today
    if (data.pendingEscalations.length > 0) {
      sections.push("\n🚨 *NEEDS YOU TODAY*");
      for (const e of data.pendingEscalations) {
        sections.push(`  • ${e.summary}`);
      }
    }

    // Handled Overnight
    if (data.handledOvernight.length > 0) {
      sections.push("\n✅ *HANDLED OVERNIGHT*");
      for (const item of data.handledOvernight) {
        sections.push(`  • ${item}`);
      }
    }

    // Calendar
    if (data.calendarEvents.length > 0) {
      sections.push("\n📅 *TODAY'S CALENDAR*");
      for (const event of data.calendarEvents) {
        sections.push(`  • ${event.time} — ${event.title}`);
        if (event.attendees) {
          sections.push(`    _with ${event.attendees}_`);
        }
      }
    }

    // Top Priorities
    if (data.topPriorities.length > 0) {
      sections.push("\n🎯 *TOP PRIORITIES*");
      for (const p of data.topPriorities) {
        const due = p.dueDate ? ` (due ${p.dueDate})` : "";
        sections.push(`  • ${p.title} — _${p.project}_${due}`);
      }
    }

    return sections.join("\n");
  }

  // -----------------------------------------------------------------------
  // Callback queries (inline button presses)
  // -----------------------------------------------------------------------

  /**
   * Process an inline keyboard callback.
   * Expected data format: "action:escalation_id"
   */
  async handleCallbackQuery(
    data: string,
    ctx?: NarrowedContext<Context<Update>, Update.CallbackQueryUpdate>,
  ): Promise<string> {
    const [action, escalationId] = data.split(":");
    if (!action || !escalationId) {
      return "Invalid callback data.";
    }

    await agentLogs.log({
      agent: "inbox.telegram",
      event: "callback_query",
      metadata: { action, escalationId },
    });

    const escalation = await escalationsRepo.getById(escalationId);
    if (!escalation) {
      return "Escalation not found.";
    }

    switch (action) {
      case "handle":
      case "approve":
        await escalationsRepo.markActioned(escalationId);
        if (ctx) {
          await ctx.editMessageReplyMarkup(undefined);
          await ctx.answerCbQuery("Marked as handled.");
        }
        return `Escalation handled: ${escalation.summary}`;

      case "skip":
      case "dismiss":
        await escalationsRepo.markDismissed(escalationId);
        if (ctx) {
          await ctx.editMessageReplyMarkup(undefined);
          await ctx.answerCbQuery("Skipped.");
        }
        return `Escalation skipped: ${escalation.summary}`;

      case "edit":
        if (ctx) {
          await ctx.answerCbQuery("Reply to this message with your edits.");
        }
        return "Awaiting edits...";

      default:
        return `Unknown action: ${action}`;
    }
  }

  // -----------------------------------------------------------------------
  // Send a plain message
  // -----------------------------------------------------------------------

  async sendMessage(
    text: string,
    parseMode: "Markdown" | "HTML" = "Markdown",
  ): Promise<void> {
    try {
      await this.bot.telegram.sendMessage(this.authorizedChatId, text, {
        parse_mode: parseMode,
      });
    } catch (err) {
      logger.error("Failed to send Telegram message", {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
}
