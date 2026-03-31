import Anthropic from "@anthropic-ai/sdk";
import { config } from "../config/index.js";
import { logger } from "../config/logger.js";
import * as agentLogs from "../db/repositories/agent-logs.js";

// ---------------------------------------------------------------------------
// Shared types
// ---------------------------------------------------------------------------

export type AgentEventType =
  | "notebook_image"
  | "gmail_thread"
  | "imessage_message"
  | "telegram_command"
  | "telegram_callback"
  | "scheduled_cycle"
  | "research_request"
  | "calendar_check"
  | "briefing_request"
  | "project_status_request"
  | "escalation_response";

export interface AgentEvent {
  type: AgentEventType;
  /** Opaque payload — each agent defines what it expects. */
  data: Record<string, unknown>;
  /** Optional project scope. */
  projectId?: string;
  /** Originating channel or user identifier. */
  source?: string;
  /** ISO timestamp of when the event was created. */
  timestamp?: string;
}

export type AgentResultStatus = "success" | "partial" | "error" | "escalate";

export interface AgentResult {
  status: AgentResultStatus;
  agent: string;
  /** Human-readable summary of what happened. */
  message: string;
  /** Structured data the orchestrator can use for follow-up. */
  data?: Record<string, unknown>;
  /** If status is "escalate", who should act on it. */
  escalation?: {
    summary: string;
    context?: string;
    options?: Record<string, unknown>;
    projectId?: string;
    taskId?: string;
    inboxEventId?: string;
  };
}

// ---------------------------------------------------------------------------
// Base class
// ---------------------------------------------------------------------------

export abstract class BaseAgent {
  protected name: string;
  protected anthropic: Anthropic;
  protected log_: ReturnType<typeof logger.child>;

  constructor(name: string) {
    this.name = name;
    this.anthropic = new Anthropic({ apiKey: config.anthropic.apiKey });
    this.log_ = logger.child({ agent: name });
  }

  /**
   * Persist an agent action to the agent_logs table and emit a structured log.
   */
  protected async log(
    event: string,
    projectId?: string,
    metadata?: Record<string, unknown>,
  ): Promise<void> {
    try {
      await agentLogs.log({
        agent: this.name,
        event,
        project_id: projectId,
        metadata,
      });
      this.log_.info(event, { projectId, ...metadata });
    } catch (err) {
      // Logging failures must never crash the agent.
      this.log_.error("Failed to write agent log", {
        event,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  /**
   * Call Claude with a system + user prompt and return the text content.
   * Shared helper so all agents have consistent error handling / retries.
   */
  protected async callClaude(
    system: string,
    userMessage: string,
    options?: { model?: string; maxTokens?: number; temperature?: number },
  ): Promise<string> {
    const model = options?.model ?? "claude-sonnet-4-20250514";
    const maxTokens = options?.maxTokens ?? 4096;

    const response = await this.anthropic.messages.create({
      model,
      max_tokens: maxTokens,
      temperature: options?.temperature ?? 0.3,
      system,
      messages: [{ role: "user", content: userMessage }],
    });

    const textBlock = response.content.find((b) => b.type === "text");
    if (!textBlock || textBlock.type !== "text") {
      throw new Error("Claude returned no text content");
    }
    return textBlock.text;
  }

  /**
   * Call Claude Vision with an image buffer + text prompt.
   */
  protected async callClaudeVision(
    system: string,
    prompt: string,
    imageBase64: string,
    mediaType: "image/jpeg" | "image/png" | "image/webp" | "image/gif" = "image/jpeg",
    options?: { model?: string; maxTokens?: number },
  ): Promise<string> {
    const model = options?.model ?? "claude-sonnet-4-20250514";
    const maxTokens = options?.maxTokens ?? 4096;

    const response = await this.anthropic.messages.create({
      model,
      max_tokens: maxTokens,
      system,
      messages: [
        {
          role: "user",
          content: [
            {
              type: "image",
              source: { type: "base64", media_type: mediaType, data: imageBase64 },
            },
            { type: "text", text: prompt },
          ],
        },
      ],
    });

    const textBlock = response.content.find((b) => b.type === "text");
    if (!textBlock || textBlock.type !== "text") {
      throw new Error("Claude Vision returned no text content");
    }
    return textBlock.text;
  }

  /**
   * Every agent must implement this entry point.
   * The orchestrator calls it to dispatch work.
   */
  abstract process(event: AgentEvent): Promise<AgentResult>;
}
