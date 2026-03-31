import { google } from "googleapis";
import Anthropic from "@anthropic-ai/sdk";
import { config } from "../../config/index.js";
import { logger } from "../../config/logger.js";
import * as agentLogs from "../../db/repositories/agent-logs.js";
import * as contactsRepo from "../../db/repositories/contacts.js";
import * as inboxEventsRepo from "../../db/repositories/inbox-events.js";
import * as tasksRepo from "../../db/repositories/tasks.js";
import { redis } from "../../db/redis.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface GmailThread {
  id: string;
  subject: string;
  sender: string;
  senderEmail: string;
  snippet: string;
  messages: GmailMessage[];
  receivedAt: string;
}

interface GmailMessage {
  id: string;
  from: string;
  to: string;
  date: string;
  body: string;
}

interface ClassifiedThread {
  thread: GmailThread;
  summary: string;
  intent: "fyi" | "reply_needed" | "action_needed" | "urgent";
  contact: contactsRepo.Contact | null;
  actionItems: string[];
}

// ---------------------------------------------------------------------------
// Gmail Sub-Agent
// ---------------------------------------------------------------------------

export class GmailSubAgent {
  private anthropic: Anthropic;
  private gmail;

  constructor(authClient?: InstanceType<typeof google.auth.OAuth2>) {
    this.anthropic = new Anthropic({ apiKey: config.anthropic.apiKey });

    // If an OAuth2 client is passed in, use it. Otherwise create a stub
    // for testing / offline development.
    if (authClient) {
      this.gmail = google.gmail({ version: "v1", auth: authClient });
    }
  }

  // -----------------------------------------------------------------------
  // Fetch
  // -----------------------------------------------------------------------

  /**
   * Fetch unread Gmail threads since last check.
   * Uses Redis to track the last processed timestamp.
   */
  async fetchNewThreads(): Promise<GmailThread[]> {
    if (!this.gmail) {
      logger.warn("Gmail client not initialised — skipping fetch");
      return [];
    }

    // Rate-limit: max 100 requests per day
    const today = new Date().toISOString().slice(0, 10);
    const rateLimitKey = `ratelimit:gmail:${today}`;
    const currentCount = parseInt((await redis.get(rateLimitKey)) ?? "0", 10);
    if (currentCount >= 100) {
      logger.warn("Gmail rate limit reached for today");
      return [];
    }

    await redis.incr(rateLimitKey);
    await redis.expire(rateLimitKey, 86400);

    try {
      const response = await this.gmail.users.threads.list({
        userId: "me",
        q: "is:unread",
        maxResults: 20,
      });

      const threads: GmailThread[] = [];
      for (const threadRef of response.data.threads ?? []) {
        if (!threadRef.id) continue;

        // Deduplicate
        const isDup = await inboxEventsRepo.isDuplicate(
          "gmail",
          threadRef.id,
        );
        if (isDup) continue;

        const threadDetail = await this.gmail.users.threads.get({
          userId: "me",
          id: threadRef.id,
          format: "full",
        });

        const messages: GmailMessage[] = [];
        let subject = "";
        let sender = "";
        let senderEmail = "";
        let receivedAt = "";

        for (const msg of threadDetail.data.messages ?? []) {
          const headers = msg.payload?.headers ?? [];
          const fromHeader =
            headers.find((h) => h.name?.toLowerCase() === "from")?.value ?? "";
          const toHeader =
            headers.find((h) => h.name?.toLowerCase() === "to")?.value ?? "";
          const subjectHeader =
            headers.find((h) => h.name?.toLowerCase() === "subject")?.value ??
            "";
          const dateHeader =
            headers.find((h) => h.name?.toLowerCase() === "date")?.value ?? "";

          if (!subject) subject = subjectHeader;
          if (!sender) {
            sender = fromHeader;
            // Extract email from "Name <email>" format
            const emailMatch = fromHeader.match(/<(.+?)>/);
            senderEmail = emailMatch ? emailMatch[1]! : fromHeader;
          }
          if (!receivedAt) receivedAt = dateHeader;

          // Extract body text
          let body = "";
          if (msg.payload?.body?.data) {
            body = Buffer.from(msg.payload.body.data, "base64url").toString(
              "utf-8",
            );
          } else if (msg.payload?.parts) {
            const textPart = msg.payload.parts.find(
              (p) => p.mimeType === "text/plain",
            );
            if (textPart?.body?.data) {
              body = Buffer.from(textPart.body.data, "base64url").toString(
                "utf-8",
              );
            }
          }

          messages.push({
            id: msg.id ?? "",
            from: fromHeader,
            to: toHeader,
            date: dateHeader,
            body: body.slice(0, 5000), // Cap body to avoid token explosion
          });
        }

        threads.push({
          id: threadRef.id,
          subject,
          sender,
          senderEmail,
          snippet: threadDetail.data.messages?.[0]?.snippet ?? "",
          messages,
          receivedAt,
        });
      }

      await agentLogs.log({
        agent: "inbox.gmail",
        event: "fetch_new_threads",
        metadata: { threadCount: threads.length },
      });

      return threads;
    } catch (err) {
      logger.error("Gmail fetch failed", {
        error: err instanceof Error ? err.message : String(err),
      });
      return [];
    }
  }

