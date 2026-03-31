---
title: Decision Log
aliases: [Decisions, Architecture Decisions, ADR]
tags: [development, decisions, architecture, reasoning]
created: 2026-03-31
---

# Decision Log

Every significant architectural decision in OpenClaw is documented here with the reasoning behind it. These decisions are referenced throughout the documentation via `[[Decision Log#Section Name]]` links.

---

## Multi-Agent vs Monolith

**Decision:** Multi-agent architecture with a central orchestrator.

**Alternatives Considered:**
- Single monolithic agent that handles everything
- Microservices with independent deployment per agent

**Reasoning:**
1. A monolith would need to hold the full context of all projects, all channels, and all processing types in a single prompt. Claude's context window is large but not infinite, and prompt quality degrades with length.
2. Specialist agents can have focused, well-tested prompts that do one thing well.
3. The orchestrator pattern allows adding new agents (e.g., a "bookkeeping agent") without modifying existing ones.
4. Full microservices would be over-engineered for a single-user system. All agents run in the same Node.js process, communicating via function calls, not HTTP.

**Trade-offs:** More code to coordinate agents. Worth it for testability and prompt quality.

---

## Orchestrator Pattern

**Decision:** A single orchestrator agent routes all events and maintains project context.

**Alternatives Considered:**
- Peer-to-peer agent communication (agents call each other directly)
- Event bus (Redis pub/sub, each agent subscribes to relevant events)

**Reasoning:**
1. Without a central orchestrator, every agent needs to know about every other agent.
2. The orchestrator is the only component that loads the full project context. Specialist agents receive only the context they need.
3. A single routing point makes it easy to add logging, rate limiting, and deduplication.
4. Event bus was tempting but adds complexity for a single-user system with predictable event flows.

---

## Mixed Database Strategy

**Decision:** PostgreSQL for structured data, Qdrant for vectors, Redis for ephemeral state.

**Alternatives Considered:**
- PostgreSQL only (with pgvector for embeddings)
- Qdrant only (store everything as vectors with payload)
- MongoDB + Qdrant

**Reasoning:**
1. "Give me all overdue tasks for project TTT" is a relational query. PostgreSQL handles this with an index scan in microseconds.
2. "Find me notes similar to this query" is a vector search. Qdrant handles this with HNSW in milliseconds.
3. pgvector was considered, but it bolts vector search onto a relational engine. At 822K+ vectors (SWRE), performance and resource contention with relational queries become a concern.
4. Redis is already required for BullMQ. Using it for caches and dedup is free additional value.

---

## Qdrant Over pgvector

**Decision:** Dedicated Qdrant instance instead of PostgreSQL pgvector extension.

**Reasoning:**
1. **Separation of concerns** -- Vector workloads do not compete with relational query workloads for CPU, memory, or I/O.
2. **Payload filtering** -- Qdrant natively supports filtering by metadata during vector search (e.g., search notes for project X only).
3. **Existing infrastructure** -- SWRE already runs a Qdrant instance with 822K+ vectors. Operational experience exists.
4. **Scaling independence** -- If vector data grows significantly, Qdrant can be scaled independently without affecting PostgreSQL.
5. **Purpose-built** -- Qdrant is designed from the ground up for approximate nearest neighbor search. pgvector is an extension.

---

## Node.js over Python

**Decision:** Node.js (TypeScript) as the runtime.

**Alternatives Considered:**
- Python (FastAPI + LangChain/CrewAI)
- Go

**Reasoning:**
1. **Async I/O** -- OpenClaw spends most of its time waiting on API calls (Gmail, Telegram, Claude, Qdrant). Node.js's event loop handles this natively without threading complexity.
2. **Ecosystem** -- Mature SDKs for every service: `googleapis`, `telegraf`, `@anthropic-ai/sdk`, `@qdrant/js-client-rest`, `bullmq`.
3. **Existing codebase** -- SWRE is built in Node.js/TypeScript. Bryson and collaborators already know the stack.
4. **TypeScript** -- Zod validation at boundaries, strong typing for agent interfaces, catches bugs before runtime.
5. **Single language** -- Frontend (if ever needed), backend, and configuration all in TypeScript.

