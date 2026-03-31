---
title: Google Drive Integration
aliases: [Drive, Google Drive, Drive Integration]
tags: [integration, google, drive, documents, watched-folder]
created: 2026-03-31
---

# Google Drive Integration

OpenClaw uses Google Drive for two purposes: retrieving documents during research and watching a designated folder for notebook photos that enter the ingestion pipeline.

## Authentication

Drive access shares the same Google OAuth2 credentials as [[Gmail Integration]] and [[Google Calendar Integration]]. A single refresh token covers all three services.

### Required Scope

| Scope | Purpose |
|---|---|
| `https://www.googleapis.com/auth/drive.readonly` | Read files and folder contents |

This scope is requested alongside Gmail and Calendar scopes during the initial OAuth flow.

## Watched Folder for Notebook Photos

Bryson can drop photos of notebook pages into a specific Google Drive folder instead of sending them through Telegram. This is useful when taking multiple photos from a scanner or when batch-uploading older notebook pages.

### Setup

1. Create a dedicated folder in Google Drive (e.g., "OpenClaw Inbox")
2. Copy the folder ID from the URL
3. Set `GOOGLE_DRIVE_WATCH_FOLDER_ID` in the environment

### Watch Logic

The [[Orchestrator]] periodically checks the watched folder for new files:

1. Query Drive API for files in `GOOGLE_DRIVE_WATCH_FOLDER_ID` modified since last check
2. Filter for image types (JPEG, PNG, HEIC)
3. Download each new image
4. Push to [[Redis]] `queue:ingestion` for processing by the [[Ingestion Agent]]
5. Optionally move processed files to a "Processed" subfolder

### Polling Frequency

The Drive watch runs as part of the Orchestrator's cron schedule. Default: every 15 minutes, aligned with the Gmail polling cycle.

## Document Retrieval for Research

The [[Research Agent]] uses Google Drive as one of its information sources. When researching a project or preparing for a meeting, the agent searches Bryson's Drive for relevant documents.

### Search Capabilities

| Search Type | Drive API Query | Use Case |
|---|---|---|
| By filename | `name contains 'proposal'` | Find specific documents |
| By folder | `'{folder_id}' in parents` | Browse project folders |
| Full-text | `fullText contains 'Texas Tree Tops'` | Search document content |
| By MIME type | `mimeType = 'application/pdf'` | Filter for specific file types |
| By date | `modifiedTime > '2026-01-01'` | Recent documents only |

### Document Types Supported

| Type | MIME Type | Processing |
|---|---|---|
| Google Docs | `application/vnd.google-apps.document` | Export as plain text |
| Google Sheets | `application/vnd.google-apps.spreadsheet` | Export as CSV |
| PDF | `application/pdf` | Download, extract text |
| Images | `image/jpeg`, `image/png` | Download, route to ingestion |
| Plain text | `text/plain` | Download directly |

### Research Flow

1. [[Research Agent]] receives a research query with project context
2. Agent constructs a Drive search query based on the project name, client, and keywords
3. Drive API returns matching files
4. Agent downloads and processes relevant documents
5. Extracted content is fed into Claude for synthesis
6. Results are stored in [[Qdrant]] `bryson_research` collection

## Environment Variables

| Variable | Required | Description |
|---|---|---|
| `GOOGLE_CLIENT_ID` | Yes (for Drive) | Shared OAuth2 client ID |
| `GOOGLE_CLIENT_SECRET` | Yes (for Drive) | Shared OAuth2 client secret |
| `GOOGLE_REDIRECT_URI` | Yes (for Drive) | Shared OAuth2 redirect URI |
| `GOOGLE_REFRESH_TOKEN` | Yes (for Drive) | Shared offline refresh token |
| `GOOGLE_DRIVE_WATCH_FOLDER_ID` | No | Folder ID for notebook photo watching |

See [[Environment Variables]] for the complete list.

## Rate Limits

| Limit | Value |
|---|---|
| Queries per day | 1,000,000,000 |
| Queries per 100 seconds per user | 1,000 |

Drive API quotas are extremely generous. Rate limiting is not a practical concern for this integration.

## Error Handling

| Error | Response |
|---|---|
| OAuth token expired | Automatic refresh via `googleapis` client |
| File not found | Skip, log warning |
| Download failure | Retry once, then skip and log |
| Unsupported file type | Skip with info log |
| Watch folder not configured | Disable folder watching, log info |

## Code References

- Drive client: `src/integrations/` (Google Drive via `googleapis`)
- Configuration: `src/config/index.ts` (`google.driveWatchFolderId`)
- Ingestion queue: [[Redis]] `queue:ingestion`

## Related Pages

- [[Ingestion Agent]] for how watched folder images are processed
- [[Research Agent]] for document retrieval during research
- [[Gmail Integration]] for shared OAuth2 setup
- [[Google Calendar Integration]] for shared OAuth2 setup
- [[Environment Variables]] for configuration
- [[Data Flow]] for how Drive data moves through the system
