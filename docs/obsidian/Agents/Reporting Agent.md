---
title: Reporting Agent
aliases: [Reporting, Briefing Agent, Agent 6]
tags: [agent, reporting, briefing, daily-report]
created: 2026-03-31
---

# Reporting Agent

The Reporting Agent produces the daily morning briefing and on-demand status reports. It aggregates data from all other agents and databases into a structured Telegram message.

## Role

- Run every morning at a configurable time (default 8:00 AM CST)
- Pull outputs from all agents over the last 24 hours
- Aggregate task status, inbox activity, and calendar events
- Score and prioritize items
- Produce a structured [[Telegram Bot]] message

## Daily Briefing Schedule

The briefing runs on a cron schedule managed by the [[Orchestrator]]:

- **Default time:** 8:00 AM CST
- **Trigger:** `node-cron` job
- **On-demand:** Bryson can trigger immediately with `/brief` via Telegram

## Data Aggregation

The agent queries the following data sources:

### From [[PostgreSQL]]

| Query | Table | Purpose |
|---|---|---|
| Open tasks by project | `tasks` | Show what needs attention |
| Overdue tasks | `tasks` (due_date < today) | Highlight missed deadlines |
| Pending escalations | `escalations` (status = 'pending') | Items awaiting Bryson's decision |
| Inbox events (24h) | `inbox_events` | Communication summary |
| Agent activity (24h) | `agent_logs` | What agents did overnight |

### From [[Qdrant]]

| Query | Collection | Purpose |
|---|---|---|
| Recent research | `bryson_research` | Summaries from Research Agent |

### From [[Scheduler Agent]]

| Data | Purpose |
|---|---|
| Today's calendar events | Schedule overview |
| Tomorrow's first event | Evening prep awareness |
| Detected conflicts | Proactive alerts |

## Priority Scoring Algorithm

Each item in the briefing is scored to determine display order:

```
score = base_priority * recency_weight * vip_multiplier * deadline_urgency
```

| Factor | Calculation |
|---|---|
| `base_priority` | Task/escalation priority (1-5, where 1 = highest) inverted: `6 - priority` |
| `recency_weight` | `1.0` if < 4 hours old, `0.8` if < 12 hours, `0.6` if < 24 hours |
| `vip_multiplier` | `2.0` if associated with a VIP contact, `1.0` otherwise |
| `deadline_urgency` | `3.0` if overdue, `2.0` if due today, `1.5` if due tomorrow, `1.0` otherwise |

Items are sorted by score descending. The top items appear first in the briefing.

## Briefing Template

The daily briefing is sent as a structured Telegram message:

```
DAILY BRIEFING — [Day, Month Date]

CALENDAR
  [time] [Event 1] with [attendee]
  [time] [Event 2] with [attendee]
  ... (all events today)

PRIORITY ACTIONS ([count])
  1. [Highest scored item] — [project]
  2. [Second item] — [project]
  3. [Third item] — [project]

PENDING ESCALATIONS ([count])
  - [Escalation summary] — awaiting your decision
  - [Escalation summary] — awaiting your decision

OVERDUE TASKS ([count])
  - [Task] — [project] — due [date]
  - [Task] — [project] — due [date]

INBOX SUMMARY
  Gmail: [count] new threads, [count] need reply
  iMessage: [count] new, [count] from VIPs
  Telegram: [count] processed

AGENT ACTIVITY (last 24h)
  - Ingestion: [count] pages processed, [count] tasks extracted
  - Inbox: [count] messages triaged, [count] drafts created
  - Research: [count] queries completed
  - Scheduler: [count] pre-briefs sent

PROJECTS SNAPSHOT
  [Project 1]: [open tasks] open, [done today] completed today
  [Project 2]: [open tasks] open, [done today] completed today
  ...

Type /tasks for full task list
Type /status for system health
```

## On-Demand Reports

Beyond the daily briefing, the Reporting Agent handles these Telegram commands:

### `/status`

System health overview:

```
SYSTEM STATUS

Databases:
  PostgreSQL: connected
  Qdrant: connected ([collection count] collections)
  Redis: connected

Queues:
  Escalations pending: [count]
  Ingestion queue: [count]
  
API Limits:
  Gmail: [used]/250 quota units today

Last agent runs:
  Orchestrator: [time]
  Inbox Agent: [time]
  Scheduler Agent: [time]
```

### `/tasks`

Full task list grouped by project:

```
OPEN TASKS ([total count])

[Project 1] ([count])
  [ ] [Task title] — P[priority] — due [date]
  [ ] [Task title] — P[priority]
  
[Project 2] ([count])
  [ ] [Task title] — P[priority] — due [date]
```

## Code References

- Agent implementation: `src/agents/` (reporting logic)
- Task queries: `src/db/repositories/tasks.ts` (`getOpen`, `getOverdue`)
- Project queries: `src/db/repositories/projects.ts` (`getActive`)
- Cron scheduling: `node-cron` in the Orchestrator

## Related Pages

- [[Telegram Bot]] for message delivery and command handling
- [[Orchestrator]] for scheduling and triggering
- [[Scheduler Agent]] for calendar data
- [[Escalation System]] for pending escalation data
- [[Data Flow]] for the briefing generation flow
- [[Project Registry]] for project snapshot data
