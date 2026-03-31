---
title: Scheduler Agent
aliases: [Scheduler, Planner, Calendar Agent, Agent 5]
tags: [agent, scheduler, calendar, meetings, planning]
created: 2026-03-31
---

# Scheduler Agent

The Scheduler Agent manages calendar context, surfaces scheduling conflicts proactively, and drafts meeting preparation briefs so Bryson walks into every meeting informed.

## Role

- Read Google Calendar events
- Generate pre-briefs before meetings
- Detect and flag scheduling conflicts
- Suggest time blocks for deep work vs. admin
- Feed calendar context to other agents

## Google Calendar Integration

The agent reads from Bryson's Google Calendar via the [[Google Calendar Integration]]. It syncs every 30 minutes (cron-scheduled by the [[Orchestrator]]) and on-demand when triggered.

Data pulled per event:

| Field | Usage |
|---|---|
| Event title | Display in briefs and daily reports |
| Start/end time | Conflict detection, time block analysis |
| Attendees | Contact lookup for pre-briefs |
| Description | Context extraction, project matching |
| Location | Include in pre-brief |
| Conference link | Include in pre-brief for quick access |

## Pre-Brief Generation

Before each meeting, the Scheduler Agent generates a pre-brief and sends it via [[Telegram Bot]]. The brief is sent 15 minutes before the meeting start time.

### Pre-Brief Contents

```
Meeting: [Event Title]
Time: [Start] - [End]
With: [Attendee names]
Location: [Location or video link]

Project: [Matched project from attendee/title]

Contact context:
  - [Attendee]: [Role], last contact [date], [project association]

Recent activity:
  - Last note mentioning [project]: [summary]
  - Open tasks for [project]: [count] ([top 3 listed])
  - Last email thread: [subject] ([date])

Pending items for this meeting:
  - [Any escalations or decisions related to this project]

Suggested talking points:
  - [AI-generated based on recent context]
```

### Pre-Brief Data Sources

The pre-brief pulls from multiple sources:

1. **[[PostgreSQL]] contacts** -- Attendee lookup, project associations, last contact date
2. **[[PostgreSQL]] tasks** -- Open tasks for the matched project
3. **[[PostgreSQL]] inbox_events** -- Recent email/message activity with attendees
4. **[[Qdrant]] bryson_notes** -- Semantic search for recent notes mentioning the project
5. **[[Research Agent]]** -- If triggered, fresh research on the meeting topic

## Conflict Detection

The agent proactively scans for conflicts:

- **Overlapping events** -- Two events at the same time
- **Back-to-back meetings** -- No buffer between consecutive meetings
- **Travel conflicts** -- Different physical locations without sufficient gap
- **Overloaded days** -- More than 5 meetings in a single day

When conflicts are detected, an escalation is created:

```
SCHEDULING CONFLICT

You have overlapping events on [date]:
  1. [Event A] at [time] with [attendee]
  2. [Event B] at [time] with [attendee]

[Reschedule A]  [Reschedule B]  [Keep Both]
```

## Time Block Suggestions

Based on calendar density, the agent suggests optimal time allocation:

| Calendar Density | Suggestion |
|---|---|
| Light day (0-2 meetings) | "Good day for deep work on [highest priority project]" |
| Medium day (3-4 meetings) | "Admin blocks available: [times]" |
| Heavy day (5+ meetings) | "Consider rescheduling non-essential meetings" |

## Daily Calendar Summary

The Scheduler Agent provides calendar data to the [[Reporting Agent]] for the daily briefing:

- Today's events with times and attendees
- Tomorrow's first event (for evening prep)
- Upcoming deadlines from tasks that align with calendar events

## Code References

- Agent implementation: `src/agents/scheduler/`
- Calendar integration: `src/integrations/` (Google Calendar client)
- Cron scheduling: uses `node-cron` configured in the Orchestrator

## Related Pages

- [[Google Calendar Integration]] for API setup and authentication
- [[Reporting Agent]] for how calendar data feeds into daily briefings
- [[Orchestrator]] for scheduling triggers
- [[Contacts]] for attendee lookup
- [[Data Flow]] for the scheduling flow
- [[Research Agent]] for pre-meeting research
