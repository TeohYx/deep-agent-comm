# Architecture — Communication-Channel Deep Agent

> **Status:** DRAFT for review
> **Scope:** A deep agent whose primary entry point is a communication channel (Gmail first; Messenger / Teams / Slack later). It reads incoming messages, classifies intent, and fulfills tasks using skills, sub-agents, sandboxed code execution, external APIs (MCP), and on-demand SQL.

---

## 1. The one-sentence mental model

> **A message comes in on a channel → the agent figures out what the sender wants (intent) → it runs the right skill → the skill does the work (maybe spawning a sandboxed sub-agent for heavy/risky tasks) → the agent replies back on the same channel.**

Everything else (memory, MCP, SQL, governance) is supporting infrastructure around that loop.

---

## 2. Layered architecture

```
┌──────────────────────────────────────────────────────────────────────┐
│  L0  CHANNEL LAYER  (the "skin" — how the world talks to the agent)    │
│      Gmail adapter ─┬─ Teams adapter ─┬─ Slack adapter ─┬─ Web/UI       │
│      normalize every inbound msg → internal `Message`                  │
│      render every outbound result → channel-native reply               │
└───────────────────────────────┬──────────────────────────────────────┘
                                 │  Message (normalized)
                                 ▼
┌──────────────────────────────────────────────────────────────────────┐
│  L1  INTENT LAYER  (the "router")                                      │
│      LLM classifies Message → Intent → maps to a Skill                 │
│      e.g. "can you turn this sheet into a chart?" → intent:visualize   │
└───────────────────────────────┬──────────────────────────────────────┘
                                 │  Intent + Message
                                 ▼
┌──────────────────────────────────────────────────────────────────────┐
│  L2  ORCHESTRATION LAYER  (the "deep agent loop" — already built)      │
│      runAgent(): think → act → observe → repeat                        │
│      Skill = the playbook for an intent. A skill may:                  │
│        (a) call tools directly                  (light work)           │
│        (b) spawn a SUB-AGENT in a SANDBOX       (heavy/risky work)     │
└──────────────┬────────────────────────────────────┬───────────────────┘
               │                                     │
               ▼ tools                               ▼ sub-agent (isolated)
┌────────────────────────────┐        ┌──────────────────────────────────┐
│  L3  TOOL / CAPABILITY LAYER│        │  L4  SANDBOX                      │
│  - excel_read / excel_write │        │  isolated process / container     │
│  - chart_generate           │        │  runs untrusted work safely:      │
│  - sql_query (on demand)    │        │   - parse email attachments       │
│  - mcp_* (dynamic, external)│        │   - run generated python/code     │
│  - http_request             │        │   - build excel / graphs          │
└────────────────────────────┘        └──────────────────────────────────┘
               │                                     │
               └──────────────────┬──────────────────┘
                                  ▼
┌──────────────────────────────────────────────────────────────────────┐
│  L5  STATE & MEMORY                                                    │
│      task store (SQLite→Postgres), conversation/thread memory,         │
│      vector memory (past emails, learned facts)                        │
├──────────────────────────────────────────────────────────────────────┤
│  L6  GOVERNANCE  (LATER — cross-cutting, wraps every layer)            │
│      constitution · data governance · RBAC/roles · guardrails · audit  │
└──────────────────────────────────────────────────────────────────────┘
```

---

## 3. What we already have vs. what is new

| Layer | Component | Status | File(s) |
|---|---|---|---|
| L2 | Agent loop (think/act/observe) | ✅ built | `src/core/agent.ts` |
| L2 | LLM brain (DeepSeek) | ✅ built | `src/core/llm.ts` |
| L2 | Skill system (prompt-based) | ✅ built | `src/skills/` |
| L3 | Tool system + registry | ✅ built | `src/tools/`, `src/registry/` |
| L5 | Task memory (SQLite) | ✅ built | `src/memory/store.ts` |
| — | HTTP API + Web UI | ✅ built | `src/api/`, `public/` |
| **L0** | **Channel adapters (Gmail…)** | 🔲 new | `src/channels/` |
| **L1** | **Intent classifier** | 🔲 new | `src/intent/` |
| **L2** | **Sub-agent spawning** | 🔲 new | extend `agent.ts` |
| **L4** | **Sandbox runtime** | 🔲 new | `src/sandbox/` |
| **L3** | **excel/chart/sql/MCP tools** | 🔲 new | `src/tools/` |
| **L6** | **Governance** | 🔲 later | `src/governance/` |

> Key point: the **engine (L2) already exists**. New work is mostly **wrapping it** (channels in front, sandbox/tools below).

---

## 4. Core data shape — the `Message`

Everything inbound gets normalized to one shape, so the agent never cares which channel it came from.

```typescript
interface Message {
  id: string
  channel: 'gmail' | 'teams' | 'slack' | 'web'
  threadId: string            // conversation grouping
  from: { name: string; address: string }
  to: string[]
  subject?: string
  body: string                // plain text, cleaned
  attachments: Attachment[]   // excel, pdf, images...
  receivedAt: number
  raw: unknown                // original payload, kept for audit
}

interface Attachment {
  filename: string
  mimeType: string
  sizeBytes: number
  fetch(): Promise<Buffer>    // lazy — don't load until needed
}
```

A reply is the mirror:

```typescript
interface Reply {
  threadId: string
  body: string
  attachments?: OutAttachment[]   // e.g. generated excel / chart png
  mode: 'draft' | 'send'          // SAFETY: default to draft, not auto-send
}
```

