# Communication Layer — Most Important Tools & Skills

> **Status:** DRAFT for review
> **Purpose:** Define the highest-value **tools** (actions) and **skills** (intents/playbooks) for a Gmail-first communication agent. This is the menu we'll build from — ranked, not exhaustive.

---

## 0. Reminder: tool vs skill (in this system)

| | Tool | Skill |
|---|---|---|
| Is | code that *does* something | prompt/playbook for an *intent* |
| Example | `gmail_send_draft` | `draft-reply` |
| Picked by | the agent, mid-task | the intent classifier, up front |
| Returns | data / side-effect | shapes behavior, orchestrates tools |

A **skill** orchestrates **tools**. E.g. the `draft-reply` skill reads a thread (`gmail_get_thread`), composes text (LLM), and creates a draft (`gmail_create_draft`).

---

## 1. TOOLS — ranked by value

### Tier 1 — Gmail core (build first, P0)
The minimum set to be a useful email agent.

| Tool | Does | Notes / safety |
|---|---|---|
| `gmail_list_messages` | list inbox / search by query | supports Gmail search syntax (`from:`, `is:unread`, `label:`) |
| `gmail_get_thread` | fetch full thread (all messages) | agent needs full context, not one mail |
| `gmail_get_attachment` | download an attachment | size cap; hand to sandbox, never load blindly |
| `gmail_create_draft` | create a reply **draft** | **SAFE default** — human approves send |
| `gmail_send` | send mail | **GUARDED** — off until guardrails exist |
| `gmail_modify_labels` | add/remove labels, mark read | used to mark threads "handled" |

### Tier 2 — Content / data work (P1)
What the agent *does* with email content. Most run in the **sandbox**.

| Tool | Does | Runs in sandbox? |
|---|---|---|
| `excel_read` | parse .xlsx/.csv → structured rows | yes (untrusted file) |
| `excel_write` | build a .xlsx from data | yes (code exec) |
| `chart_generate` | data → chart image (png) | yes (code exec) |
| `pdf_read` | extract text/tables from PDF | yes (untrusted file) |
| `sql_query` | run SELECT against a DB | guarded; read-only v1 |
| `http_request` | call an external REST API | allow-listed domains only |

### Tier 3 — Extensibility (P1–P2)
| Tool | Does |
|---|---|
| `mcp_*` | dynamically discovered external tools (CRM, calendar, internal systems) via MCP |
| `web_fetch` | fetch a URL's content (already built) |
| `calculator` | math (already built) |

### Tier 4 — Other channels (P2, later)
Same *interface*, different backend — proves the channel abstraction.

| Tool | Channel |
|---|---|
| `teams_send` / `teams_get` | Microsoft Teams |
| `slack_send` / `slack_get` | Slack |
| `messenger_send` | Messenger |

---

## 2. SKILLS — ranked by value

Each skill = an **intent** the sender might have. Skill frontmatter gains two fields: `intent` (for the classifier) and `subagent` (whether it spawns a sandboxed sub-agent).

### Tier 1 — Email triage & response (P0)
The bread and butter.

| Skill | Intent | What it does | Tools used | Sub-agent? |
|---|---|---|---|---|
| `summarize-thread` | summarize | TL;DR a long email thread | `gmail_get_thread` | no |
| `draft-reply` | compose | draft a contextual reply (tone-aware) | `gmail_get_thread`, `gmail_create_draft` | no |
| `triage-inbox` | triage | classify/label unread mail, flag urgent | `gmail_list_messages`, `gmail_modify_labels` | no |
| `extract-action-items` | extract | pull tasks/dates/asks from a thread | `gmail_get_thread` | no |

### Tier 2 — Data tasks from email (P1) — **the "wow" features**
These need the **sandbox + sub-agent** (architecture §6). This is where your "read excel, generate excel, graph" requirement lives.

| Skill | Intent | What it does | Sub-agent? |
|---|---|---|---|
| `excel-to-chart` | visualize | attached sheet → chart image → reply with png | **yes** |
| `excel-analyze` | analyze | read sheet, answer questions about the data | **yes** |
| `excel-generate` | generate | build a new spreadsheet from a request/data | **yes** |
| `data-query` (`sql-answer`) | data-query | NL question → SQL → answer in plain English | yes (guarded) |
| `report-build` | report | gather data + build formatted excel/pdf, attach to reply | **yes** |

### Tier 3 — Integration & proactive (P1–P2)
| Skill | Intent | What it does |
|---|---|---|
| `mcp-fetch` | integrate | pull/push data to an external system via MCP |
| `inbox-digest` | digest | (schedule-triggered) summarize inbox → send digest |
| `unanswered-nudge` | followup | (schedule) find stale threads needing a reply |

---

## 3. The flagship flow — what to demo first

**"Email an excel, get a chart back."** It exercises the whole stack and is visually obvious:

```
sender emails sales.xlsx + "chart revenue by month"
   → intent: visualize → skill: excel-to-chart
      → sub-agent (sandbox):
          excel_read → analyze → chart_generate
      → reply DRAFT with chart.png attached
```

If this works end-to-end, the architecture is proven. Recommend it as the **Phase 3/4 milestone**.

---

## 4. Cross-cutting features every comm tool needs

These aren't tools themselves but properties the layer must have:

1. **Threading** — always operate on the *thread*, not a lone message. Replies stay in-thread.
2. **Draft-by-default** — agent prepares, human sends (until guardrails mature).
3. **Idempotency** — never process the same message twice (dedupe by id).
4. **Attachment safety** — size caps, type checks, sandbox-only handling.
5. **Audit trail** — log every read, draft, send, query (feeds governance later).
6. **Tone / persona control** — a skill should be able to set reply tone (formal, brief, friendly) — reuses the existing skill-prompt mechanism (like `caveman`).
7. **PII awareness (hook for L6)** — flag when a message/attachment contains sensitive data.

---

## 5. Mapping to existing code

| New thing | Reuses what we built |
|---|---|
| Skills above | existing `src/skills/*.md` + loader (just add `intent`/`subagent` frontmatter) |
| Tools above | existing `Tool` interface + registry (`registry.registerTool`) |
| Reply tone | same mechanism as `caveman` skill |
| Sub-agent | extends `runAgent()` in `src/core/agent.ts` |

> The communication layer is mostly **new tools + new skill files** plugged into the **existing engine**. Minimal core change.

---

## 6. Open questions for review

1. **Reply tone** — one default persona, or per-sender/per-context tone? (Recommend: one default, overridable by skill.)
2. **Which Tier-2 data skill first** — `excel-to-chart` (visual, demoable) or `data-query` (SQL)? (Recommend: `excel-to-chart`.)
3. **Attachment types in scope** — just .xlsx/.csv for v1, or pdf/images too? (Recommend: .xlsx/.csv first.)
4. **Send authority** — who/what is ever allowed to trigger `gmail_send` (vs draft)? (Recommend: nothing auto-sends in v1.)
5. **Persona/identity** — does the agent reply *as the user*, or *as a named assistant* ("Sent by Agent on behalf of...")? (Recommend: named assistant — clearer, safer.)