  // -----------------------------------------------------------------------
  // Summarise
  // -----------------------------------------------------------------------

  /**
   * Summarise a Gmail thread into a concise digest using Claude.
   */
  async summarizeThread(thread: GmailThread): Promise<string> {
    const messagesText = thread.messages
      .map((m) => `From: ${m.from}\nDate: ${m.date}\n${m.body}`)
      .join("\n---\n");

    const response = await this.anthropic.messages.create({
      model: "claude-sonnet-4-20250514",
      max_tokens: 1024,
      temperature: 0.2,
      system: `You are an email summarisation assistant for Bryson Stevens, a solo operator running Helium Solutions (AI marketing automation), Search Tuners (referral marketing with Mike), and OnTrack Marketing (SaaS).

Summarise the email thread concisely. Include:
1. Who sent it and what they want
2. Any deadlines or time-sensitive items
3. Whether it relates to a known project (TTT, SWRE, HS, OTM, ST, GHL)
4. What action, if any, is needed from Bryson

Keep it under 150 words.`,
      messages: [
        {
          role: "user",
          content: `Subject: ${thread.subject}\nFrom: ${thread.sender}\n\n${messagesText}`,
        },
      ],
    });

    const block = response.content.find((b) => b.type === "text");
    return block && block.type === "text" ? block.text : "Unable to summarise thread.";
  }

  // -----------------------------------------------------------------------
  // Classify
  // -----------------------------------------------------------------------

  /**
   * Classify the intent of a summarised email thread.
   */
  async classifyIntent(
    summary: string,
    senderEmail: string,
  ): Promise<"fyi" | "reply_needed" | "action_needed" | "urgent"> {
    // Check if the sender is a VIP — always urgent
    const contact = await contactsRepo.findByAnyHandle(senderEmail);
    if (contact?.is_vip) return "urgent";

    const response = await this.anthropic.messages.create({
      model: "claude-sonnet-4-20250514",
      max_tokens: 50,
      temperature: 0,
      system: `You classify email intent for Bryson Stevens. Based on the summary, respond with exactly one of these labels:

- fyi — informational, no action needed
- reply_needed — someone is waiting for a reply from Bryson
- action_needed — there's a concrete task Bryson must do (not just reply)
- urgent — time-sensitive and important, needs immediate attention

Respond with ONLY the label, nothing else.`,
      messages: [{ role: "user", content: summary }],
    });

    const block = response.content.find((b) => b.type === "text");
    const label = block && block.type === "text" ? block.text.trim().toLowerCase() : "fyi";
    const valid = ["fyi", "reply_needed", "action_needed", "urgent"] as const;
    return valid.includes(label as (typeof valid)[number])
      ? (label as (typeof valid)[number])
      : "fyi";
  }

  // -----------------------------------------------------------------------
  // Draft reply
  // -----------------------------------------------------------------------

