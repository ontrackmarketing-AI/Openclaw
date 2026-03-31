// ---------------------------------------------------------------------------
// Shared type re-exports
// ---------------------------------------------------------------------------
// Canonical locations live in the modules that own them. This barrel makes it
// convenient to import the most-used types from a single path:
//
//   import type { AgentEvent, AgentResult, CalendarEvent } from "../types/index.js";
// ---------------------------------------------------------------------------

export type {
  AgentEvent,
  AgentEventType,
  AgentResult,
  AgentResultStatus,
} from "../agents/base.js";

export type { CalendarEvent } from "../agents/scheduler/index.js";

export type {
  BriefingData,
  ProjectStatusData,
} from "../agents/reporting/index.js";

// ---------------------------------------------------------------------------
// InboxMessage — not owned by any single module yet, so defined here.
// ---------------------------------------------------------------------------

export interface InboxMessage {
  id: string;
  channel: "gmail" | "imessage" | "telegram";
  sender: string;
  subject?: string;
  body: string;
  timestamp: Date;
  isVip: boolean;
}
