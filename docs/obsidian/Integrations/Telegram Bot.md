---
title: Telegram Bot
aliases: [Telegram, Bot, Telegram Integration, Primary Interface]
tags: [integration, telegram, bot, interface, commands]
created: 2026-03-31
---

# Telegram Bot

Telegram is Bryson's primary interface with OpenClaw. All briefings, escalations, approvals, and quick commands flow through a single Telegram bot. The bot is built with **Telegraf 4.16** and supports both webhook and polling modes.

## Why Telegram

- **Always on Bryson's phone** -- no new app to install
- **Rich formatting** -- MarkdownV2, inline keyboards, photo uploads
- **Inline keyboards** -- one-tap approvals without typing
- **Bot API** -- mature, well-documented, no monthly fees
- **Webhook support** -- instant delivery, no polling latency in production

See [[Decision Log#Telegram Over Web App]] for the full reasoning.

## Authentication

### Chat ID Verification

Every incoming message is checked against `TELEGRAM_BRYSON_CHAT_ID`. If the chat ID does not match, the bot responds with "Unauthorized. This bot is private." and logs the attempt.

```typescript
function isBryson(ctx: Context): boolean {
  const chatId = ctx.chat?.id?.toString();
  if (!config.telegram.brysonChatId) return true; // dev fallback
  return chatId === config.telegram.brysonChatId;
}
```

If `TELEGRAM_BRYSON_CHAT_ID` is not set (development only), all messages are allowed with a warning logged.

### Webhook Secret

In webhook mode, Telegram sends a `X-Telegram-Bot-Api-Secret-Token` header that is validated against `TELEGRAM_WEBHOOK_SECRET`. This prevents forged webhook deliveries.

## Commands

| Command | Description | Handler |
|---|---|---|
| `/start` | Show welcome message and command list | Displays all available commands |
| `/brief` | Trigger morning briefing on demand | Queries [[PostgreSQL]] for tasks, escalations, projects; formats and sends summary |
| `/status` | System health overview | Shows uptime, active projects count, open tasks, pending escalations |
| `/tasks` | List open tasks with priorities | Shows up to 15 tasks, grouped by priority, with short IDs |
| `/ingest` | Trigger ingestion mode | Prompts Bryson to send photos, documents, or text |
| `/escalations` | Show pending escalations | Sends each pending escalation as a separate message with inline keyboard |
| `/done <id>` | Mark a task as done | Accepts task UUID (or prefix); updates status to `done` in [[PostgreSQL]] |
| `/skip <id>` | Dismiss an escalation | Marks the escalation as `dismissed` |
| `/approve <id>` | Approve an escalation | Marks the escalation as `actioned` and executes the default action |
| `/note <text>` | Quick note capture | Creates a note record in [[PostgreSQL]] with source `telegram:note` |
| `/research <query>` | Trigger research | Routes to [[Research Agent]] for information gathering |

## Inline Keyboards for Escalations

When an escalation is sent, it includes a 2x2 inline keyboard:

```
+-------------------+--------------+
| [A] Send draft    | [B] Edit     |
+-------------------+--------------+
| [C] Handle myself | [D] Dismiss  |
+-------------------+--------------+
```

### Callback Flow

1. Bryson taps a button
2. Callback data format: `{action}:{escalation_id}` (e.g., `approve:abc-123`)
3. Bot validates the escalation exists and is still `pending`
4. Executes the chosen action:
   - **approve** -- Marks actioned, removes keyboard, sends confirmation
   - **edit** -- Prompts Bryson to reply with edits
   - **handle** -- Marks actioned, confirms manual handling
   - **dismiss** -- Marks dismissed, removes keyboard silently
5. Updates escalation record in [[PostgreSQL]] `escalations` table
6. Stores Telegram message ID on the escalation for future reference

## Photo Upload for Ingestion

When Bryson sends a photo:

1. Bot extracts the largest resolution version from the photo array
2. Gets the file download link from Telegram servers
3. Creates a note record in [[PostgreSQL]] with source `telegram:photo` and the file URL as `image_path`
4. The caption (if any) becomes the `raw_text`
5. The [[Ingestion Agent]] picks up the job from the ingestion queue
6. Bot confirms: "Photo received and queued for ingestion."

Document uploads follow the same pattern with source `telegram:document`.

## MarkdownV2 Formatting

Telegram's MarkdownV2 requires escaping special characters: `_ * [ ] ( ) ~ > # + - = | { } . ! \`

OpenClaw uses helper functions for safe formatting:

```typescript
const MD2_SPECIAL = /[_*\[\]()~`>#+\-=|{}.!\\]/g;

function escapeMarkdownV2(text: string): string {
  return text.replace(MD2_SPECIAL, "\\$&");
}

function bold(text: string): string {
  return `*${escapeMarkdownV2(text)}*`;
}

function code(text: string): string {
  return `\`${text.replace(/[`\\]/g, "\\$&")}\``;
}
```

All user-facing text passes through `escapeMarkdownV2` before sending. Formatting tokens are added after escaping.

## Webhook vs Polling Mode

| Mode | When | Setup |
|---|---|---|
| **Webhook** | Production | Bot registers a webhook URL with Telegram; updates arrive via POST to `/webhooks/telegram` |
| **Polling** | Development | Bot calls `getUpdates` in a loop; no public URL needed |

### Webhook Setup

```typescript
export function setupWebhook(webhookUrl: string) {
  const b = getBot();
  const secretToken = config.telegram.webhookSecret || undefined;
  void b.telegram.setWebhook(webhookUrl, { secret_token: secretToken });
  return b.webhookCallback("/webhooks/telegram", { secretToken });
}
```

The webhook callback middleware is mounted on the Express server in `src/server/index.ts`.

### Polling Setup

```typescript
export async function launchPolling(): Promise<void> {
  const b = getBot();
  await b.telegram.deleteWebhook();
  await b.launch();
}
```

## Environment Variables

| Variable | Required | Description |
|---|---|---|
| `TELEGRAM_BOT_TOKEN` | Yes (prod) | Bot token from @BotFather |
| `TELEGRAM_WEBHOOK_SECRET` | No | Secret token for webhook verification |
| `TELEGRAM_BRYSON_CHAT_ID` | Yes (prod) | Bryson's Telegram chat ID for authorization |

See [[Environment Variables]] for the complete list.

## Direct Messaging (Cron Jobs)

For scheduled messages (daily briefing), the bot sends directly to `TELEGRAM_BRYSON_CHAT_ID` without a triggering context:

```typescript
export async function sendBriefingDirect(): Promise<void> {
  await bot.telegram.sendMessage(
    config.telegram.brysonChatId,
    formattedMessage,
    { parse_mode: "MarkdownV2" }
  );
}
```

This is used by the [[Reporting Agent]] for the 8:00 AM CST daily briefing and by the [[Escalation System]] for push notifications.

## Error Handling

- **Global error handler** on the bot catches all unhandled errors and logs them via Winston
- **Per-command try/catch** blocks send user-friendly error messages ("Failed to generate briefing. Check logs.")
- **Unauthorized access** is rejected immediately with a generic message (no information leakage)

## Code References

- Bot implementation: `src/telegram/bot.ts`
- Webhook route (fallback): `src/server/routes/webhooks.ts`
- MarkdownV2 helpers: `src/telegram/bot.ts` (`escapeMarkdownV2`, `bold`, `code`)

## Related Pages

- [[Ingestion Agent]] for photo upload processing
- [[Reporting Agent]] for daily briefing delivery
- [[Escalation System]] for escalation message format and tiers
- [[Inbox Agent]] for Telegram sub-agent message processing
- [[Orchestrator]] for command routing
- [[Environment Variables]] for bot configuration
- [[Security]] for chat ID verification details
