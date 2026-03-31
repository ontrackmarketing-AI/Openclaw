---
title: OpenClaw Personal OS
aliases: [Home, Index, Vault Home]
tags: [openclaw, home, index]
created: 2026-03-31
---

# OpenClaw Personal OS

**Version:** 1.0
**Owner:** Bryson Stevens / Helium Solutions
**Status:** Pre-build -- Claude Code ready

OpenClaw is a multi-agent personal operating system built for Bryson Stevens, a solo operator running three interconnected businesses. It functions as an autonomous AI chief of staff that reads handwritten notebooks, monitors inboxes, knows every active project, works autonomously, surfaces only what requires human judgment, and reports back via Telegram.

This is not a chatbot. This is an operating system for a solo operator's business brain.

---

## Architecture

- [[System Overview]] -- Full system architecture and layer diagram
- [[Tech Stack]] -- Every technology choice and why it was made
- [[Data Flow]] -- How data moves through the system end to end

## Agents

- [[Orchestrator]] -- Central brain, event routing, project context
- [[Ingestion Agent]] -- Notebook photos to structured data
- [[Inbox Agent]] -- Gmail, iMessage, Telegram triage
- [[Research Agent]] -- Web search, Drive search, semantic search
- [[Scheduler Agent]] -- Calendar integration and meeting prep
- [[Reporting Agent]] -- Daily briefings and status reports

## Database

- [[PostgreSQL]] -- Structured relational data (source of truth)
- [[Qdrant]] -- Vector embeddings and semantic search
- [[Redis]] -- Queues, caches, and ephemeral state

## Integrations

- [[Gmail Integration]] -- OAuth2 email monitoring and drafting
- [[iMessage Bridge]] -- Mac-based iMessage access
- [[Telegram Bot]] -- Primary user interface
- [[Google Calendar Integration]] -- Calendar context and pre-briefs
- [[Google Drive Integration]] -- Document retrieval and watched folders
- [[GoHighLevel Integration]] -- CRM operations via n8n bridge
- [[n8n Workflows]] -- External automation workflows

## Operations

- [[Escalation System]] -- When and how to interrupt Bryson
- [[Notification Logic]] -- Batching, filtering, priority routing
- [[Security]] -- Secrets, compliance, access control
- [[Deployment]] -- Docker Compose, AWS, infrastructure
- [[Environment Variables]] -- Every env var documented

## Projects & Context

- [[Project Registry]] -- All of Bryson's active projects
- [[Contacts]] -- VIP list and contact resolution

## Development

- [[Build Phases]] -- 8-phase build sequence with dependencies
- [[Decision Log]] -- Architectural decisions and reasoning
- [[Testing Strategy]] -- How to test each component
- [[API Reference]] -- All REST endpoints documented

---

> **Core Principle:** "Only ping Bryson when Bryson is required."
