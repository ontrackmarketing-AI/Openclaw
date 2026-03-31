import { Telegraf, type Context } from "telegraf";
import type { Message } from "telegraf/types";
import { config } from "../config/index.js";
import { logger } from "../config/logger.js";
import {
  tasksRepo,
  escalationsRepo,
  projectsRepo,
  notesRepo,
} from "../db/repositories/index.js";

// ---------------------------------------------------------------------------
// MarkdownV2 escaping
// ---------------------------------------------------------------------------
const MD2_SPECIAL = /[_*\[\]()~`>#+\-=|{}.!\\]/g;

export function escapeMarkdownV2(text: string): string {
  return text.replace(MD2_SPECIAL, "\\$&");
}

function bold(text: string): string {
  return `*${escapeMarkdownV2(text)}*`;
}

function code(text: string): string {
  return `\`${text.replace(/[`\\]/g, "\\$&")}\``;
}

// ---------------------------------------------------------------------------
// Security: verify messages come from Bryson's chat ID
// ---------------------------------------------------------------------------
function isBryson(ctx: Context): boolean {
  const chatId = ctx.chat?.id?.toString();
  if (!config.telegram.brysonChatId) {
    logger.warn("TELEGRAM_BRYSON_CHAT_ID not set; allowing all messages");
    return true;
  }
  if (chatId !== config.telegram.brysonChatId) {
    logger.warn("Telegram: unauthorized chat", {
      chatId,
      expected: config.telegram.brysonChatId,
    });
    return false;
  }
  return true;
}

function guardBryson(ctx: Context): boolean {
  if (!isBryson(ctx)) {
    void ctx.reply("Unauthorized. This bot is private.");
    return false;
  }
  return true;
}

// ---------------------------------------------------------------------------
// Bot singleton
// ---------------------------------------------------------------------------
let bot: Telegraf | null = null;

export function getBot(): Telegraf {
  if (bot) return bot;

  if (!config.telegram.botToken) {
    throw new Error("TELEGRAM_BOT_TOKEN is not configured");
  }

  bot = new Telegraf(config.telegram.botToken);
  registerCommands(bot);
  registerHandlers(bot);

  // Global error handler
  bot.catch((err: unknown, ctx: Context) => {
    logger.error("Telegram bot error", {
      error: err instanceof Error ? err.message : String(err),
      updateType: ctx.updateType,
    });
  });

  return bot;
}

// ---------------------------------------------------------------------------
// Command registration
// ---------------------------------------------------------------------------
function registerCommands(bot: Telegraf): void {
  bot.command("start", async (ctx) => {
    if (!guardBryson(ctx)) return;
    await ctx.reply(
      "OpenClaw Personal OS online\\. Ready to assist\\.\n\n" +
        "Commands:\n" +
        "/brief \\- Morning briefing\n" +
        "/status \\- System status\n" +
        "/tasks \\- Open tasks\n" +
        "/ingest \\- Trigger ingestion\n" +
        "/escalations \\- Pending escalations\n" +
        "/done \\<id\\> \\- Mark task done\n" +
        "/skip \\<id\\> \\- Skip escalation\n" +
        "/approve \\<id\\> \\- Approve escalation\n" +
        "/note \\<text\\> \\- Quick note",
      { parse_mode: "MarkdownV2" },
    );
  });

  bot.command("brief", async (ctx) => {
    if (!guardBryson(ctx)) return;
    await handleBriefing(ctx);
  });

  bot.command("status", async (ctx) => {
    if (!guardBryson(ctx)) return;
    await handleStatus(ctx);
  });

  bot.command("tasks", async (ctx) => {
    if (!guardBryson(ctx)) return;
    await handleTasks(ctx);
  });

  bot.command("ingest", async (ctx) => {
    if (!guardBryson(ctx)) return;
    await handleIngest(ctx);
  });

  bot.command("escalations", async (ctx) => {
    if (!guardBryson(ctx)) return;
    await handleEscalations(ctx);
  });

  bot.command("done", async (ctx) => {
    if (!guardBryson(ctx)) return;
    await handleDone(ctx);
  });

  bot.command("skip", async (ctx) => {
    if (!guardBryson(ctx)) return;
    await handleSkip(ctx);
  });

  bot.command("approve", async (ctx) => {
    if (!guardBryson(ctx)) return;
    await handleApprove(ctx);
  });

  bot.command("note", async (ctx) => {
    if (!guardBryson(ctx)) return;
    await handleNote(ctx);
  });
}

