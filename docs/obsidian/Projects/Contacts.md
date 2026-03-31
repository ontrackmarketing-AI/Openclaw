---
title: Contacts
aliases: [VIP List, Contact Database, People]
tags: [projects, contacts, vip, people]
created: 2026-03-31
---

# Contacts

OpenClaw maintains a contact database for identifying message senders, routing communications to projects, and determining escalation priority. Contacts are stored in the [[PostgreSQL]] `contacts` table.

## VIP Contacts

VIP contacts always trigger **Tier 4 (Urgent)** escalation regardless of message content or intent classification. See [[Escalation System]].

| Name | Relationship | Projects | Channels | Why VIP |
|---|---|---|---|---|
| Mike | Business partner | Search Tuners | Gmail, iMessage, Telegram | Revenue partner, joint business decisions |
| Daniel | Key contact | Multiple | Gmail, iMessage | High-priority business relationship |
| Steven | Key contact | Multiple | Gmail, iMessage | High-priority business relationship |
| Hunter | Key contact | Multiple | Gmail, iMessage | High-priority business relationship |

VIP status is stored as `is_vip = true` in the contacts table. The [[Inbox Agent]] checks this flag on every incoming message.

## Contact Types

| Type | Description | Escalation Behavior |
|---|---|---|
| `client` | Paying client or client representative | Tier 3 for action items, Tier 2 for FYI |
| `partner` | Business partner (e.g., Mike) | Usually VIP, Tier 4 |
| `vendor` | Service provider or tool vendor | Tier 2 unless urgent |
| `personal` | Friends, family | Tier 1 unless flagged urgent |
| `lead` | Prospective client | Tier 2, tracked in GHL |

## Contact Resolution Across Channels

A single person may contact Bryson through multiple channels. OpenClaw resolves contacts by matching against known identifiers:

### Resolution Priority

```
Incoming message → Extract sender identifier
        │
        ▼
  Channel-specific lookup:
    Gmail    → Match contacts.email
    iMessage → Match contacts.phone OR contacts.imessage_handle
    Telegram → Match contacts.telegram_username
        │
        ▼
  Match found?
    ├── YES → Load full contact record, project associations, VIP status
    └── NO  → Create provisional contact record
              Log for Bryson's review in daily briefing
```

### Cross-Channel Identity

| Contact Field | Channel | Example |
|---|---|---|
| `email` | Gmail | `mike@searchtuners.com` |
| `phone` | iMessage | `+15551234567` |
| `imessage_handle` | iMessage | `mike@icloud.com` |
| `telegram_username` | Telegram | `@mike_st` |

A single contact can have all four identifiers set, allowing unified tracking across all channels.

### Project Association

Contacts can be associated with multiple projects via the `project_ids` UUID array:

```sql
-- Find all contacts for a project
SELECT * FROM contacts WHERE $1 = ANY(project_ids);

-- Find all projects for a contact
SELECT p.* FROM projects p WHERE p.id = ANY(
  SELECT unnest(project_ids) FROM contacts WHERE id = $1
);
```

## Contact Schema

See [[PostgreSQL#contacts]] for the full table schema.

| Column | Type | Purpose |
|---|---|---|
| `id` | UUID | Primary key |
| `name` | TEXT | Display name |
| `email` | TEXT | Gmail matching |
| `phone` | TEXT | iMessage phone matching |
| `imessage_handle` | TEXT | iMessage Apple ID matching |
| `telegram_username` | TEXT | Telegram matching |
| `type` | TEXT | Contact type (client, partner, vendor, personal, lead) |
| `project_ids` | UUID[] | Associated projects |
| `is_vip` | BOOLEAN | VIP flag for escalation |
| `last_contact` | TIMESTAMPTZ | Last communication timestamp |
| `notes` | TEXT | Free-form context notes |

## Adding New Contacts

Contacts are added in several ways:

1. **Database seed** -- Initial contacts loaded via `npm run db:seed`
2. **Auto-created** -- When the [[Inbox Agent]] encounters an unknown sender, a provisional record is created
3. **GHL sync** -- Contacts from [[GoHighLevel Integration]] are synced via [[n8n Workflows]]
4. **Manual** -- Bryson can add contacts via Telegram command or direct database entry

Auto-created contacts have `type = NULL` and `is_vip = false` by default. They appear in the daily briefing for Bryson to categorize.

## Usage By Agents

| Agent | How Contacts Are Used |
|---|---|
| [[Inbox Agent]] | Sender identification, VIP check, project routing |
| [[Scheduler Agent]] | Calendar attendee lookup for pre-briefs |
| [[Research Agent]] | Contact context when researching a project |
| [[Reporting Agent]] | VIP activity summary in daily briefing |
| [[Orchestrator]] | Project context enrichment |
| [[Escalation System]] | VIP escalation tier override |

## Related Pages

- [[Escalation System]] for VIP escalation behavior
- [[Inbox Agent]] for sender identification flow
- [[PostgreSQL]] for table schema
- [[Project Registry]] for project associations
- [[Scheduler Agent]] for attendee lookup