---

## No LangChain or CrewAI

**Decision:** Direct Anthropic SDK calls instead of LangChain, CrewAI, or other agent frameworks.

**Alternatives Considered:**
- LangChain.js for agent orchestration
- CrewAI (Python) for multi-agent coordination
- AutoGen (Python) for multi-agent conversation

**Reasoning:**
1. **Abstraction cost** -- LangChain adds layers of abstraction that make debugging harder. When an agent produces wrong output, you need to understand both your code and LangChain's internals.
2. **Prompt control** -- Direct SDK calls give full control over prompts, system messages, and response parsing. No framework magic.
3. **Dependency weight** -- LangChain has a large dependency tree. OpenClaw's agent logic is simpler than what LangChain is designed for.
4. **CrewAI/AutoGen** -- These assume multi-agent conversation, where agents talk to each other. OpenClaw uses a hub-and-spoke model (orchestrator + specialists), not peer-to-peer.
5. **Maintainability** -- Direct API calls are easier to understand, test, and debug. The team does not need to learn a framework.

---

## Gmail Send Disabled by Default

**Decision:** `ENABLE_GMAIL_SEND` defaults to `false`. The system drafts replies but does not send them autonomously.

**Reasoning:**
1. **Reputation risk** -- An AI sending emails as Bryson, if it makes a mistake, directly damages client relationships.
2. **Compliance** -- Some of Bryson's clients are in regulated industries (bail bonds, debt recovery). Automated outbound communications could create FDCPA or TCPA compliance issues.
3. **Trust building** -- The draft-then-approve pattern lets Bryson verify the system is producing good output before giving it send access.
4. **Reversibility** -- A bad draft can be deleted. A sent email cannot be unsent.
5. **Incremental enablement** -- Once the system has proven reliable over weeks, Bryson can enable sending with confidence.

---

## Telegram Over Web App

**Decision:** Telegram as the primary user interface instead of a custom web dashboard.

**Alternatives Considered:**
- Custom web app (React/Next.js)
- Slack bot
- iOS app

**Reasoning:**
1. **Zero additional app** -- Bryson already has Telegram on his phone. No new app to install or maintain.
2. **Push notifications** -- Telegram handles push notifications natively across all platforms.
3. **Inline keyboards** -- One-tap approvals without typing. Perfect for "approve draft / dismiss / handle myself" workflows.
4. **Rich media** -- Photo uploads for notebook ingestion work natively.
5. **Development speed** -- A Telegram bot takes days to build. A web app takes weeks and needs hosting, auth, responsive design, and ongoing maintenance.
6. **Slack** was considered but adds a monthly cost and is designed for teams, not solo operators.

---

## Mac Mini for iMessage

**Decision:** A dedicated Mac mini running a Node.js bridge server for iMessage access.

**Alternatives Considered:**
- Skip iMessage entirely
- Use a third-party iMessage API service (BlueBubbles, AirMessage)

**Reasoning:**
1. **No alternative** -- Apple provides no iMessage API. The only programmatic access is via `osascript` on macOS.
2. **Business necessity** -- Many of Bryson's client communications happen via iMessage. Ignoring it means missing critical messages.
3. **BlueBubbles/AirMessage** -- These are open-source projects that also require a Mac. They add complexity without significant benefit over a direct bridge.
4. **Cost** -- A Mac mini is a one-time purchase (~$599). Bryson may already have one available.
5. **Reliability** -- A simple Express server calling `osascript` is easy to debug and maintain.

---

## SWRE Read-Only

**Decision:** OpenClaw has strictly read-only access to the SWRE Qdrant instance.

**Reasoning:**
1. **Data integrity** -- SWRE's 822K+ vectors represent years of accumulated business data. A write bug in OpenClaw could corrupt this.
2. **Compliance** -- SWRE handles debtor data subject to FDCPA. OpenClaw should never modify this data.
3. **Namespace separation** -- OpenClaw's data and SWRE's data serve different purposes. Mixing writes would blur this boundary.
4. **Enforcement** -- The SWRE Qdrant client in `src/db/qdrant.ts` is configured to only use `search()` and `scroll()` operations. No `upsert()`, `delete()`, or schema modification methods are exposed.