// ---------------------------------------------------------------------------
// Media and callback handlers
// ---------------------------------------------------------------------------
function registerHandlers(bot: Telegraf): void {
  // Photo uploads -> ingestion
  bot.on("photo", async (ctx) => {
    if (!guardBryson(ctx)) return;
    try {
      const photos = ctx.message.photo;
      const largest = photos[photos.length - 1];
      if (!largest) {
        await ctx.reply("Could not process photo.");
        return;
      }

      const fileLink = await ctx.telegram.getFileLink(largest.file_id);
      const caption = ctx.message.caption ?? "";

      await notesRepo.create({
        raw_text: caption || "Photo upload",
        source: "telegram:photo",
        image_path: fileLink.href,
      });

      logger.info("Photo ingested from Telegram", { fileId: largest.file_id });
      await ctx.reply(
        escapeMarkdownV2("Photo received and queued for ingestion."),
        { parse_mode: "MarkdownV2" },
      );
    } catch (err) {
      logger.error("Failed to process Telegram photo", { error: err });
      await ctx.reply("Failed to process photo. Try again.");
    }
  });

  // Document uploads -> ingestion
  bot.on("document", async (ctx) => {
    if (!guardBryson(ctx)) return;
    try {
      const doc = ctx.message.document;
      const fileLink = await ctx.telegram.getFileLink(doc.file_id);
      const caption = ctx.message.caption ?? doc.file_name ?? "";

      await notesRepo.create({
        raw_text: caption || `Document: ${doc.file_name ?? "unnamed"}`,
        source: "telegram:document",
        image_path: fileLink.href,
      });

      logger.info("Document ingested from Telegram", {
        fileId: doc.file_id,
        fileName: doc.file_name,
      });
      await ctx.reply(
        escapeMarkdownV2(
          `Document "${doc.file_name ?? "unnamed"}" received and queued for ingestion.`,
        ),
        { parse_mode: "MarkdownV2" },
      );
    } catch (err) {
      logger.error("Failed to process Telegram document", { error: err });
      await ctx.reply("Failed to process document. Try again.");
    }
  });

  // Callback queries (inline keyboard button presses)
  bot.on("callback_query", async (ctx) => {
    if (!guardBryson(ctx)) return;

    const data =
      "data" in ctx.callbackQuery ? ctx.callbackQuery.data : undefined;
    if (!data) {
      await ctx.answerCbQuery("Unknown action");
      return;
    }

    try {
      // Format: action:escalation_id
      const [action, escalationId] = data.split(":");
      if (!action || !escalationId) {
        await ctx.answerCbQuery("Invalid callback data");
        return;
      }

      const escalation = await escalationsRepo.getById(escalationId);
      if (!escalation) {
        await ctx.answerCbQuery("Escalation not found");
        return;
      }

      if (escalation.status !== "pending") {
        await ctx.answerCbQuery("Already handled");
        return;
      }

      switch (action) {
        case "approve":
          await escalationsRepo.markActioned(escalationId);
          await ctx.answerCbQuery("Approved!");
          await ctx.editMessageReplyMarkup(undefined);
          await ctx.reply(
            escapeMarkdownV2(`Escalation approved: ${escalation.summary}`),
            { parse_mode: "MarkdownV2" },
          );
          break;

        case "edit":
          await ctx.answerCbQuery("Send your edits as a reply");
          await ctx.reply(
            escapeMarkdownV2(
              `Editing escalation: ${escalation.summary}\nReply with your changes.`,
            ),
            { parse_mode: "MarkdownV2" },
          );
          break;

        case "handle":
          await escalationsRepo.markActioned(escalationId);
          await ctx.answerCbQuery("Marked for manual handling");
          await ctx.editMessageReplyMarkup(undefined);
          await ctx.reply(
            escapeMarkdownV2(
              `You're handling: ${escalation.summary}`,
            ),
            { parse_mode: "MarkdownV2" },
          );
          break;

        case "dismiss":
          await escalationsRepo.markDismissed(escalationId);
          await ctx.answerCbQuery("Dismissed");
          await ctx.editMessageReplyMarkup(undefined);
          break;

        default:
          await ctx.answerCbQuery("Unknown action");
      }

      logger.info("Escalation callback handled", {
        action,
        escalationId,
      });
    } catch (err) {
      logger.error("Failed to handle callback query", { error: err });
      await ctx.answerCbQuery("Error processing action");
    }
  });
}

// ---------------------------------------------------------------------------
// Command handlers
// ---------------------------------------------------------------------------

