---
title: Project Registry
aliases: [Projects, Project List, Client Registry]
tags: [projects, registry, clients, businesses]
created: 2026-03-31
---

# Project Registry

Bryson runs three interconnected businesses as a solo operator. This page documents every project tracked by OpenClaw, including status, priority, key contacts, and context.

## Businesses

### Helium Solutions

Bryson's AI marketing automation agency. The parent company for most client work.

### Search Tuners

A referral-based marketing partnership with Mike. Joint venture focused on SEO and digital marketing services.

### OnTrack Marketing

A SaaS product in development. Bryson's long-term product play.

## Project Table

| Project | Business | Client | Priority | Status | Description |
|---|---|---|---|---|---|
| SWRE | Helium Solutions | SWRE | 1 | Active | AI-powered knowledge base with 822K+ Qdrant vectors. OpenClaw has read-only access to SWRE's Qdrant. See [[Qdrant]]. |
| Texas Tree Tops (TTT) | Helium Solutions | Texas Tree Tops | 2 | Active | Arborist company in Austin, TX. Marketing automation and lead generation. |
| Helium Solutions | Helium Solutions | -- | 2 | Active | Agency operations, internal processes, and meta-work (including building OpenClaw). |
| OnTrack Marketing | OnTrack | -- | 2 | Active | SaaS product development. Marketing automation platform. |
| Search Tuners | Search Tuners | -- | 2 | Active | Partnership with Mike. SEO and referral-based marketing. Joint lead tracking. |
| Salon Esby | Helium Solutions | Salon Esby | 3 | Active | Salon client. Appointment booking and marketing. Uses [[GoHighLevel Integration]] for CRM. |
| A to Z Bail Bonds | Helium Solutions | A to Z Bail Bonds | 3 | Active | Bail bonds company. FDCPA/TCPA compliance required for all communications. See [[Security]]. |
| THS Home Solar | Helium Solutions | THS Home Solar | 3 | Active | Solar panel company. Lead generation and marketing automation. |

## Project Details

### SWRE

- **Priority:** 1 (highest)
- **Client:** SWRE
- **Key tech:** Qdrant vector database (822K+ vectors), Node.js/TypeScript
- **OpenClaw integration:** Read-only access to SWRE's Qdrant instance for cross-referencing
- **Key contacts:** (managed in [[Contacts]])
- **Notes:** OpenClaw's codebase shares architectural patterns with SWRE. The [[Research Agent]] can query SWRE's knowledge base for relevant information.

### Texas Tree Tops (TTT)

- **Priority:** 2
- **Client:** Texas Tree Tops (Austin, TX arborist company)
- **Services:** Marketing automation, lead generation, competitive analysis
- **Key contacts:** (managed in [[Contacts]])
- **Notes:** Active client with regular communication. The [[Research Agent]] handles competitor research for TTT.

### Helium Solutions (Internal)

- **Priority:** 2
- **Description:** Agency operations, new client onboarding, process improvement
- **Notes:** OpenClaw itself is a Helium Solutions project. Internal tasks and agency-wide initiatives are tracked here.

### OnTrack Marketing

- **Priority:** 2
- **Description:** SaaS product for marketing automation
- **Status:** In development
- **Notes:** Long-term product play. Development tasks and feature planning tracked as OpenClaw tasks.

### Search Tuners

- **Priority:** 2
- **Partner:** Mike (VIP contact)
- **Description:** Referral-based marketing partnership
- **CRM:** Shared GHL sub-account with Mike
- **Notes:** Mike is a VIP contact -- all messages from Mike trigger immediate escalation. See [[Contacts]].

### Salon Esby

- **Priority:** 3
- **Client:** Salon Esby
- **Services:** Appointment booking, marketing automation
- **CRM:** Dedicated GHL sub-account
- **Notes:** Moderate-touch client. Regular appointment and campaign management.

### A to Z Bail Bonds

- **Priority:** 3
- **Client:** A to Z Bail Bonds
- **Services:** CRM management, lead tracking, marketing
- **Compliance:** FDCPA and TCPA regulations apply. See [[Security]].
- **CRM:** Dedicated GHL sub-account
- **Notes:** All outbound communications must go through approval. No automated messaging to bail bonds contacts.

### THS Home Solar

- **Priority:** 3
- **Client:** THS Home Solar
- **Services:** Lead generation, marketing automation
- **Notes:** Solar industry marketing. Seasonal demand patterns.

## Priority Scale

| Priority | Meaning | Response Time |
|---|---|---|
| 1 | Critical business impact | Same day |
| 2 | Important, revenue-generating | Within 24 hours |
| 3 | Active but lower urgency | Within 48 hours |
| 4 | Maintenance / low activity | Best effort |
| 5 | Archived / paused | No active monitoring |

## Project Context in OpenClaw

The project registry is loaded into the [[Orchestrator]]'s Project Context Store on every invocation. This means every agent has access to:

- Project names and aliases (for fuzzy matching in [[Ingestion Agent]])
- Priority levels (for [[Reporting Agent]] scoring)
- Associated contacts (for [[Inbox Agent]] routing)
- Compliance flags (for [[Security]] checks)

Project data is stored in the [[PostgreSQL]] `projects` table and cached in [[Redis]] (`cache:project_context`, TTL 1 hour).

## Related Pages

- [[Contacts]] for key people per project
- [[PostgreSQL]] for the projects table schema
- [[Orchestrator]] for project context loading
- [[Ingestion Agent]] for fuzzy project matching
- [[GoHighLevel Integration]] for CRM sub-account mapping
- [[Security]] for compliance flags
