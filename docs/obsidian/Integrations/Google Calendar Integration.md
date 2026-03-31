---
title: Google Calendar Integration
aliases: [Calendar, Google Calendar, Calendar Integration]
tags: [integration, google, calendar, scheduling, oauth2]
created: 2026-03-31
---

# Google Calendar Integration

OpenClaw reads Bryson's Google Calendar to provide meeting pre-briefs, detect scheduling conflicts, and feed calendar context into the daily briefing. The integration is read-only -- OpenClaw never creates or modifies calendar events.

## Authentication

Calendar access shares the same Google OAuth2 credentials as [[Gmail Integration]] and [[Google Drive Integration]]. A single set of OAuth tokens covers all three Google services.

### Shared OAuth2 Setup

The same `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REDIRECT_URI`, and `GOOGLE_REFRESH_TOKEN` are used across all Google integrations. The refresh token must be obtained with all required scopes in a single authorization flow.

### Required Scope

| Scope | Purpose |
|---|---|
| `https://www.googleapis.com/auth/calendar.readonly` | Read calendar events and attendee lists |

This scope is requested alongside Gmail and Drive scopes during the initial OAuth flow. See [[Environment Variables]] for the full set of Google credentials.

### Token Refresh

The `googleapis` client handles token refresh automatically. When the access token expires (typically after 1 hour), the client uses the stored refresh token to obtain a new access token without user intervention.

## Event Fetching

The [[Scheduler Agent]] syncs calendar events every 30 minutes via a cron job managed by the [[Orchestrator]].

### Fetch Logic

1. Query the Google Calendar API for events in a rolling 48-hour window (today + tomorrow)
2. Parse each event for relevant fields
3. Match attendees to known contacts in [[PostgreSQL]] `contacts` table
4. Match event title/description to known projects via fuzzy matching
5. Store event context for pre-brief generation

### Data Extracted Per Event

| Field | Source | Usage |
|---|---|---|
| Event title | `summary` | Display in briefs, project matching |
| Start/end time | `start.dateTime` | Conflict detection, scheduling |
| Attendees | `attendees[].email` | Contact lookup for pre-briefs |
| Description | `description` | Context extraction, project matching |
| Location | `location` | Include in pre-brief |
| Conference link | `conferenceData.entryPoints[].uri` | Quick access in pre-brief |
| Organizer | `organizer.email` | Identify who called the meeting |
| Recurring | `recurringEventId` | Detect standing meetings |

### Calendar API Quota

Google Calendar API has generous quotas:

| Limit | Value |
|---|---|
| Queries per day | 1,000,000 |
| Queries per 100 seconds per user | 100 |

These limits are unlikely to be hit with 30-minute polling, but the system tracks usage as a precaution.

## Pre-Brief Generation

15 minutes before each meeting, the [[Scheduler Agent]] sends a pre-brief to Bryson via [[Telegram Bot]].

### Pre-Brief Data Sources

1. **Calendar event** -- Title, time, attendees, location, conference link
2. **[[PostgreSQL]] contacts** -- Attendee lookup, project associations, last contact date
3. **[[PostgreSQL]] tasks** -- Open tasks for the matched project
4. **[[PostgreSQL]] inbox_events** -- Recent messages from attendees
5. **[[Qdrant]] bryson_notes** -- Semantic search for recent notes mentioning the project/attendees
6. **[[Research Agent]]** -- Optional fresh research if triggered by the Orchestrator

### Pre-Brief Template

```
Meeting: [Event Title]
Time: [Start] - [End]
With: [Attendee names]
Location: [Location or video link]

Project: [Matched project]

Contact context:
  - [Attendee]: [Role], last contact [date], [projects]

Recent activity:
  - Open tasks for [project]: [count]
  - Last email from [attendee]: [subject] ([date])
  - Last note mentioning [project]: [summary]

Suggested talking points:
  - [AI-generated from recent context]
```

## Conflict Detection

The Scheduler Agent scans for four types of conflicts:

| Conflict Type | Detection Logic | Escalation |
|---|---|---|
| Overlapping events | Two events with overlapping time ranges | Immediate push with reschedule options |
| Back-to-back | Less than 15 minutes between consecutive events | Included in daily briefing |
| Travel conflicts | Different physical locations without sufficient gap | Immediate push |
| Overloaded days | More than 5 meetings in a single day | Included in daily briefing |

When a conflict is detected, an escalation is created with inline keyboard options. See [[Escalation System]] for how these are delivered and resolved.

## Daily Calendar Summary

The calendar integration provides data to the [[Reporting Agent]] for the morning briefing:

- **Today's events** -- Full list with times, attendees, and locations
- **Tomorrow's first event** -- So Bryson can prepare the night before
- **Upcoming deadlines** -- Tasks with due dates that align with calendar events

## Error Handling

| Error | Response |
|---|---|
| OAuth token expired | Automatic refresh via `googleapis` client |
| Calendar API error (5xx) | Retry on next 30-minute cycle |
| No events found | Normal -- calendar may be empty; no error logged |
| Attendee not in contacts | Create provisional contact record |

## Code References

- Calendar client: `src/integrations/` (Google Calendar via `googleapis`)
- Scheduler Agent: `src/agents/scheduler/index.ts`
- OAuth configuration: `src/config/index.ts` (`google.*`)

## Related Pages

- [[Scheduler Agent]] for how calendar data is used
- [[Gmail Integration]] for shared OAuth2 setup
- [[Google Drive Integration]] for shared OAuth2 setup
- [[Reporting Agent]] for daily briefing calendar section
- [[Contacts]] for attendee resolution
- [[Escalation System]] for conflict escalations
- [[Environment Variables]] for Google OAuth credentials