async function handleBriefing(ctx: Context): Promise<void> {
  try {
    const [projects, openTasks, overdueTasks, pending] = await Promise.all([
      projectsRepo.getActive(),
      tasksRepo.getOpen(),
      tasksRepo.getOverdue(),
      escalationsRepo.getPending(),
    ]);

    const lines: string[] = [
      bold("Good morning, Bryson."),
      "",
      bold("Summary"),
      `Active projects: ${escapeMarkdownV2(String(projects.length))}`,
      `Open tasks: ${escapeMarkdownV2(String(openTasks.length))}`,
      `Overdue tasks: ${escapeMarkdownV2(String(overdueTasks.length))}`,
      `Pending escalations: ${escapeMarkdownV2(String(pending.length))}`,
    ];

    if (overdueTasks.length > 0) {
      lines.push("", bold("Overdue"));
      for (const t of overdueTasks.slice(0, 5)) {
        lines.push(
          `  \\- ${escapeMarkdownV2(t.title)} ${code(t.due_date ?? "no date")}`,
        );
      }
    }

    if (pending.length > 0) {
      lines.push("", bold("Needs your attention"));
      for (const e of pending.slice(0, 5)) {
        lines.push(`  \\- ${escapeMarkdownV2(e.summary)}`);
      }
    }

    if (openTasks.length > 0) {
      lines.push("", bold("Top tasks"));
      for (const t of openTasks.slice(0, 5)) {
        const prio = t.priority <= 2 ? "!!!" : t.priority <= 3 ? "!!" : "!";
        lines.push(
          `  ${escapeMarkdownV2(prio)} ${escapeMarkdownV2(t.title)}`,
        );
      }
    }

    await ctx.reply(lines.join("\n"), { parse_mode: "MarkdownV2" });
  } catch (err) {
    logger.error("Failed to generate briefing", { error: err });
    await ctx.reply("Failed to generate briefing. Check logs.");
  }
}

async function handleStatus(ctx: Context): Promise<void> {
  try {
    const [projects, tasks, pending] = await Promise.all([
      projectsRepo.getActive(),
      tasksRepo.getOpen(),
      escalationsRepo.getPending(),
    ]);

    const msg = [
      bold("System Status"),
      `Uptime: ${escapeMarkdownV2(formatUptime(process.uptime()))}`,
      `Active projects: ${escapeMarkdownV2(String(projects.length))}`,
      `Open tasks: ${escapeMarkdownV2(String(tasks.length))}`,
      `Pending escalations: ${escapeMarkdownV2(String(pending.length))}`,
    ].join("\n");

    await ctx.reply(msg, { parse_mode: "MarkdownV2" });
  } catch (err) {
    logger.error("Failed to get status", { error: err });
    await ctx.reply("Failed to get status.");
  }
}

async function handleTasks(ctx: Context): Promise<void> {
  try {
    const tasks = await tasksRepo.getOpen();

    if (tasks.length === 0) {
      await ctx.reply(escapeMarkdownV2("No open tasks. You're clear!"), {
        parse_mode: "MarkdownV2",
      });
      return;
    }

    const lines = [bold(`Open Tasks (${String(tasks.length)})`)];
    for (const t of tasks.slice(0, 15)) {
      const due = t.due_date ? ` due ${t.due_date}` : "";
      const prio = "P" + String(t.priority);
      lines.push(
        `${escapeMarkdownV2(prio)} ${escapeMarkdownV2(t.title)}${escapeMarkdownV2(due)}`,
      );
      lines.push(`   ${code(t.id.slice(0, 8))}`);
    }

    if (tasks.length > 15) {
      lines.push(
        escapeMarkdownV2(`... and ${tasks.length - 15} more`),
      );
    }

    await ctx.reply(lines.join("\n"), { parse_mode: "MarkdownV2" });
  } catch (err) {
    logger.error("Failed to list tasks", { error: err });
    await ctx.reply("Failed to list tasks.");
  }
}

async function handleIngest(ctx: Context): Promise<void> {
  await ctx.reply(
    escapeMarkdownV2(
      "Ingestion triggered. Send photos, documents, or text to ingest.",
    ),
    { parse_mode: "MarkdownV2" },
  );
}

async function handleEscalations(ctx: Context): Promise<void> {
  try {
    const pending = await escalationsRepo.getPending();

    if (pending.length === 0) {
      await ctx.reply(
        escapeMarkdownV2("No pending escalations. All clear!"),
        { parse_mode: "MarkdownV2" },
      );
      return;
    }

    for (const e of pending.slice(0, 5)) {
      await sendEscalation(ctx, e);
    }

    if (pending.length > 5) {
      await ctx.reply(
        escapeMarkdownV2(
          `... and ${pending.length - 5} more pending escalations.`,
        ),
        { parse_mode: "MarkdownV2" },
      );
    }
  } catch (err) {
    logger.error("Failed to list escalations", { error: err });
    await ctx.reply("Failed to list escalations.");
  }
}

