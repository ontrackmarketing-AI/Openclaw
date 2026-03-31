---
title: Project Registry
aliases: [Projects, Project List, Active Projects]
tags: [projects, registry, clients, businesses]
created: 2026-03-31
---

# Project Registry

Bryson manages 8 active projects across three interconnected businesses. Every agent in OpenClaw uses this registry to match incoming data to the correct project context. The registry is stored in the [[PostgreSQL]] `projects` table and cached in [[Redis]] by the [[Orchestrator]].

## Businesses

Bryson operates three businesses:

| Business | Role | Primary Focus |
|---|---|---|
| **SWRE (SW Recovery Services)** | Owner/Operator | Debt recovery services |
| **Helium Solutions** | Owner | Technology consulting and development |
| **OnTrack Marketing** | Owner/Partner | Digital marketing agency |

## Active Projects

### SWRE

| Field | Value |
|---|---|
| **Project Name** | SWRE |
| **Full Name** | SW Recovery Services |
| **Priority** | 1 (highest) |
| **Status** | Active |
| **Client** | SW Recovery Services (Bryson's company) |
| **Known Abbreviations** | SWRE, SW Recovery, SWR |
| **Key Contacts** | Internal team |
| **Notes** | Primary revenue source. Has existing Qdrant instance with 822K+ vectors. OpenClaw has read-only access to SWRE data. FDCPA/TCPA compliance required -- no debtor PII in OpenClaw databases. See [[Security]]. |
| **GHL Sub-Account** | SW Recovery Services location |

### Texas Tree Tops (TTT)

| Field | Value |
|---|---|
| **Project Name** | Texas Tree Tops |
| **Priority** | 2 |
| **Status** | Active |
| **Client** | Daniel Sanchez |
| **Known Abbreviations** | TTT, Tree Tops, Texas Trees |
| **Key Contacts** | Daniel Sanchez (VIP) |
| **Notes** | Arborist/tree service business. Daniel is a frequent communicator and VIP contact. |

### Helium Solutions

| Field | Value |
|---|---|
| **Project Name** | Helium Solutions |
| **Priority** | 1 (highest) |
| **Status** | Active |
| **Client** | Helium Solutions (Bryson's company) |
| **Known Abbreviations** | Helium, HS |
| **Key Contacts** | Internal |
| **Notes** | Technology consulting business. OpenClaw itself is a Helium Solutions project. |

### OnTrack Marketing

| Field | Value |
|---|---|
| **Project Name** | OnTrack Marketing |
| **Priority** | 2 |
| **Status** | Active |
| **Client** | OnTrack Marketing (Bryson's company) |
| **Known Abbreviations** | OnTrack, OTM, On Track |
| **Key Contacts** | Internal + client roster |
| **Notes** | Digital marketing agency. Manages campaigns and leads for clients. |

### Search Tuners

| Field | Value |
|---|---|
| **Project Name** | Search Tuners |
| **Priority** | 2 |
| **Status** | Active |
| **Client** | Partnership |
| **Partner** | Mike (VIP) |
| **Known Abbreviations** | Search Tuners, ST |
| **Key Contacts** | Mike (VIP, business partner) |
| **Notes** | SEO/search marketing partnership with Mike. Revenue-sharing arrangement. Mike is VIP -- all communications trigger immediate escalation. |

### Salon Esby

| Field | Value |
|---|---|
| **Project Name** | Salon Esby |
| **Priority** | 3 |
| **Status** | Active |
| **Client** | Salon Esby |
| **Known Abbreviations** | Salon, Esby |
| **Key Contacts** | Salon owner |
| **Notes** | Salon/beauty business client. Lower priority but active project. |

### A to Z Bail Bonds

| Field | Value |
|---|---|
| **Project Name** | A to Z Bail Bonds |
| **Priority** | 3 |
| **Status** | Active |
| **Client** | A to Z Bail Bonds |
| **Known Abbreviations** | A to Z, Bail Bonds, AtoZ, A2Z |
| **Key Contacts** | Business owner |
| **Notes** | Bail bonds business. Regulated industry -- TCPA compliance applies to any automated outreach. See [[Security]]. |

### THS Home Solar

| Field | Value |
|---|---|
| **Project Name** | THS Home Solar |
| **Priority** | 3 |
| **Status** | Active |
| **Client** | THS Home Solar |
| **Known Abbreviations** | THS, Home Solar, Solar |
| **Key Contacts** | Business owner |
| **Notes** | Residential solar installation business. |

## Priority Scale

| Priority | Meaning | Notification Behavior |
|---|---|---|
| **1** | Critical business operations | Items always surface in briefing; overdue tasks trigger immediate escalation |
| **2** | Active client work | Items surface in briefing; overdue tasks included in daily report |
| **3** | Maintenance / lower activity | Items batched; only escalated if explicitly urgent |

## Project Matching

The [[Ingestion Agent]] uses Fuse.js fuzzy matching to resolve handwritten project references against this registry. The matching considers:

- `name` field (project name)
- `client` field (client name)
- Known abbreviations (stored in `metadata` JSONB column)

Match threshold: 0.4 (Fuse.js score). Matches below threshold are flagged as ambiguous and sent to Bryson for clarification.

| Written in Notebook | Matched To | Confidence |
|---|---|---|
| "TTT" | Texas Tree Tops | High (0.95) |
| "SWRE" | SWRE | Exact (1.0) |
| "ontrack" | OnTrack Marketing | High (0.88) |
| "helium" | Helium Solutions | High (0.92) |
| "bail bonds" | A to Z Bail Bonds | Medium (0.85) |
| "solar" | THS Home Solar | Medium (0.80) |
| "the thing Mike" | Search Tuners | Low -- needs clarification |

## PostgreSQL Schema

Projects are stored in the `projects` table. See [[PostgreSQL]] for the full schema.

Key fields: `name`, `client`, `status`, `priority`, `metadata` (JSONB for abbreviations, URLs, tech stack notes).

## Code References

- Project repository: `src/db/repositories/projects.ts`
- Fuzzy matching: Fuse.js in `src/agents/ingestion/index.ts`
- Context caching: [[Redis]] `cache:project_context`

## Related Pages

- [[Orchestrator]] for project context loading
- [[Ingestion Agent]] for fuzzy project matching
- [[Contacts]] for project-associated contacts
- [[Reporting Agent]] for project snapshots in daily briefing
- [[PostgreSQL]] for the `projects` table schema
- [[GoHighLevel Integration]] for project-to-GHL mapping
- [[Security]] for SWRE compliance requirements
