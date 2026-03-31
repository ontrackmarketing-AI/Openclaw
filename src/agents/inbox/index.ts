import { BaseAgent, AgentEvent, AgentResult } from "../base.js";
import { logger } from "../../config/logger.js";
import { GmailSubAgent } from "./gmail.js";
import { IMessageSubAgent } from "./imessage.js";
import { TelegramSubAgent } from "./telegram.js";
import type { BriefingData } from "./telegram.js";
import * as escalationsRepo from "../../db/repositories/escalations.js";

// ---------------------------------------------------------------------------
// Re-exports for convenience
// ---------------------------------------------------------------------------

export { GmailSubAgent } from "./gmail.js";
export { IMessageSubAgent } from "./imessage.js";
export { TelegramSubAgent } from "./telegram.js";
export type { BriefingData } from "./telegram.js";

// ---------------------------------------------------------------------------
// Inbox Agent — coordinates Gmail, iMessage, and Telegram sub-agents
// ---------------------------------------------------------------------------

export class InboxAgent extends BaseAgent {
  readonly gmail: GmailSubAgent;
  readonly imessage: IMessageSubAgent;
  readonly telegram: TelegramSubAgent;

  constructor() {
    super("inbox");
    this.gmail = new GmailSubAgent();
    this.imessage = new IMessageSubAgent();
    this.telegram = new TelegramSubAgent();
  }

  // -----------------------------------------------------------------------
  // Main dispatch
  // -----------------------------------------------------------------------

  async process(event: AgentEvent): Promise<AgentResult> {
    switch (event.type) {
      case "gmail_thread":
        return this.handleGmail(event);
      case "imessage_message":
        return this.handleIMessage(event);
      case "telegram_command":
        return this.handleTelegramCommand(event);
      case "telegram_callback":
        return this.handleTelegramCallback(event);
      default:
        return {
          status: "error",
          agent: this.name,
          message: `Inbox agent cannot handle event type: ${event.type}`,
        };
    }
  }

  // -----------------------------------------------------------------------
  // Gmail handler
  // -----------------------------------------------------------------------