async function handleDone(ctx: Context): Promise<void> {
  const text = "text" in ctx.message! ? (ctx.message as Message.TextMessage).text : "";
  const taskId = text.split(/\s+/)[1];

  if (!taskId) {
    await ctx.reply(
      escapeMarkdownV2("Usage: /done <task_id>"),
      { parse_mode: "MarkdownV2" },
    );
    return;
  }

  try {
    const task = await tasksRepo.markDone(taskId);
    if (!task) {
      await ctx.reply(escapeMarkdownV2("Task not found."), {
        parse_mode: "MarkdownV2",
      });
      return;
    }
    await ctx.reply(
      escapeMarkdownV2(`Done: ${task.title}`),
      { parse_mode: "MarkdownV2" },
    );
  } catch (err) {
    logger.error("Failed to mark task done", { error: err, taskId });
    await ctx.reply("Failed to mark task done.");
  }
}

async function handleSkip(ctx: Context): Promise<void> {
  const text = "text" in ctx.message! ? (ctx.message as Message.TextMessage).text : "";
  const escalationId = text.split(/\s+/)[1];

  if (!escalationId) {
    await ctx.reply(
      escapeMarkdownV2("Usage: /skip <escalation_id>"),
      { parse_mode: "MarkdownV2" },
    );
    return;
  }

  try {
    const result = await escalationsRepo.markDismissed(escalationId);
    if (!result) {
      await ctx.reply(escapeMarkdownV2("Escalation not found."), {
        parse_mode: "MarkdownV2",
      });
      return;
    }
    await ctx.reply(
      escapeMarkdownV2(`Skipped: ${result.summary}`),
      { parse_mode: "MarkdownV2" },
    );
  } catch (err) {
    logger.error("Failed to skip escalation", { error: err, escalationId });
    await ctx.reply("Failed to skip escalation.");
  }
}

async function handleApprove(ctx: Context): Promise<void> {
  const text = "text" in ctx.message! ? (ctx.message as Message.TextMessage).text : "";
  const escalationId = text.split(/\s+/)[1];

  if (!escalationId) {
    await ctx.reply(
      escapeMarkdownV2("Usage: /approve <escalation_id>"),
      { parse_mode: "MarkdownV2" },
    );
    return;
  }

  try {
    const result = await escalationsRepo.markActioned(escalationId);
    if (!result) {
      await ctx.reply(escapeMarkdownV2("Escalation not found."), {
        parse_mode: "MarkdownV2",
      });
      return;
    }
    await ctx.reply(
      escapeMarkdownV2(`Approved: ${result.summary}`),
      { parse_mode: "MarkdownV2" },
    );
  } catch (err) {
    logger.error("Failed to approve escalation", {
      error: err,
      escalationId,
    });
    await ctx.reply("Failed to approve escalation.");
  }
}

async function handleNote(ctx: Context): Promise<void> {
  const text = "text" in ctx.message! ? (ctx.message as Message.TextMessage).text : "";
  const noteText = text.replace(/^\/note\s*/, "").trim();

  if (!noteText) {
    await ctx.reply(
      escapeMarkdownV2("Usage: /note <your note text>"),
      { parse_mode: "MarkdownV2" },
    );
    return;
  }

  try {
    const note = await notesRepo.create({
      raw_text: noteText,
      source: "telegram:note",
    });
    await ctx.reply(
      escapeMarkdownV2(`Note saved (${note.id.slice(0, 8)})`),
      { parse_mode: "MarkdownV2" },
    );
  } catch (err) {
    logger.error("Failed to save note", { error: err });
    await ctx.reply("Failed to save note.");
  }
}

// ---------------------------------------------------------------------------
// Escalation messaging
// ---------------------------------------------------------------------------

interface EscalationData {
  id: string;
  summary: string;
  context?: string | null;
  type?: string | null;
}

