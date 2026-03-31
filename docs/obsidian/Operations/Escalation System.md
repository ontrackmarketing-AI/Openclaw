---
title: Escalation System
aliases: [Escalations, Escalation Tiers, Interrupt System]
tags: [operations, escalation, notification, telegram, tiers]
created: 2026-03-31
---

# Escalation System

The escalation system determines when and how to interrupt Bryson. It is the enforcement mechanism for OpenClaw's core principle: **"Only ping Bryson when Bryson is required."**

Every escalation flows through the [[Orchestrator]], is stored in [[PostgreSQL]] `escalations` table, queued in [[Redis]] `queue:escalations`, and delivered via [[Telegram Bot]] with inline keyboard options.

## Five Escalation Tiers

### Tier 1: Silent

**Description:** Agent handled it. No notification to Bryson.
**When:** Routine operations the agent can complete autonomously.
**Examples:**
- FYI emails logged without response needed
- Recurring calendar event synced
- Research query completed and stored
- Known-pattern task extracted from notebook

**Delivery:** None. Appears only in agent logs and daily briefing stats.

### Tier 2: Batched

**Description:** Noteworthy but not urgent. Included in the next daily briefing.
**When:** Informational items that Bryson should know about but do not require action.
**Examples:**
- Non-VIP email thread summary
- Task completed by agent
- New contact created from unknown sender
- Back-to-back meeting warning for tomorrow

**Delivery:** Aggregated into the daily briefing by the [[Reporting Agent]]. No standalone notification.

### Tier 3: Next Briefing Priority

**Description:** Important enough to appear at the top of the next briefing.
**When:** Items that need attention within 24 hours but are not time-sensitive to the minute.
**Examples:**
- Draft email awaiting approval (non-VIP sender)
- Ambiguous notebook items needing project assignment
- GHL pipeline stage changes
- Non-urgent task overdue by less than 48 hours

**Delivery:** Included in the next daily briefing with elevated priority score. If the briefing is more than 12 hours away, may be promoted to Tier 4.

### Tier 4: Immediate Push

**Description:** Bryson needs to know now, but can respond at his convenience.
**When:** Time-sensitive items or VIP contacts.
**Examples:**
- VIP message received (from anyone on the VIP list)
- Email containing urgent keywords (see [[Notification Logic]])
- Draft reply needing approval for a time-sensitive thread
- Calendar conflict detected for today
- Task overdue by more than 48 hours

**Delivery:** Immediate Telegram message with context and inline keyboard. Bryson sees it as a push notification.

### Tier 5: Interrupt

**Description:** Stop what you are doing and look at this.
**When:** Critical business situations that require immediate human judgment.
**Examples:**
- VIP contact sends a message containing urgent keywords
- Payment or invoice-related communication from a client
- Contract-related email flagged as time-sensitive
- System error affecting data integrity
- Multiple failed agent actions on the same item

**Delivery:** Immediate Telegram message with prominent formatting. Follow-up reminder sent if no response within 30 minutes.

## VIP List

The following contacts always trigger at minimum Tier 4 (Immediate Push) regardless of message content:

| Name | Relationship | Why VIP |
|---|---|---|
| **Mike** | Search Tuners partner | Business partner, revenue-critical |
| **Daniel** (Daniel Sanchez) | TTT key contact | Active client, frequent communication |
| **Steven** | Key contact | Business relationship |
| **Hunter** | Key contact | Business relationship |
| **Raymond** | Key contact | Business relationship |
| **Bren** | Key contact | Business relationship |

VIP status is stored as `is_vip = true` in the [[PostgreSQL]] `contacts` table. See [[Contacts]] for full details.

When a VIP contact's message also contains urgent keywords, the escalation is promoted to Tier 5 (Interrupt).

## Escalation Message Format

Every escalation sent via [[Telegram Bot]] follows a consistent structure:

```
ESCALATION

[Summary of what happened and why this needs attention]

[Additional context: what the agent already did]

ID: [short_id]

+-------------------+--------------+
| [A] Send draft    | [B] Edit     |
+-------------------+--------------+
| [C] Handle myself | [D] Dismiss  |
+-------------------+--------------+
```

### Inline Keyboard Actions

| Button | Callback | Action |
|---|---|---|
| **Send draft** | `approve:{id}` | Execute the agent's recommended action (send draft, create task, etc.) |
| **Edit** | `edit:{id}` | Prompt Bryson to reply with modifications |
| **Handle myself** | `handle:{id}` | Mark as actioned; Bryson will handle outside the system |
| **Dismiss** | `dismiss:{id}` | Discard the escalation; no action taken |

## Approval Flow

1. Agent creates an escalation with a summary, context, and suggested options
2. [[Orchestrator]] deduplicates (same project + type within last hour)
3. Escalation written to [[PostgreSQL]] `escalations` table (status: `pending`)
4. Escalation ID pushed to [[Redis]] `queue:escalations`
5. Formatted message sent to Bryson via [[Telegram Bot]]
6. Telegram message ID stored on the escalation record
7. Bryson taps an inline keyboard button
8. Callback routed through bot to [[Orchestrator]]
9. Chosen action executed
10. Escalation status updated to `actioned` or `dismissed`
11. Inline keyboard removed from the original message

## Escalation Lifecycle States

```
pending → actioned    (Bryson took action)
pending → dismissed   (Bryson dismissed it)
pending → expired     (No response after configured timeout)
```

## Follow-Up Logic

For Tier 5 (Interrupt) escalations:

- If no response after 30 minutes, send a follow-up reminder
- If no response after 2 hours, include in the next briefing as top priority
- Never send more than 2 follow-ups for the same escalation

See [[Notification Logic]] for the full decision tree.

## PostgreSQL Schema

Escalations are stored in the `escalations` table. See [[PostgreSQL]] for the full column definitions.

Key fields:
- `type` -- Escalation category (e.g., `vip_message`, `draft_approval`, `conflict`, `ambiguous_note`)
- `status` -- Lifecycle state (`pending`, `actioned`, `expired`, `dismissed`)
- `options` -- JSONB array of available actions for inline keyboard
- `telegram_message_id` -- For editing/updating the Telegram message

## Code References

- Escalation messaging: `src/telegram/bot.ts` (`sendEscalation`)
- Escalation repository: `src/db/repositories/escalations.ts`
- Callback handling: `src/telegram/bot.ts` (callback_query handler)
- Webhook endpoint: `src/server/routes/escalations.ts`

## Related Pages

- [[Notification Logic]] for the decision tree that determines escalation tier
- [[Telegram Bot]] for message delivery and inline keyboards
- [[Orchestrator]] for escalation queue management
- [[Contacts]] for VIP list
- [[Reporting Agent]] for how pending escalations appear in briefings
- [[PostgreSQL]] for the `escalations` table schema
- [[Redis]] for the `queue:escalations` key
