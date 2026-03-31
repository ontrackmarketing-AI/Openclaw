---
title: Contacts
aliases: [VIP List, Contact Resolution, People]
tags: [projects, contacts, vip, people, resolution]
created: 2026-03-31
---

# Contacts

Contacts are people Bryson interacts with across all communication channels. The contact system enables sender identification, VIP routing, and cross-channel resolution.

## VIP List

VIP contacts always trigger at minimum Tier 4 (Immediate Push) in the [[Escalation System]], regardless of message content or intent classification.

| Name | Type | Relationship | Projects | Why VIP |
|---|---|---|---|---|
| **Mike** | Partner | Search Tuners business partner | [[Project Registry#Search Tuners\|Search Tuners]] | Revenue-critical partnership. Frequent communication. |
| **Daniel** (Daniel Sanchez) | Client | TTT primary contact | [[Project Registry#Texas Tree Tops (TTT)\|TTT]] | Active client, frequent communicator, key revenue. |
| **Steven** | VIP | Key business contact | Multiple | Business-critical relationship. |
| **Hunter** | VIP | Key business contact | Multiple | Business-critical relationship. |
| **Raymond** | VIP | Key business contact | Multiple | Business-critical relationship. |
| **Bren** | VIP | Key business contact | Multiple | Business-critical relationship. |

VIP status is stored as `is_vip = true` in the [[PostgreSQL]] `contacts` table.

### Adding/Removing VIPs

VIP status is managed by updating the `contacts` table directly or via the [[Orchestrator]] when Bryson instructs a contact status change. Future: Telegram command to toggle VIP status.

## Contact Types

| Type | Description | Examples |
|---|---|---|
| `client` | Paying client or client contact | Daniel Sanchez (TTT), Salon Esby owner |
| `partner` | Business partner with shared revenue/ownership | Mike (Search Tuners) |
| `vendor` | Service provider or tool provider | SaaS vendors, contractors |
| `personal` | Personal contact, not business | Family, friends |
| `lead` | Prospective client, not yet converted | Inbound inquiries |

Contact type is stored in the `contacts.type` column and influences notification behavior. `client` and `partner` types receive higher baseline escalation priority than `vendor` or `personal`.

## Cross-Channel Resolution

A single person may contact Bryson through multiple channels (email, iMessage, Telegram). The contact system resolves these to a single contact record.

### Resolution Order

When a message arrives, the [[Inbox Agent]] attempts to match the sender:

```
Gmail message arrives
    |
    v
Match by email address
    SELECT * FROM contacts WHERE email = $1
    +-- Found --> Use this contact record
    +-- Not found --> Continue

iMessage arrives
    |
    v
Match by phone number OR iMessage handle
    SELECT * FROM contacts WHERE phone = $1 OR imessage_handle = $1
    +-- Found --> Use this contact record
    +-- Not found --> Continue

Telegram message arrives
    |
    v
Match by Telegram username
    SELECT * FROM contacts WHERE telegram_username = $1
    +-- Found --> Use this contact record
    +-- Not found --> Continue

No match found
    |
    v
Create provisional contact record with available identifiers
Log as "new contact" for Bryson's review
```

### Multi-Channel Identity

A fully resolved contact has identifiers for every channel:

| Field | Channel | Example |
|---|---|---|
| `email` | Gmail | `daniel@texastreetops.com` |
| `phone` | iMessage (phone) | `+15551234567` |
| `imessage_handle` | iMessage (Apple ID) | `daniel@icloud.com` |
| `telegram_username` | Telegram | `@danielsanchez` |

When the Inbox Agent matches a sender on one channel, it has access to the full contact record including identifiers for other channels. This enables:

- "Last time Daniel emailed about X" when Daniel messages via iMessage
- "Daniel's recent Telegram conversation about TTT" when processing a Gmail thread from Daniel

### Provisional Contacts

When a sender cannot be matched to an existing contact:

1. A new contact record is created with the available identifier (email, phone, or Telegram username)
2. Contact type is set to `null` (unclassified)
3. VIP status defaults to `false`
4. The event appears in the daily briefing as "New contact from [channel]"
5. Bryson can classify the contact via Telegram or directly in the database

## Contact Data Schema

Contacts are stored in the [[PostgreSQL]] `contacts` table:

| Column | Type | Purpose |
|---|---|---|
| `id` | UUID | Primary key |
| `name` | TEXT | Display name |
| `email` | TEXT | Gmail matching |
| `phone` | TEXT | iMessage matching (phone number) |
| `imessage_handle` | TEXT | iMessage matching (Apple ID) |
| `telegram_username` | TEXT | Telegram matching |
| `type` | TEXT | `client`, `partner`, `vendor`, `personal`, `lead` |
| `project_ids` | UUID[] | Array of associated project UUIDs |
| `is_vip` | BOOLEAN | VIP status for escalation routing |
| `last_contact` | TIMESTAMPTZ | When Bryson last communicated with them |
| `notes` | TEXT | Free-form notes about this contact |

See [[PostgreSQL]] for full schema details including indexes.

### Key Indexes

- **`idx_contacts_is_vip`** -- Partial index on VIP contacts for fast lookup
- **`idx_contacts_email`** -- Partial index for email matching
- **`idx_contacts_phone`** -- Partial index for phone matching

## Contact-Project Association

Each contact can be associated with one or more projects via the `project_ids` array. This association enables:

- **Inbox Agent:** "This email from Daniel is about TTT" (because Daniel is associated with TTT)
- **Scheduler Agent:** "This meeting with Daniel needs TTT context" (attendee lookup)
- **Reporting Agent:** "Daniel's open tasks for TTT" (contact-project join)

## API Access

Contacts are available via the REST API:

| Endpoint | Method | Description |
|---|---|---|
| `GET /api/contacts` | GET | List all contacts |
| `GET /api/contacts?vip=true` | GET | List VIP contacts only |

See [[API Reference]] for full endpoint documentation.

## Code References

- Contact repository: `src/db/repositories/contacts.ts`
- VIP lookup: `getVIPs()` method
- Contact route: `src/server/routes/contacts.ts`
- Sender identification: `src/agents/inbox/index.ts`

## Related Pages

- [[Escalation System]] for how VIP status affects escalation tiers
- [[Notification Logic]] for VIP detection rules
- [[Inbox Agent]] for sender identification flow
- [[Scheduler Agent]] for attendee lookup
- [[Project Registry]] for project associations
- [[PostgreSQL]] for the `contacts` table schema
- [[API Reference]] for contact endpoints