export async function sendEscalation(
  ctx: Context | null,
  escalation: EscalationData,
): Promise<void> {
  const lines = [
    bold("Escalation"),
    "",
    escapeMarkdownV2(escalation.summary),
  ];

  if (escalation.context) {
    lines.push("", escapeMarkdownV2(escalation.context));
  }

  lines.push("", `ID: ${code(escalation.id.slice(0, 8))}`);

  const keyboard = {
    inline_keyboard: [
      [
        {
          text: "[A] Send draft",
          callback_data: `approve:${escalation.id}`,
        },
        { text: "[B] Edit", callback_data: `edit:${escalation.id}` },
      ],
      [
        {
          text: "[C] Handle myself",
          callback_data: `handle:${escalation.id}`,
        },
        { text: "[D] Dismiss", callback_data: `dismiss:${escalation.id}` },
      ],
    ],
  };

  if (ctx) {
    const sent = await ctx.reply(lines.join("\n"), {
      parse_mode: "MarkdownV2",
      reply_markup: keyboard,
    });
    // Store the Telegram message ID on the escalation for later reference
    await escalationsRepo.setTelegramMessageId(
      escalation.id,
      String(sent.message_id),
    );
  } else if (config.telegram.brysonChatId && bot) {
    const sent = await bot.telegram.sendMessage(
      config.telegram.brysonChatId,
      lines.join("\n"),
      {
        parse_mode: "MarkdownV2",
        reply_markup: keyboard,
      },
    );
    await escalationsRepo.setTelegramMessageId(
      escalation.id,
      String(sent.message_id),
    );
  }
}

/**
 * Send a briefing message directly to Bryson (for cron jobs).
 */
export async function sendBriefingDirect(): Promise<void> {
  if (!config.telegram.brysonChatId || !bot) {
    logger.warn("Cannot send briefing: bot or chat ID not configured");
    return;
  }

  try {
    const [projects, openTasks, overdueTasks, pending] = await Promise.all([
      projectsRepo.getActive(),
      tasksRepo.getOpen(),
      tasksRepo.getOverdue(),
      escalationsRepo.getPending(),
    ]);

    const lines: string[] = [
      bold("Good morning, Bryson."),
      "",
      bold("Summary"),
      `Active projects: ${escapeMarkdownV2(String(projects.length))}`,
      `Open tasks: ${escapeMarkdownV2(String(openTasks.length))}`,
      `Overdue tasks: ${escapeMarkdownV2(String(overdueTasks.length))}`,
      `Pending escalations: ${escapeMarkdownV2(String(pending.length))}`,
    ];

    if (overdueTasks.length > 0) {
      lines.push("", bold("Overdue"));
      for (const t of overdueTasks.slice(0, 5)) {
        lines.push(
          `  \\- ${escapeMarkdownV2(t.title)} ${code(t.due_date ?? "no date")}`,
        );
      }
    }

    if (pending.length > 0) {
      lines.push("", bold("Needs your attention"));
      for (const e of pending.slice(0, 5)) {
        lines.push(`  \\- ${escapeMarkdownV2(e.summary)}`);
      }
    }

    if (openTasks.length > 0) {
      lines.push("", bold("Top tasks"));
      for (const t of openTasks.slice(0, 5)) {
        const prio = t.priority <= 2 ? "!!!" : t.priority <= 3 ? "!!" : "!";
        lines.push(
          `  ${escapeMarkdownV2(prio)} ${escapeMarkdownV2(t.title)}`,
        );
      }
    }

    await bot.telegram.sendMessage(
      config.telegram.brysonChatId,
      lines.join("\n"),
      { parse_mode: "MarkdownV2" },
    );

    logger.info("Morning briefing sent");
  } catch (err) {
    logger.error("Failed to send morning briefing", { error: err });
  }
}

// ---------------------------------------------------------------------------
// Webhook mode setup
// ---------------------------------------------------------------------------

/**
 * Set up the bot in webhook mode. Returns the webhook callback middleware
 * to mount on the Express app.
 */
export function setupWebhook(webhookUrl: string) {
  const b = getBot();

  const secretToken = config.telegram.webhookSecret || undefined;

  // Set the webhook with Telegram
  void b.telegram.setWebhook(webhookUrl, {
    secret_token: secretToken,
  }).then(() => {
    logger.info("Telegram webhook set", { url: webhookUrl });
  }).catch((err: unknown) => {
    logger.error("Failed to set Telegram webhook", { error: err });
  });

  // Return the express middleware
  return b.webhookCallback("/webhooks/telegram", {
    secretToken,
  });
}

/**
 * Launch bot in polling mode (for development).
 */
export async function launchPolling(): Promise<void> {
  const b = getBot();
  await b.telegram.deleteWebhook();
  await b.launch();
  logger.info("Telegram bot launched in polling mode");
}

/**
 * Stop the bot gracefully.
 */
export function stopBot(): void {
  if (bot) {
    bot.stop("Graceful shutdown");
    logger.info("Telegram bot stopped");
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatUptime(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  return `${h}h ${m}m ${s}s`;
}

// Re-export for use by escalation service, etc.
export { getBot as getBotInstance };
