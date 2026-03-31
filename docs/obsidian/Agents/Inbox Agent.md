---
title: Inbox Agent
aliases: [Inbox, Email Agent, Message Agent, Agent 3]
tags: [agent, inbox, gmail, imessage, telegram, triage]
created: 2026-03-31
---

# Inbox Agent

The Inbox Agent monitors all of Bryson's communication channels, triages messages, handles what it can autonomously, and escalates what it cannot. It contains three sub-agents, one per channel.

## Role

- Monitor Gmail, iMessage, and Telegram for incoming messages
- Identify senders and match to known [[Contacts]]
- Classify message intent
- Handle routine messages autonomously
- Draft replies for Bryson's approval
- Extract action items and create tasks
- Escalate VIP and time-sensitive messages immediately

## Sub-Agents

### Gmail Sub-Agent

Receives Gmail threads via the [[Gmail Integration]] (polled every 15 minutes by [[n8n Workflows]]).

**Capabilities:**
- Read full thread history for context
- Identify sender from contacts database
- Draft replies using Claude (stored as Gmail drafts, never sent automatically)
- Extract action items from email threads
- Flag threads by priority based on sender and content

**Rate limit:** 250 quota units per day for the Gmail API. See [[Gmail Integration]] for details.

**Safety rule:** Email sending is disabled by default. The `ENABLE_GMAIL_SEND` feature flag must be explicitly enabled. Even when enabled, the agent creates drafts and sends them for 1-tap approval via [[Telegram Bot]].

### iMessage Sub-Agent

Receives iMessage conversations via the [[iMessage Bridge]] running on a Mac mini.

**Capabilities:**
- Read conversation history
- Respond to simple queries (schedule confirmations, "got it" acknowledgments)
- Flag client messages for attention
- Detect appointment/meeting mentions

**Constraint:** iMessage requires a macOS machine. The `ENABLE_IMESSAGE` feature flag gates this sub-agent entirely. When disabled, no iMessage processing occurs.

### Telegram Sub-Agent

Handles direct messages and commands via the [[Telegram Bot]].

**Capabilities:**
- Parse commands (`/brief`, `/status`, `/tasks`, `/research`)
- Receive photo uploads (routed to [[Ingestion Agent]])
- Process callback queries from inline keyboards
- Handle free-text questions about projects

## Message Processing Flow

### Step 1: Deduplication

Every incoming message is checked against [[Redis]] key `webhook:dedup:{channel}:{message_id}`:
- If key exists: message was already processed, skip
- If key is new: SET with TTL 24 hours, proceed

### Step 2: Sender Identification

Query the [[PostgreSQL]] `contacts` table to identify the sender:

```sql
-- Gmail: match by email
SELECT * FROM contacts WHERE email = $1;

-- iMessage: match by phone or iMessage handle
SELECT * FROM contacts WHERE phone = $1 OR imessage_handle = $1;

-- Telegram: match by telegram_username
SELECT * FROM contacts WHERE telegram_username = $1;
```

If the sender is found, load their project associations and VIP status. If unknown, create a provisional contact record.

### Step 3: Intent Classification

Claude classifies the message into one of four intents:

| Intent | Description | Action |
|---|---|---|
| `fyi` | Informational, no response needed | Log to `inbox_events`, skip notification |
| `needs_reply` | Requires a response from Bryson | Draft reply, queue for approval |
| `needs_action` | Contains an action item | Extract task, create in `tasks` table |
| `time_sensitive` | Urgent, requires immediate attention | Escalate immediately |

Classification prompt includes project context and recent conversation history for accuracy.

### Step 4: VIP Detection

The following contacts are VIP and always trigger immediate escalation regardless of intent:

- **Mike** (Search Tuners partner)
- **Daniel** (key contact)
- **Steven** (key contact)
- **Hunter** (key contact)

VIP status is stored in the `contacts` table (`is_vip = true`). See [[Contacts]] for the full VIP list.

### Step 5: Draft Approval Flow

When the agent drafts a reply:

1. Claude generates a contextual response based on thread history and project context
2. Draft is saved (Gmail draft or prepared iMessage)
3. Telegram message sent to Bryson with:
   - Original message summary
   - Proposed reply text
   - Inline keyboard: `[Approve & Send]` `[Edit]` `[Skip]`
4. On "Approve & Send": the draft is sent (if feature flag allows)
5. On "Edit": Bryson can modify the reply text
6. On "Skip": draft is discarded, event logged

### Step 6: Storage

Every processed message is stored in `inbox_events`:

| Column | Description |
|---|---|
| `channel` | `gmail`, `imessage`, or `telegram` |
| `external_id` | Original message ID for dedup |
| `sender` | Sender name/address |
| `contact_id` | FK to contacts table (if matched) |
| `project_id` | FK to projects table (if matched) |
| `subject` | Thread subject (Gmail) or first line |
| `body_summary` | Claude-generated summary |
| `intent` | Classified intent |
| `agent_action` | What the agent did |
| `escalated` | Whether this was escalated |

Thread summaries are also embedded and stored in [[Qdrant]] collection `bryson_emails`.

## Metrics Tracked

- Messages processed per channel per day
- Intent distribution (fyi / needs_reply / needs_action / time_sensitive)
- VIP message response time
- Draft approval rate
- Escalation rate

## Code References

- Agent implementation: `src/agents/comms/`
- Triage logic: `src/agents/triage/`
- Contact queries: `src/db/repositories/` (contacts queries via connection.ts)
- Schema: `src/db/schema.sql` (inbox_events, contacts, escalations tables)

## Related Pages

- [[Contacts]] for VIP list and contact resolution
- [[Escalation System]] for escalation tier handling
- [[Gmail Integration]] for OAuth2 and rate limits
- [[iMessage Bridge]] for Mac bridge architecture
- [[Telegram Bot]] for command handling
- [[Orchestrator]] for event routing
- [[Data Flow]] for the inbox processing diagram
