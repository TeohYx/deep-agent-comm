# Communication Layer — Tools & Skills

> **Status:** v1 BUILT (updated 2026-06-10). Originally a "menu to build from"; now reflects what is actually implemented.
> **Transport:** Gmail REST API (OAuth2) — migrated from IMAP. See `docs/gmail_channel_functionality.md` for the full per-capability matrix and `docs/answer-for-md.md` for locked decisions.
> **Legend:** ✅ built · ◐ partial · 🔲 planned, not built · ⭕ now reachable on Gmail API, not built · 🚫 withheld (guardrail).

---

## 0. Reminder: tool vs skill (in this system)

| | Tool | Skill |
|---|---|---|
| Is | code that *does* something | prompt/playbook for an *intent* |
| Example | `gmail_create_draft` | `draft-reply` |
| Picked by | the agent, mid-task | the intent classifier, up front |
| Returns | data / side-effect | shapes behavior, orchestrates tools |

A **skill** orchestrates **tools**. E.g. the `draft-reply` skill reads a thread (`gmail_get_thread`), composes text (LLM), and creates a draft (`gmail_create_draft`).

---

## 1. TOOLS — by value

### Tier 1 — Gmail core (P0) — BUILT
The actual Gmail toolset (10 tools). Names below are the real registered tool names. **There is no `gmail_send` — draft-only is enforced by its absence** (decision `answer-for-md.md` #3/#4).

**Read:**
| Tool | Does | Status |
|---|---|---|
| `gmail_search` | full Gmail query syntax (`from:`, `is:unread`, `has:attachment`, `newer_than:`…) — the real abstraction | ✅ |
| `gmail_list_unread` | narrow: most-recent unread only (advertises its narrowness) | ✅ |
| `gmail_get_message` | full body + **HTML body** + attachment metadata by Message-ID; `download=true` materializes sheets | ✅ |
| `gmail_get_thread` | whole conversation, ordered — **native threadId** | ✅ |
| `gmail_get_attachment` | download **any** attachment type by filename | ✅ |

**Write (drafts only — `gmail_send` 🚫 not registered):**
| Tool | Does | Status |
|---|---|---|
| `gmail_create_draft` | reply / new draft; `cc[]` = reply-all; `inReplyTo` threads; `attachmentPaths[]` | ✅ |
| `gmail_forward_draft` | forward draft carrying original body + attachments | ✅ |
| `gmail_update_draft` | in-place draft edit (native `drafts.update`) | ✅ |
| `gmail_list_drafts` / `gmail_delete_draft` | manage drafts as first-class objects | ✅ |

**Organize:**
| Tool | Does | Status |
|---|---|---|
| `gmail_organize` | mark_read/unread, star/unstar, **mark_important/unmark_important**, archive, trash, **restore** | ✅ |
| `gmail_label` | apply/remove a label by name (auto-creates on apply) | ✅ |
| `gmail_manage_labels` | list / create / delete labels | ✅ |
| `gmail_mark_read` | shortcut used by triggers | ✅ |

**Sync:**
| Tool | Does | Status |
|---|---|---|
| `gmail_history` | incremental changes since a `historyId` cursor | ✅ |
| `gmail_watch` | start/stop Pub/Sub push on INBOX | ◐ needs Cloud Pub/Sub topic |

**Settings (need re-consent for `gmail.settings.*` scopes):**
| Tool | Does | Status |
|---|---|---|
| `gmail_filters` | list / create / delete server-side filters | ✅ |
| `gmail_vacation` | get / set vacation auto-responder | ✅ |
| `gmail_sendas` | list aliases / update signature | ✅ |
| `gmail_forwarding` | list forwarding addresses | ✅ |
| `gmail_imap_pop` | get/toggle IMAP & POP access | ✅ |
| `gmail_delegates` | list delegates | ◐ Workspace-only (personal Gmail not supported) |

> Withheld by guardrail: `gmail_send` (draft-only), permanent message delete (destructive).

### Tier 2 — Content / data work (P1) — BUILT
What the agent *does* with email content. Heavy/risky work runs in the **sandbox** via a sub-agent.

| Tool | Does | Sandbox? | Status |
|---|---|---|---|
| `excel_read` | parse .xlsx/.csv → rows (cap 100) | in-process v1 | ✅ |
| `excel_write` | build .xlsx from rows | sub-agent | ✅ |
| `chart_generate` | data → chart PNG (QuickChart) | sub-agent | ✅ |
| `sql_query` | single read-only SELECT vs demo DB | guarded | ✅ |
| `run_code` | run JS in child-process sandbox (fs-locked) | **sub-agent only** | ✅ |
| `spawn_subagent` | delegate to isolated least-privilege sub-agent | — | ✅ |
| `pdf_read` | extract text/tables from PDF | sandbox | 🔲 (.xlsx/.csv only in v1) |
| `http_request` | call external REST API | allow-listed | 🔲 |

### Tier 3 — Extensibility & utility
| Tool | Does | Status |
|---|---|---|
| `web_fetch` | fetch a URL's content | ✅ |
| `calculator` | math | ✅ |
| `echo` | pipeline test | ✅ |
| `mcp_*` | dynamically discovered external tools via MCP | 🔲 (Phase 5b) |

### Tier 4 — Other channels (P2, later)
Same `Channel` interface, different backend — proves the abstraction. The Gmail migration validated the swap (IMAP→API touched only L0).

| Tool | Channel | Status |
|---|---|---|
| `teams_*` | Microsoft Teams | 🔲 |
| `slack_*` | Slack | 🔲 |
| `messenger_*` | Messenger | 🔲 |

---

## 2. SKILLS — by value

Skill frontmatter carries `intent` (for the L1 classifier) and `subagent` (whether it delegates to a sandboxed sub-agent).

### Tier 1 — Email triage & response (P0)
| Skill | Intent | What it does | Tools used | Sub-agent? | Status |
|---|---|---|---|---|---|
| `summarize-thread` | summarize | TL;DR a thread | `gmail_get_thread`, `gmail_create_draft` | no | ✅ |
| `draft-reply` | compose | contextual reply draft | `gmail_get_thread`, `gmail_create_draft` | no | ✅ |
| `clarify` | clarify | fallback when intent unclear → asks sender | `gmail_create_draft` | no | ✅ |
| `triage-inbox` | triage | classify/label/flag unread | `gmail_search`, `gmail_organize` | no | 🔲 |
| `extract-action-items` | extract | pull tasks/dates/asks | `gmail_get_thread` | no | 🔲 |

### Tier 2 — Data tasks from email (P1) — the "wow" features
Need the **sandbox + sub-agent**. This is the "read excel, generate excel, graph" requirement.

| Skill | Intent | What it does | Sub-agent? | Status |
|---|---|---|---|---|
| `excel-to-chart` | visualize | attached sheet → chart PNG → reply draft | **yes** | ✅ |
| `excel-analyze` | analyze | read sheet, answer questions about the data | **yes** | ✅ |
| `data-query` | data-query | NL question → read-only SQL → plain-English reply | no | ✅ |
| `excel-generate` | generate | build a new spreadsheet from a request | **yes** | 🔲 |
| `report-build` | report | gather data + build formatted excel/pdf, attach | **yes** | 🔲 |

### Tier 3 — Integration & proactive
| Skill | Intent | What it does | Status |
|---|---|---|---|
| `inbox-digest` | digest | (schedule 08:00) summarize unread → digest draft | ✅ |
| unanswered-nudge | followup | (schedule 17:30) flag stale unread → nudge draft | ✅ (inline in `triggers/schedule.ts`, not a skill file) |
| `mcp-fetch` | integrate | pull/push to an external system via MCP | 🔲 (Phase 5b) |

---

## 3. The flagship flow — DONE ✅

**"Email an excel, get a chart back."** Proven end-to-end:

```
sender emails sales.xlsx + "chart revenue by month"
   → intent: visualize → skill: excel-to-chart
      → spawn_subagent (sandbox):
          excel_read → analyze → chart_generate
      → reply DRAFT with chart.png attached
```

Verified: `excel_read → chart_generate → gmail_create_draft → gmail_mark_read`, all green. The architecture is proven.

---

## 4. Cross-cutting features every comm tool needs

1. **Threading** — operate on the *thread*, not a lone message. Now **native** (`gmail_get_thread` via `threadId`); replies thread via `In-Reply-To`/`References` + Gmail `threadId`. Web chats get the equivalent via **session memory**: prior turns of the same session are replayed to the agent (capped 8 turns / 2000 chars per result), isolated between sessions (`01-architecture.md` §11). ✅
2. **Draft-by-default** — agent prepares, human sends. Enforced by absence of a send tool. ✅
3. **Idempotency** — never process the same message twice (`processed_messages` dedupe by Gmail id). ✅
4. **Attachment safety** — size caps, .xlsx/.csv allow-list, sub-agent/sandbox handling. ✅
5. **Audit trail** — every run + steps saved to the task store; per-action governance log feeds L6. ◐ (task-level ✅, fine-grained action log 🔲)
6. **Tone / persona control** — skills set reply tone via the prompt mechanism (like `caveman`); drafts signed "Deep Agent (assistant)". ✅
7. **PII awareness (hook for L6)** — flag sensitive data in a message/attachment. 🔲 (governance phase)

---

## 5. Mapping to existing code

| Thing | Where |
|---|---|
| Gmail tools | `src/tools/gmail.ts` → `GmailApiChannel` (`src/channels/gmail-api.ts`) |
| Gmail settings tools | `src/tools/gmail-settings.ts` |
| Data tools | `src/tools/{excel,chart,sql,runCode,subagent}.ts` |
| Skills | `src/skills/*.md` + loader (frontmatter `intent`/`subagent`) |
| Intent routing | `src/intent/classifier.ts` (L1) |
| Reply tone | same mechanism as `caveman` skill |
| Sub-agent | `spawn_subagent` → `runAgent()` with least-privilege toolset |
| Session memory (web chat) | `src/memory/store.ts` (`session_id`), `src/api/server.ts` (`sessionHistory`, `GET /sessions`) |
| Tools/Skills catalog UI | `public/app.js` (`TOOL_CATALOG`/`SKILL_CATALOG` — mirrors this doc; update both together) |

> The communication layer is **new tools + skill files** on the **existing engine**. The Gmail API migration changed only L0.

---

## 6. Decisions (resolved — see `answer-for-md.md`)

1. **Reply tone** — ✅ one default persona, overridable by skill.
2. **First Tier-2 data skill** — ✅ `excel-to-chart` (built, flagship demo proven).
3. **Attachment types** — ✅ .xlsx/.csv only in v1.
4. **Send authority** — ✅ nothing auto-sends; no send tool registered.
5. **Persona** — ✅ named assistant; drafts signed "Deep Agent (assistant)".

### Still open / next
- **Sync upgrade:** Gmail Pub/Sub push to replace the 60s poll (now reachable — `gmail_channel_functionality.md` §4).
- **Settings tools:** filters / vacation / send-as (needs `gmail.settings.*` scope + re-consent — §5).
- **More skills:** triage-inbox, extract-action-items, excel-generate, report-build.
- **MCP client** (Phase 5b) + **Governance** (Phase 6).
