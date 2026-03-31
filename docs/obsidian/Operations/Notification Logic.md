---
title: Notification Logic
aliases: [Notifications, Notification Rules, Alert Logic]
tags: [operations, notification, escalation, filtering, batching]
created: 2026-03-31
---

# Notification Logic

This page documents the decision tree that determines when and how Bryson is notified. It complements the [[Escalation System]] tier definitions with the specific rules, keywords, and conditions that drive tier assignment.

## Core Decision Tree

Every event processed by an agent passes through this decision tree:

```
Event arrives
    |
    v
Can the agent handle this fully without Bryson?
    +-- YES --> Tier 1 (Silent). Log and move on.
    +-- NO or PARTIALLY --> Continue evaluation
    |
    v
Is the sender a VIP?
    +-- YES --> Does it contain urgent keywords?
    |              +-- YES --> Tier 5 (Interrupt)
    |              +-- NO  --> Tier 4 (Immediate Push)
    +-- NO --> Continue evaluation
    |
    v
Does the message contain urgent keywords?
    +-- YES --> Tier 4 (Immediate Push)
    +-- NO --> Continue evaluation
    |
    v
Is there a deadline within 24 hours?
    +-- YES --> Tier 4 (Immediate Push)
    +-- NO --> Continue evaluation
    |
    v
Does it require Bryson's approval or decision?
    +-- YES --> Is the daily briefing within 4 hours?
    |              +-- YES --> Tier 3 (Next Briefing Priority)
    |              +-- NO  --> Tier 4 (Immediate Push)
    +-- NO --> Tier 2 (Batched)
```

## Urgent Keywords

The following keywords in a message body or subject trigger automatic escalation to at least Tier 4:

| Category | Keywords |
|---|---|
| **Time pressure** | `urgent`, `ASAP`, `immediately`, `right now`, `time-sensitive`, `deadline` |
| **Financial** | `invoice`, `payment`, `wire`, `transfer`, `overdue balance`, `past due`, `collections` |
| **Legal/Contracts** | `contract`, `agreement`, `signed`, `legal`, `attorney`, `lawsuit`, `compliance` |
| **Escalation signals** | `escalate`, `manager`, `supervisor`, `complaint`, `unacceptable` |

Keyword matching is case-insensitive and uses whole-word matching to avoid false positives (e.g., "contract" matches but "contractor" does not trigger the legal category).

### Keyword + VIP Compound Rule

When a message comes from a VIP contact AND contains urgent keywords, the escalation is promoted to Tier 5 (Interrupt) with follow-up logic enabled. This is the highest possible escalation.

## VIP Detection

VIP status is checked at three levels:

1. **Contact table lookup** -- `contacts.is_vip = true` in [[PostgreSQL]]
2. **Email domain matching** -- Known client domains trigger VIP-level treatment
3. **Sender name fuzzy matching** -- Partial name matches against the VIP list (e.g., "Mike from Search Tuners" matches Mike)

The VIP list is maintained in [[Contacts]]. Current VIPs: Mike, Daniel, Steven, Hunter, Raymond, Bren.

## Batching Rules

Items at Tier 2 (Batched) are collected and delivered in the daily briefing:

- **Batching window:** From the last briefing until the next one (typically 24 hours)
- **Maximum batch size:** No limit, but the [[Reporting Agent]] prioritizes and truncates to the top items
- **Priority within batch:** Scored by the priority scoring algorithm (see [[Reporting Agent]])

### Batch Promotion

A Tier 2 item is promoted to Tier 3 or Tier 4 if:

- The same sender sends a second message (they are following up)
- The item has been in the batch for more than 24 hours without a briefing delivery
- A related task becomes overdue while the batch item is pending

## Follow-Up Logic

When Bryson does not respond to a Tier 4 or Tier 5 escalation:

### Tier 4 (Immediate Push) Follow-Up

| Time Since Send | Action |
|---|---|
| 2 hours | No follow-up; include in next briefing as priority item |
| Next briefing | Appears at top of briefing with "STILL PENDING" flag |

### Tier 5 (Interrupt) Follow-Up

| Time Since Send | Action |
|---|---|
| 30 minutes | Send follow-up reminder via Telegram |
| 2 hours | Second follow-up with increased urgency |
| Next briefing | Appears at absolute top of briefing |
| No further | Stop after 2 follow-ups to avoid notification fatigue |

### Follow-Up Message Format

```
REMINDER -- Pending escalation from [time ago]

[Original summary]

This still needs your input.

[Approve]  [Handle myself]  [Dismiss]
```

## Channel-Specific Rules

### Gmail

| Condition | Tier |
|---|---|
| FYI email, no action needed | Tier 1 (Silent) |
| Email needs reply, non-VIP, non-urgent | Tier 3 (Next Briefing Priority) |
| Email needs reply, contains urgent keywords | Tier 4 (Immediate Push) |
| Email from VIP | Tier 4 (Immediate Push) |
| Email from VIP with urgent keywords | Tier 5 (Interrupt) |

### iMessage

| Condition | Tier |
|---|---|
| Simple acknowledgment ("got it", "thanks") | Tier 1 (Silent) |
| Client message needing response | Tier 3 or Tier 4 depending on VIP status |
| Message mentioning meeting/appointment | Tier 3 (Next Briefing Priority) |
| VIP message | Tier 4 (Immediate Push) |

### Telegram

| Condition | Tier |
|---|---|
| Command response (`/tasks`, `/status`) | Tier 1 (Silent, response is inline) |
| Photo upload confirmation | Tier 1 (Silent) |
| Ambiguous ingestion items | Tier 3 (Next Briefing Priority) |

### GoHighLevel

| Condition | Tier |
|---|---|
| Contact created/updated | Tier 2 (Batched) |
| Pipeline stage change | Tier 2 (Batched) |
| Task completed | Tier 1 (Silent) |

## Anti-Spam Protections

1. **Deduplication** -- Same project + type within 1 hour is suppressed (see [[Orchestrator]])
2. **Rate limiting** -- Maximum 10 push notifications per hour; excess are demoted to batch
3. **Quiet hours** -- Optional configuration to suppress non-Tier-5 notifications during specified hours
4. **Escalation cooldown** -- After dismissing an escalation, similar items are suppressed for 4 hours

## Code References

- Intent classification: `src/agents/inbox/index.ts` (Claude prompt for intent classification)
- VIP lookup: `src/db/repositories/contacts.ts` (`getVIPs()`)
- Keyword matching: implemented in the triage logic within inbox agent
- Escalation creation: `src/db/repositories/escalations.ts`

## Related Pages

- [[Escalation System]] for tier definitions and message format
- [[Reporting Agent]] for how batched items appear in briefings
- [[Contacts]] for VIP list management
- [[Inbox Agent]] for message classification
- [[Orchestrator]] for escalation queue deduplication
- [[Telegram Bot]] for notification delivery