**Design decision:** `mode` defaults to `'draft'`. The agent prepares the reply but a human approves the send — at least until guardrails (L6) are mature. (Open question #3.)

---

## 5. Intent → Skill routing (L1)

The intent classifier is itself a small LLM call. It does **not** do the work — it only decides *which skill* handles the message.

```
Message → [LLM classifier] → { intent, confidence, params } → Skill
```

Example mapping table:

| Sender says (email body) | Intent | Skill | Fulfilled by |
|---|---|---|---|
| "Summarize this thread" | `summarize` | `summarize-thread` | tools only |
| "Turn the attached sheet into a bar chart" | `visualize` | `excel-to-chart` | **sub-agent + sandbox** |
| "How many orders shipped last week?" | `data-query` | `sql-answer` | `sql_query` tool |
| "Draft a reply declining politely" | `compose` | `draft-reply` | tools only |
| "Pull latest from <external system>" | `integrate` | `mcp-fetch` | MCP tool |

**Skill = intent's playbook.** This reuses the skill system already built (`src/skills/*.md`), extended with an `intent` field in frontmatter and an optional `subagent: true` flag.

---

## 6. When does a skill spawn a sub-agent? (L2 → L4)

Two execution paths:

```
Skill triggered
   │
   ├─ simple?  ──► run inline in main agent loop (call tools directly)
   │
   └─ heavy / risky / multi-step?  ──► spawn SUB-AGENT in SANDBOX
                                         - own context window
                                         - own tool subset
                                         - isolated filesystem/process
                                         - returns only the result
```

**Spawn a sub-agent when:**
1. **Untrusted input** — parsing an email attachment from outside (could be malicious).
2. **Code execution** — generating + running Python to build an excel/graph.
3. **Long/branching task** — keeps the main agent's context clean; sub-agent does the messy work and reports back a summary.
4. **Different permission scope** — sub-agent gets only the tools it needs (least privilege).

**Why sandbox:** attachments and generated code are the highest-risk surface in the whole system. A sandbox (isolated process / container, no network unless granted, scratch filesystem) contains the blast radius.

> Open question #2: sandbox implementation choice (see §9).

---

## 7. External connectivity — MCP & SQL (L3)

**MCP (Model Context Protocol):** the extensibility escape hatch. Any external system that ships an MCP server becomes available as tools *without code changes* — the registry discovers them at startup. This is how "future tools" plug in.

```
MCP server (e.g. CRM, calendar, internal API)
        │  speaks MCP
        ▼
  mcp client in src/tools/mcp.ts  ──► auto-registers each remote tool
        ▼
  agent sees them like any native tool
```

**SQL on demand:** a `sql_query` tool that the agent calls when a message needs data.
- Starts **read-only** (SELECT only) — write access is a separate, guarded capability.
- Schema is fed to the LLM so it can write correct queries.
- Every query is logged (audit) and (later) checked against data-governance rules in L6.

> Open question #4: which database + read-only vs read-write.

---

## 8. End-to-end trace (concrete)

Sender emails: *"Hi, can you take the attached sales.xlsx and send me back a chart of revenue by month?"*

```
1. Gmail adapter      detects new mail → builds Message (with sales.xlsx attachment)   [L0]
2. Intent classifier  → intent: "visualize", skill: "excel-to-chart"                   [L1]
3. Main agent         skill flagged subagent:true → spawns sub-agent in sandbox        [L2]
4. Sub-agent (sandbox)                                                                  [L4]
      ├─ excel_read(sales.xlsx)            → rows/columns
      ├─ writes + runs python (matplotlib) → revenue_by_month.png
      └─ returns { chartPath, summary }
5. Main agent         builds Reply { body: summary, attachments:[png], mode:'draft' }  [L2]
6. Gmail adapter       creates DRAFT reply in the thread (human approves send)          [L0]
7. Memory             saves task + steps + thread link                                  [L5]
8. (later) Governance  logged the attachment access, the code run, the outbound draft   [L6]
```

---

## 9. Open questions for review (decide before building)

1. **Channel scope for v1** — Gmail only first, or design adapter interface now and stub the rest? (Recommend: Gmail only, but `Channel` interface from day 1.) **DECIDED:** Gmail only; default mailbox `yeexianteoh1223@gmail.com` (`DEFAULT_GMAIL_USER` in `src/channels/gmail.ts`); override via `GMAIL_USER` env. App password must be set via `GMAIL_APP_PASSWORD` env (no default for credentials).
2. **Sandbox technology** — options: Docker container, Node `worker_threads` + `vm`, a microVM (Firecracker), or a hosted code-exec service (e.g. E2B). Trade-off: isolation strength vs. setup complexity on Windows. (Recommend: start with a separate Node child-process + restricted fs for v1; move to Docker/E2B when code-exec risk grows.)
3. **Auto-send vs draft** — should the agent ever send email without human approval? (Recommend: draft-only until guardrails exist.)
4. **SQL target** — which DB, and read-only or read-write for v1? (Recommend: read-only against one known DB.)
5. **Intent confidence threshold** — what happens on low confidence? Ask the sender a clarifying question, or escalate to a human? (Recommend: clarifying reply.)
6. **Identity / multi-tenant** — one Gmail account, or many users each with their own? Changes auth + memory partitioning. (Recommend: single account for v1.)

---

## 10. Build order (proposed)

```
Phase 1  Gmail channel adapter (read inbox, send draft) + Message shape   [L0]
Phase 2  Intent classifier → route to existing skill system               [L1]
Phase 3  Sandbox runtime + sub-agent spawning                             [L4/L2]
Phase 4  excel_read / excel_write / chart_generate tools                  [L3]
Phase 5  sql_query (read-only) + MCP client                               [L3]
Phase 6  Governance: constitution, roles, guardrails, audit               [L6]
```

Each phase is independently demoable. We stop and review between phases.
