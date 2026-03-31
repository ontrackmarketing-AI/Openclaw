---
title: iMessage Bridge
aliases: [iMessage, Mac Bridge, iMessage Integration]
tags: [integration, imessage, mac, bridge, apple]
created: 2026-03-31
---

# iMessage Bridge

iMessage is Apple-only with no official API. The only production-grade solution is a small Node.js server running on a Mac that uses `osascript` to read and send iMessages and exposes a local REST API. This is a known architectural constraint, not a workaround.

## Architecture

```
┌──────────────────┐         Tailscale VPN        ┌─────────────────────┐
│  AWS EC2          │ ◄────────────────────────── │  Mac mini            │
│  (OpenClaw)       │         HTTPS + secret       │  (iMessage Bridge)   │
│                   │ ────────────────────────►   │                      │
│  Inbox Agent      │                              │  Node.js server      │
│                   │                              │  osascript calls     │
│                   │                              │  Messages.app        │
└──────────────────┘                              └─────────────────────┘
```

### Why a Mac Mini Is Required

- iMessage uses Apple's proprietary protocols
- `Messages.app` is the only client
- `osascript` (AppleScript) is the only programmatic interface
- No cloud API, no third-party SDK, no web client
- A Mac mini on 24/7 is the standard setup used by businesses that need iMessage automation

## Bridge Server Endpoints

The bridge exposes a simple REST API:

### GET /messages

Fetch recent messages, optionally filtered by contact.

**Parameters:**

| Parameter | Type | Required | Description |
|---|---|---|---|
| `since` | ISO timestamp | No | Only messages after this time |
| `contact` | string | No | Filter by phone number or Apple ID |
| `limit` | integer | No | Max messages to return (default: 50) |

**Response:**

```json
{
  "messages": [
    {
      "id": "msg_123",
      "sender": "+15551234567",
      "recipient": "+15559876543",
      "text": "Hey, can we move the meeting to 3pm?",
      "timestamp": "2026-03-31T14:30:00Z",
      "is_from_me": false
    }
  ]
}
```

### POST /send

Send an iMessage to a contact.

**Request body:**

```json
{
  "to": "+15551234567",
  "message": "Sure, 3pm works. See you then."
}
```

**Response:**

```json
{
  "success": true,
  "message_id": "msg_456"
}
```

**Gated by:** `ENABLE_IMESSAGE` feature flag. When disabled, the bridge endpoint returns 403.

## Security

### Tailscale

The bridge is only accessible via Tailscale VPN. It is not exposed to the public internet. Both the EC2 instance and the Mac mini must be on the same Tailscale network (tailnet).

See [[Security]] for Tailscale configuration details.

### Shared Secret

Every request to the bridge must include a shared secret in the `Authorization` header:

```
Authorization: Bearer {IMESSAGE_BRIDGE_SECRET}
```

The secret is configured via `IMESSAGE_BRIDGE_SECRET` on both the OpenClaw server and the Mac bridge.

### No Public Exposure

- The bridge binds to `127.0.0.1` or the Tailscale interface only
- No port forwarding, no public DNS
- Firewall rules block all non-Tailscale traffic

## Environment Variables

| Variable | Required | Description |
|---|---|---|
| `IMESSAGE_BRIDGE_URL` | No | URL of the bridge (e.g., `http://100.x.x.x:3001`) |
| `IMESSAGE_BRIDGE_SECRET` | No | Shared secret for authentication |
| `ENABLE_IMESSAGE` | No | Feature flag (default: `false`) |

When `ENABLE_IMESSAGE` is `false`, the [[Inbox Agent]]'s iMessage sub-agent is completely disabled. No polling, no processing, no errors from missing bridge.

## Mac Mini Requirements

| Requirement | Details |
|---|---|
| Hardware | Mac mini (any recent model, M1+ recommended) |
| macOS | 13.0+ (Ventura or later) |
| Apple ID | Signed in to Messages.app with Bryson's Apple ID |
| Power | Always on, connected to power |
| Network | Wired ethernet recommended, Tailscale installed |
| Node.js | 20+ installed for the bridge server |
| Startup | Bridge configured as a Launch Agent (auto-start on boot) |

## Error Handling

| Error | Response |
|---|---|
| Bridge unreachable | Log warning, skip iMessage processing this cycle |
| Auth failure (wrong secret) | Log error, alert via Telegram |
| osascript failure | Retry once, then log and skip |
| Messages.app not signed in | Bridge returns 503, log error |

## Code References

- Bridge URL/secret configuration: `src/config/index.ts` (`imessage.*`)
- Feature flag: `src/config/index.ts` (`features.imessage`)

## Related Pages

- [[Inbox Agent]] for how iMessage content is processed
- [[Security]] for Tailscale and access control
- [[Deployment]] for Mac mini setup
- [[Environment Variables]] for configuration
- [[Contacts]] for phone/handle matching
