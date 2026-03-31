import Anthropic from "@anthropic-ai/sdk";
import { config } from "../../config/index.js";
import { logger } from "../../config/logger.js";
import * as agentLogs from "../../db/repositories/agent-logs.js";
import * as contactsRepo from "../../db/repositories/contacts.js";
import * as inboxEventsRepo from "../../db/repositories/inbox-events.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface IMessage {
  id: string;
  sender: string;
  text: string;
  date: string;
  isFromMe: boolean;
  attachments?: string[];
}

interface ConversationResult {
  summary: string;
  actionItems: string[];
  intent: "fyi" | "reply_needed" | "action_needed" | "urgent";
}

// ---------------------------------------------------------------------------
// Configuration — the Mac bridge runs on a separate machine
// ---------------------------------------------------------------------------

const BRIDGE_BASE_URL =
  process.env["IMESSAGE_BRIDGE_URL"] ?? "http://localhost:3001";

// ---------------------------------------------------------------------------
// iMessage Sub-Agent
// ---------------------------------------------------------------------------

export class IMessageSubAgent {
  private anthropic: Anthropic;

  constructor() {
    this.anthropic = new Anthropic({ apiKey: config.anthropic.apiKey });
  }

  // -----------------------------------------------------------------------
  // Fetch messages from the Mac bridge
  // -----------------------------------------------------------------------

  /**
   * GET /messages/:contact?limit=N from the Mac bridge REST API.
   */
  async fetchMessages(
    contact: string,
    limit: number = 20,
  ): Promise<IMessage[]> {
    try {
      const url = `${BRIDGE_BASE_URL}/messages/${encodeURIComponent(contact)}?limit=${limit}`;
      const response = await fetch(url, {
        method: "GET",
        headers: { "Content-Type": "application/json" },
        signal: AbortSignal.timeout(10_000),
      });

      if (!response.ok) {
        logger.error("iMessage bridge fetch failed", {
          status: response.status,
          contact,
        });
        return [];
      }

      const data = (await response.json()) as { messages: IMessage[] };

      await agentLogs.log({
        agent: "inbox.imessage",
        event: "fetch_messages",
        metadata: { contact, count: data.messages.length },
      });

      return data.messages;
    } catch (err) {
      logger.error("iMessage bridge unreachable", {
        error: err instanceof Error ? err.message : String(err),
        contact,
      });
      return [];
    }
  }

  // -----------------------------------------------------------------------
  // Send message via the Mac bridge (approval-gated)
  // -----------------------------------------------------------------------

  /**
   * POST /messages to the Mac bridge.
   * This is approval-gated: the caller must have already received approval
   * from Bryson before calling this method.
   */
  async sendMessage(
    contact: string,
    text: string,
  ): Promise<{ success: boolean; error?: string }> {
    try {
      const url = `${BRIDGE_BASE_URL}/messages`;
      const response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ contact, text }),
        signal: AbortSignal.timeout(10_000),
      });

      if (!response.ok) {
        const body = await response.text();
        logger.error("iMessage send failed", {
          status: response.status,
          body,
        });
        return { success: false, error: `HTTP ${response.status}: ${body}` };
      }

      await agentLogs.log({
        agent: "inbox.imessage",
        event: "send_message",
        metadata: { contact, textLength: text.length },
      });

      return { success: true };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error("iMessage send error", { error: message });
      return { success: false, error: message };
    }
  }

  // -----------------------------------------------------------------------
  // Process a conversation
  // -----------------------------------------------------------------------

  /**
   * Summarise a conversation and extract action items using Claude.
   */
  async processConversation(
    messages: IMessage[],
    contactName?: string,
  ): Promise<ConversationResult> {
    if (messages.length === 0) {
      return { summary: "No messages.", actionItems: [], intent: "fyi" };
    }

    const convoText = messages
      .map(
        (m) =>
          `[${m.date}] ${m.isFromMe ? "Bryson" : m.sender}: ${m.text}`,
      )
      .join("\n");

    const response = await this.anthropic.messages.create({
      model: "claude-sonnet-4-20250514",
      max_tokens: 1024,
      temperature: 0.2,
      system: `You are analysing an iMessage conversation for Bryson Stevens. Bryson runs Helium Solutions (AI marketing agency), Search Tuners (with Mike), and OnTrack Marketing (SaaS).

Provide:
1. A concise summary (under 100 words)
2. Any action items for Bryson (as a JSON array of strings)
3. Intent classification: fyi / reply_needed / action_needed / urgent

VIP contacts who should always be marked urgent: Mike, Daniel, Steven, Hunter.

Respond in this exact JSON format (no markdown fences):
{
  "summary": "...",
  "action_items": ["..."],
  "intent": "fyi|reply_needed|action_needed|urgent"
}`,
      messages: [
        {
          role: "user",
          content: `Conversation with ${contactName ?? "unknown contact"}:\n\n${convoText}`,
        },
      ],
    });

    const block = response.content.find((b) => b.type === "text");
    const raw = block && block.type === "text" ? block.text : "{}";

    try {
      const cleaned = raw
        .replace(/^```(?:json)?\n?/m, "")
        .replace(/\n?```$/m, "");
      const parsed = JSON.parse(cleaned) as {
        summary: string;
        action_items: string[];
        intent: string;
      };

      const validIntents = [
        "fyi",
        "reply_needed",
        "action_needed",
        "urgent",
      ] as const;
      const intent = validIntents.includes(
        parsed.intent as (typeof validIntents)[number],
      )
        ? (parsed.intent as (typeof validIntents)[number])
        : "fyi";

      return {
        summary: parsed.summary,
        actionItems: parsed.action_items ?? [],
        intent,
      };
    } catch (err) {
      logger.error("Failed to parse iMessage conversation analysis", {
        error: err instanceof Error ? err.message : String(err),
      });
      return {
        summary: "Could not analyse conversation.",
        actionItems: [],
        intent: "fyi",
      };
    }
  }

  // -----------------------------------------------------------------------
  // Full pipeline for a contact
  // -----------------------------------------------------------------------

  /**
   * Fetch recent messages for a contact, analyse the conversation, and store
   * the inbox event.
   */
  async processContact(contactHandle: string): Promise<ConversationResult> {
    const messages = await this.fetchMessages(contactHandle);
    if (messages.length === 0) {
      return { summary: "No new messages.", actionItems: [], intent: "fyi" };
    }

    const contact = await contactsRepo.findByAnyHandle(contactHandle);
    const result = await this.processConversation(
      messages,
      contact?.name ?? contactHandle,
    );

    // Check VIP status
    if (contact?.is_vip && result.intent !== "urgent") {
      result.intent = "urgent";
    }

    await inboxEventsRepo.create({
      channel: "imessage",
      external_id: messages[0]?.id,
      sender: contactHandle,
      contact_id: contact?.id,
      subject: `iMessage: ${contact?.name ?? contactHandle}`,
      body_summary: result.summary,
      intent: result.intent,
      agent_action: result.intent === "fyi" ? "logged" : "escalated",
      escalated: result.intent !== "fyi",
    });

    return result;
  }
}