---

## Redis for Ephemeral State

**Decision:** Redis for queues, caches, deduplication, and rate limiting.

**Reasoning:**
1. **BullMQ dependency** -- BullMQ (the job queue library) requires Redis. Once Redis is in the stack, it makes sense to use it for other ephemeral patterns.
2. **Sub-millisecond reads** -- Deduplication checks (`EXISTS webhook:dedup:...`) need to be fast because they run on every incoming message.
3. **TTL support** -- Caches, dedup keys, and rate limit counters all need automatic expiration. Redis TTL handles this natively.
4. **Persistence optional** -- Redis data is ephemeral by design. If Redis restarts, dedup keys are lost (acceptable -- a few duplicate messages will be reprocessed), and caches are rebuilt from PostgreSQL.

---

## Feature Flags

**Decision:** All write operations to external services are gated by feature flags that default to `false`.

**Flags:** `ENABLE_GMAIL_SEND`, `ENABLE_IMESSAGE`, `ENABLE_GHL_WRITE`.

**Reasoning:**
1. **Safety** -- New autonomous systems should prove themselves before being given write access to production services.
2. **Testability** -- Developers can work on the full codebase without needing live Gmail, iMessage, or GHL credentials.
3. **Gradual rollout** -- Each integration can be enabled independently as it is tested and trusted.
4. **Rollback** -- If an integration causes problems, it can be disabled with a single environment variable change, no code deploy needed.

---

## n8n for External Bridges

**Decision:** Use n8n for GHL integration and Gmail polling instead of direct API calls.

**Reasoning:**
1. **GHL sub-account routing** -- Each business has its own GHL location. n8n manages the per-location credentials and routing logic visually.
2. **Visual debugging** -- n8n execution logs show the exact payload at each step. Debugging a failed GHL sync is trivial compared to digging through Node.js logs.
3. **Decoupling** -- If GHL's API changes, only the n8n workflow needs updating. OpenClaw's webhook handler stays the same.
4. **Gmail redundancy** -- n8n polls Gmail independently of OpenClaw's cron scheduler, providing a fallback.

---

## Why Not Serverless

**Decision:** EC2 instance with Docker Compose instead of AWS Lambda / serverless.

**Reasoning:**
1. **Long-running processes** -- BullMQ workers, Telegram bot (polling mode), and cron jobs need persistent processes. Lambda's 15-minute timeout is insufficient.
2. **Cold starts** -- Claude API calls take 5-15 seconds. Adding Lambda cold starts (1-5 seconds) would degrade the user experience further.
3. **Connection management** -- PostgreSQL, Redis, and Qdrant connections would need to be established on every Lambda invocation, adding latency and risking connection pool exhaustion.
4. **Complexity** -- A single EC2 instance with Docker Compose is conceptually simple. Lambda + SQS + API Gateway + DynamoDB (or RDS Proxy) is architecturally complex for a single-user system.
5. **Cost** -- At OpenClaw's usage level (~constant low traffic, not bursty), EC2 is cheaper than equivalent Lambda invocations.

---

## Claude as Primary LLM

**Decision:** Anthropic Claude as the primary LLM for all agent reasoning.

**Reasoning:**
1. **Reasoning quality** -- Claude excels at complex triage decisions, nuanced intent classification, and following detailed instructions.
2. **Structured output** -- Claude reliably produces well-formed JSON when asked, which is critical for agent pipelines that parse LLM output.
3. **Vision** -- Claude's vision capabilities power the notebook ingestion pipeline (handwriting recognition).
4. **Context window** -- 200K token context window allows feeding extensive project context without truncation.
5. **OpenAI for embeddings** -- `text-embedding-3-small` offers the best cost-to-quality ratio for semantic search. Embedding generation does not require reasoning capabilities.

## Related Pages

- [[System Overview]] for how these decisions shape the architecture
- [[Tech Stack]] for the resulting technology choices
- [[Build Phases]] for implementation sequence
- [[Security]] for security-related decisions
