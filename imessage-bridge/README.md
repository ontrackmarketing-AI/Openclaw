# OpenClaw iMessage Bridge

A standalone Node.js Express server that runs on a Mac mini and exposes iMessage
read/send capabilities over a secured HTTP API. Designed to be called by the
main OpenClaw Personal OS backend over a Tailscale private network.

## Requirements

- **macOS** (Ventura 13.0+ recommended for sqlite3 `-json` support)
- **Node.js 20+**
- **Full Disk Access** granted to Terminal (or whichever process runs the bridge)
- **iMessage** signed in and functional on the Mac

## Setup

### 1. Install dependencies

```bash
cd imessage-bridge
npm install
```

### 2. Configure environment

```bash
cp .env.example .env
```

Edit `.env` and set a strong shared secret:

```
PORT=4000
BRIDGE_SECRET=some-long-random-secret
BIND_ADDRESS=0.0.0.0
```

Generate a good secret:

```bash
openssl rand -hex 32
```

### 3. Grant Full Disk Access

The bridge reads `~/Library/Messages/chat.db` directly. macOS requires
**Full Disk Access** for any process that touches this file.

1. Open **System Settings > Privacy & Security > Full Disk Access**.
2. Click the **+** button and add **Terminal.app** (or **iTerm**, or whichever
   terminal you use).
3. If running via `launchd`, add `/usr/local/bin/node` (or the output of
   `which node`) instead.
4. Restart Terminal after granting access.

You can verify access with:

```bash
sqlite3 ~/Library/Messages/chat.db "SELECT COUNT(*) FROM message;"
```

If you get a permission error, Full Disk Access is not yet working.

### 4. Start the bridge

```bash
npm start
```

For development with auto-reload:

```bash
npm run dev
```

## Auto-Start with launchd

Create `~/Library/LaunchAgents/com.openclaw.imessage-bridge.plist`:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN"
  "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>com.openclaw.imessage-bridge</string>
  <key>ProgramArguments</key>
  <array>
    <string>/usr/local/bin/node</string>
    <string>/Users/YOUR_USER/openclaw/imessage-bridge/src/index.js</string>
  </array>
  <key>WorkingDirectory</key>
  <string>/Users/YOUR_USER/openclaw/imessage-bridge</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PORT</key>
    <string>4000</string>
    <key>BRIDGE_SECRET</key>
    <string>your-secret-here</string>
    <key>BIND_ADDRESS</key>
    <string>0.0.0.0</string>
  </dict>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>StandardOutPath</key>
  <string>/tmp/imessage-bridge.out.log</string>
  <key>StandardErrorPath</key>
  <string>/tmp/imessage-bridge.err.log</string>
</dict>
</plist>
```

Load it:

```bash
launchctl load ~/Library/LaunchAgents/com.openclaw.imessage-bridge.plist
```

Check status:

```bash
launchctl list | grep imessage
```

## Tailscale Setup (Recommended)

The bridge should **not** be exposed to the public internet. Use Tailscale to
create a secure private network between your server and the Mac mini.

1. Install Tailscale on both machines: <https://tailscale.com/download>
2. Sign in on both machines to the same Tailnet.
3. Find the Mac mini's Tailscale IP: `tailscale ip -4`
4. In the main OpenClaw backend, set `IMESSAGE_BRIDGE_URL` to
   `http://<tailscale-ip>:4000`
5. Optionally set `BIND_ADDRESS=100.x.y.z` in the bridge `.env` to bind only
   to the Tailscale interface.

Tailscale ACLs can further restrict which machines are allowed to reach port
4000.

## API Reference

All endpoints except `/health` require the `x-bridge-secret` header.

### GET /health

Returns bridge status. No authentication required.

```bash
curl http://localhost:4000/health
```

```json
{ "status": "ok", "platform": "darwin" }
```

### GET /messages

Read recent messages for a contact.

| Query param | Required | Default | Description                    |
|-------------|----------|---------|--------------------------------|
| `contact`   | yes      | —       | Phone number or email address  |
| `limit`     | no       | 20      | Number of messages to return   |

```bash
curl -H "x-bridge-secret: YOUR_SECRET" \
  "http://localhost:4000/messages?contact=%2B15551234567&limit=10"
```

```json
{
  "messages": [
    {
      "text": "Hey, are you free tomorrow?",
      "isFromMe": false,
      "date": "2026-03-30 14:22:01",
      "handle": "+15551234567"
    }
  ]
}
```

### POST /send

Send an iMessage.

```bash
curl -X POST http://localhost:4000/send \
  -H "Content-Type: application/json" \
  -H "x-bridge-secret: YOUR_SECRET" \
  -d '{"to": "+15551234567", "message": "Hello from OpenClaw!"}'
```

```json
{ "status": "sent", "to": "+15551234567" }
```

### GET /contacts

List recent iMessage contacts.

| Query param | Required | Default | Description                        |
|-------------|----------|---------|------------------------------------|
| `limit`     | no       | 50      | Number of contacts to return       |

```bash
curl -H "x-bridge-secret: YOUR_SECRET" \
  "http://localhost:4000/contacts?limit=20"
```

```json
{
  "contacts": [
    {
      "handle": "+15551234567",
      "displayName": "+15551234567",
      "lastMessageDate": "2026-03-30 14:22:01",
      "messageCount": 142
    }
  ]
}
```

## Security Notes

- **Never expose this server to the public internet.** Always use Tailscale or
  a VPN.
- The `BRIDGE_SECRET` is a shared secret between the main backend and this
  bridge. Treat it like a password.
- Contact inputs are validated against a strict character whitelist to prevent
  SQL injection against `chat.db`.
- AppleScript strings are escaped to prevent command injection.
- The `osascript` call for sending messages passes the script via stdin rather
  than shell arguments to avoid shell-escaping vulnerabilities.
- The sqlite3 database is opened in read-only mode (`-readonly` flag).

## Troubleshooting

| Symptom | Fix |
|---------|-----|
| `iMessage database not found` | Ensure you are on macOS and iMessage is signed in |
| `Database query failed` | Grant Full Disk Access to the process running Node |
| `Failed to send iMessage` | Make sure Messages.app is running and signed in |
| `osascript` timeout | Messages.app may be hung — restart it |