  /**
   * Compose a reply draft using Claude, given thread context.
   */
  async draftReply(
    thread: GmailThread,
    context: string = "",
  ): Promise<string> {
    const lastMessage = thread.messages[thread.messages.length - 1];
    const body = lastMessage?.body ?? thread.snippet;

    const response = await this.anthropic.messages.create({
      model: "claude-sonnet-4-20250514",
      max_tokens: 1024,
      temperature: 0.4,
      system: `You are drafting email replies on behalf of Bryson Stevens, founder of Helium Solutions.

Bryson's tone: professional but approachable, concise, action-oriented. He signs off informally ("Best, Bryson" or "Thanks, Bryson").

Guidelines:
- Keep replies under 150 words unless the topic demands more.
- Be specific and actionable — don't be vague.
- If context about the project is provided, reference it naturally.
- Never make commitments or promises Bryson hasn't approved.
- If you are unsure what to say, write a draft and flag what needs Bryson's input with [NEEDS INPUT: ...].

${context ? `Additional context:\n${context}` : ""}`,
      messages: [
        {
          role: "user",
          content: `Draft a reply to this email:\n\nSubject: ${thread.subject}\nFrom: ${thread.sender}\n\n${body}`,
        },
      ],
    });

    const block = response.content.find((b) => b.type === "text");
    return block && block.type === "text" ? block.text : "Unable to draft reply.";
  }

  // -----------------------------------------------------------------------
  // Action extraction
  // -----------------------------------------------------------------------

  /**
   * Extract action items from an email thread and create tasks.
   */
  async extractActionItems(
    thread: GmailThread,
    projectId?: string,
  ): Promise<tasksRepo.Task[]> {
    const messagesText = thread.messages
      .map((m) => `From: ${m.from}\n${m.body}`)
      .join("\n---\n");

    const response = await this.anthropic.messages.create({
      model: "claude-sonnet-4-20250514",
      max_tokens: 1024,
      temperature: 0.1,
      system: `Extract action items from this email thread that Bryson Stevens needs to do. Return a JSON array of objects with "title" (string) and "priority" (1-5, where 1 is highest).

If there are no action items, return an empty array [].
Respond with ONLY valid JSON, no markdown fences or explanation.`,
      messages: [
        {
          role: "user",
          content: `Subject: ${thread.subject}\n\n${messagesText}`,
        },
      ],
    });

    const block = response.content.find((b) => b.type === "text");
    const raw = block && block.type === "text" ? block.text : "[]";

    try {
      const cleaned = raw.replace(/^```(?:json)?\n?/m, "").replace(/\n?```$/m, "");
      const items = JSON.parse(cleaned) as {
        title: string;
        priority: number;
      }[];
      const created: tasksRepo.Task[] = [];
      for (const item of items) {
        const task = await tasksRepo.create({
          project_id: projectId,
          source: "gmail",
          source_ref: thread.id,
          title: item.title,
          priority: item.priority,
        });
        created.push(task);
      }
      return created;
    } catch (err) {
      logger.error("Failed to parse action items from email", {
        error: err instanceof Error ? err.message : String(err),
      });
      return [];
    }
  }

  // -----------------------------------------------------------------------
  // Full processing pipeline
  // -----------------------------------------------------------------------

  /**
   * Process a single Gmail thread: summarise, classify, extract actions, store.
   */
  async processThread(thread: GmailThread): Promise<ClassifiedThread> {
    const summary = await this.summarizeThread(thread);
    const intent = await this.classifyIntent(summary, thread.senderEmail);
    const contact = await contactsRepo.findByAnyHandle(thread.senderEmail);

    const actionItems: string[] = [];
    if (intent === "action_needed" || intent === "urgent") {
      const tasks = await this.extractActionItems(thread);
      for (const t of tasks) actionItems.push(t.title);
    }

    // Store the inbox event
    await inboxEventsRepo.create({
      channel: "gmail",
      external_id: thread.id,
      sender: thread.sender,
      contact_id: contact?.id,
      subject: thread.subject,
      body_summary: summary,
      intent,
      agent_action:
        intent === "fyi" ? "logged" : intent === "reply_needed" ? "draft_queued" : "escalated",
      escalated: intent === "urgent" || intent === "action_needed",
    });

    return { thread, summary, intent, contact, actionItems };
  }
}
