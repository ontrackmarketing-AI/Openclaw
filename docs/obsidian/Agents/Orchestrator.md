---
title: Orchestrator
aliases: [Orchestrator Agent, Central Brain, Agent 1]
tags: [agent, orchestrator, routing, core]
created: 2026-03-31
---

# Orchestrator

The Orchestrator is the central brain of the OpenClaw system. It receives all events, routes them to the appropriate specialist agent, maintains project context, and manages the escalation queue.

## Role

- Load the Project Context Store on every invocation
- Route incoming events to the correct specialist agent
- Merge results and decide: execute, queue, or escalate
- Maintain "working memory" of what has been done in the current session
- Run on both cron schedules and webhook triggers

## Why a Dedicated Orchestrator?

Without it, each agent would need to know about all other agents and all project context. The orchestrator pattern keeps specialist agents lean and testable. When Bryson adds a new client or project, he updates the orchestrator's context -- not every agent.

See [[Decision Log#Orchestrator Pattern]] for the full reasoning.

## Project Context Loading

On every invocation, the Orchestrator:

1. Checks [[Redis]] cache key `cache:project_context` (TTL 1 hour)
2. If cache miss, queries [[PostgreSQL]] `projects` table for all active projects
3. Loads associated contacts, recent tasks, and pending escalations
4. Serializes and caches the full context back to Redis
5. Passes relevant project context to the specialist agent being invoked

This ensures every agent has current project awareness without each needing database access.

## Event Routing

```
Incoming Event
      │
      ▼
  Identify source:
      ├── Telegram photo upload  → Ingestion Agent
      ├── Telegram command       → Parse command, route accordingly
      ├── Gmail thread (via n8n) → Inbox Agent (Gmail sub-agent)
      ├── iMessage (via bridge)  → Inbox Agent (iMessage sub-agent)
      ├── GHL webhook (via n8n)  → CRM processing
      ├── Calendar event         → Scheduler Agent
      ├── Drive file change      → Research Agent or Ingestion Agent
      └── Cron trigger           → Reporting Agent or Scheduler Agent
      │
      ▼
  Attach project context:
      Match event to project(s) using sender, subject, or content
      │
      ▼
  Dispatch to specialist agent with:
      - Event payload
      - Matched project context
      - Current escalation queue state
      - Recent related agent actions
```

## Escalation Queue Management

The Orchestrator owns the escalation lifecycle:

1. **Creation** -- When any agent determines it cannot fully handle an event, it returns an escalation request to the Orchestrator.
2. **Deduplication** -- The Orchestrator checks if a similar escalation already exists (same project + type within last hour).
3. **Queuing** -- New escalations are written to [[PostgreSQL]] `escalations` table and pushed to [[Redis]] `queue:escalations`.
4. **Delivery** -- Formatted and sent to Bryson via [[Telegram Bot]] with inline keyboard options.
5. **Resolution** -- When Bryson responds, the callback is routed back through the Orchestrator to execute the chosen action.

See [[Escalation System]] for tier definitions and formatting.

## Execution Modes

### Webhook Mode

Triggered by external events (Telegram message, n8n POST, iMessage bridge callback). Low latency, processes single events.

### Cron Mode

Scheduled tasks that run periodically:

| Schedule | Task | Agent |
|---|---|---|
| Every 15 min | Gmail fetch (fallback) | [[Inbox Agent]] |
| Every 30 min | Calendar sync | [[Scheduler Agent]] |
| 8:00 AM CST | Daily briefing | [[Reporting Agent]] |
| Every 1 hour | Project context refresh | Orchestrator |

### On-Demand Mode

Triggered by Telegram commands:

| Command | Action |
|---|---|
| `/brief` | Trigger [[Reporting Agent]] immediately |
| `/status` | Query current system state |
| `/tasks` | List open tasks by project |
| `/research <query>` | Trigger [[Research Agent]] |

## Working Memory

During a session, the Orchestrator maintains a short-lived context of actions taken. This prevents duplicate processing and allows multi-step operations:

```typescript
interface WorkingMemory {
  sessionId: string;
  startedAt: Date;
  eventsProcessed: string[];
  agentActions: AgentAction[];
  escalationsCreated: string[];
  projectsReferenced: string[];
}
```

Working memory is stored in [[Redis]] with a TTL of 30 minutes.

## Code References

- Configuration: `src/config/index.ts`
- Project repository: `src/db/repositories/projects.ts`
- Task repository: `src/db/repositories/tasks.ts`

## Connections

- Routes to: [[Ingestion Agent]], [[Inbox Agent]], [[Research Agent]], [[Scheduler Agent]], [[Reporting Agent]]
- Reads from: [[PostgreSQL]], [[Redis]], [[Qdrant]]
- Outputs to: [[Telegram Bot]], [[Redis]] escalation queue
- Receives from: [[n8n Workflows]], [[Telegram Bot]], [[iMessage Bridge]], cron scheduler

## Related Pages

- [[System Overview]] for where the Orchestrator sits in the architecture
- [[Data Flow]] for event routing diagrams
- [[Escalation System]] for escalation management details
- [[Project Registry]] for what projects are tracked