  private async handleGmail(event: AgentEvent): Promise<AgentResult> {
    try {
      await this.log("gmail_processing_start");

      // If a specific thread is passed, process just that thread
      const threadData = event.data["thread"] as Record<string, unknown> | undefined;
      if (threadData) {
        // Single thread processing (from webhook)
        const thread = threadData as unknown as import("./gmail.js").GmailThread;
        const result = await this.gmail.processThread(thread);

        // If urgent or action_needed, send escalation via Telegram
        if (result.intent === "urgent" || result.intent === "action_needed") {
          const escalation = await escalationsRepo.create({
            type: "gmail",
            summary: `${result.intent === "urgent" ? "🔴 URGENT" : "📧"} ${result.thread.subject} (from ${result.thread.sender})`,
            context: result.summary,
            options: {
              threadId: result.thread.id,
              actions: ["reply", "snooze", "dismiss"],
            },
          });
          await this.telegram.sendEscalation(escalation);
        }

        // If reply is needed, draft one
        let draftReply: string | undefined;
        if (result.intent === "reply_needed") {
          draftReply = await this.gmail.draftReply(result.thread);
        }

        await this.log("gmail_thread_processed", event.projectId, {
          threadId: result.thread.id,
          intent: result.intent,
          actionItems: result.actionItems.length,
        });

        return {
          status: result.intent === "fyi" ? "success" : "partial",
          agent: this.name,
          message: `Gmail: ${result.thread.subject} — ${result.intent}`,
          data: {
            intent: result.intent,
            summary: result.summary,
            actionItems: result.actionItems,
            draftReply,
          },
        };
      }

      // Batch processing: fetch all new threads
      const threads = await this.gmail.fetchNewThreads();
      if (threads.length === 0) {
        await this.log("gmail_no_new_threads");
        return {
          status: "success",
          agent: this.name,
          message: "No new Gmail threads.",
        };
      }

      const results = [];
      for (const thread of threads) {
        try {
          const result = await this.gmail.processThread(thread);
          results.push(result);

          if (
            result.intent === "urgent" ||
            result.intent === "action_needed"
          ) {
            const escalation = await escalationsRepo.create({
              type: "gmail",
              summary: `${result.intent === "urgent" ? "🔴 URGENT" : "📧"} ${thread.subject} (from ${thread.sender})`,
              context: result.summary,
            });
            await this.telegram.sendEscalation(escalation);
          }
        } catch (err) {
          logger.error("Failed to process Gmail thread", {
            threadId: thread.id,
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }

      const urgentCount = results.filter(
        (r) => r.intent === "urgent" || r.intent === "action_needed",
      ).length;

      await this.log("gmail_batch_complete", undefined, {
        threadCount: threads.length,
        urgentCount,
      });

      return {
        status: urgentCount > 0 ? "partial" : "success",
        agent: this.name,
        message: `Processed ${threads.length} Gmail threads (${urgentCount} need attention)`,
        data: {
          threadCount: threads.length,
          urgentCount,
        },
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error("Gmail handler error", { error: message });
      return { status: "error", agent: this.name, message };
    }
  }

  // -----------------------------------------------------------------------
  // iMessage handler
  // -----------------------------------------------------------------------

  private async handleIMessage(event: AgentEvent): Promise<AgentResult> {
    try {
      const contactHandle = event.data["contact"] as string | undefined;
      if (!contactHandle) {
        return {
          status: "error",
          agent: this.name,
          message: "iMessage event requires a contact handle",
        };
      }

      await this.log("imessage_processing", undefined, { contact: contactHandle });

      const result = await this.imessage.processContact(contactHandle);

      if (result.intent === "urgent" || result.intent === "action_needed") {
        const escalation = await escalationsRepo.create({
          type: "imessage",
          summary: `💬 iMessage from ${contactHandle}: ${result.summary.slice(0, 100)}`,
          context: result.summary,
        });
        await this.telegram.sendEscalation(escalation);
      }

      await this.log("imessage_processed", undefined, {
        contact: contactHandle,
        intent: result.intent,
      });

      return {
        status: result.intent === "fyi" ? "success" : "partial",
        agent: this.name,
        message: `iMessage from ${contactHandle}: ${result.intent}`,
        data: {
          summary: result.summary,
          actionItems: result.actionItems,
          intent: result.intent,
        },
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error("iMessage handler error", { error: message });
      return { status: "error", agent: this.name, message };
    }
  }

  // -----------------------------------------------------------------------
  // Telegram command handler
  // -----------------------------------------------------------------------

  private async handleTelegramCommand(event: AgentEvent): Promise<AgentResult> {
    try {
      const command = event.data["command"] as string;
      const args = (event.data["args"] as string) ?? "";
      const chatId = event.data["chatId"] as string;

      if (!command || !chatId) {
        return {
          status: "error",
          agent: this.name,
          message: "Telegram command requires command and chatId",
        };
      }

      const response = await this.telegram.handleCommand(
        command,
        args,
        chatId,
      );

      // Send the response back to Telegram
      await this.telegram.sendMessage(response);

      return {
        status: "success",
        agent: this.name,
        message: `Telegram /${command} processed`,
        data: { response },
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error("Telegram command handler error", { error: message });
      return { status: "error", agent: this.name, message };
    }
  }

  // -----------------------------------------------------------------------
  // Telegram callback handler
  // -----------------------------------------------------------------------

  private async handleTelegramCallback(event: AgentEvent): Promise<AgentResult> {
    try {
      const data = event.data["callbackData"] as string;
      if (!data) {
        return {
          status: "error",
          agent: this.name,
          message: "Callback event requires callbackData",
        };
      }

      const response = await this.telegram.handleCallbackQuery(data);

      return {
        status: "success",
        agent: this.name,
        message: response,
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error("Telegram callback handler error", { error: message });
      return { status: "error", agent: this.name, message };
    }
  }

  // -----------------------------------------------------------------------
  // Convenience: send briefing via Telegram
  // -----------------------------------------------------------------------

  async sendBriefing(data: BriefingData): Promise<void> {
    await this.telegram.sendBriefing(data);
  }
}
