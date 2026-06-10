# Decisions Record — Review Answers

> **Status:** AGREED (2026-06-10)
> Answers to the open questions in `01-architecture.md`, `02-triggers.md`, `03-communication-layer.md`.
> Credentials are stored in `.env` (gitignored) — never in docs.

---

## 01-architecture.md

| # | Question | Decision |
|---|---|---|
| 1 | Channel scope for v1 | **Gmail only**, but `Channel` interface defined from day 1 so other channels (Teams/Slack/Messenger) can be stubbed in later. **Default v1 mailbox: `yeexianteoh1223@gmail.com`** — hard-coded fallback in `src/channels/gmail.ts` (`DEFAULT_GMAIL_USER`), overridable via `GMAIL_USER` env. App password has no default; must be set via `GMAIL_APP_PASSWORD` env. |
| 2 | Sandbox technology | **Node child-process + restricted fs** for v1 (Node `--permission` flag, fs limited to a scratch dir). Move to Docker/E2B when code-exec risk grows. |
| 3 | Auto-send vs draft | **Draft-only** until guardrails (L6) exist. Enforced hard: no `gmail_send` tool is registered at all in v1 — the capability does not exist, so the LLM cannot be tricked into using it. |
| 4 | SQL target | **Read-only** (SELECT-only, single statement) against a local demo SQLite DB for v1. |
| 5 | Low intent confidence | **Clarifying reply** — agent drafts a question back to the sender. |
| 6 | Identity / multi-tenant | **Single Gmail account** for v1. |

### Technical implication of decision #1 — UPDATED 2026-06-10: migrated IMAP → Gmail API

Originally built on **IMAP + app password** (`imapflow`). **Now migrated to the Gmail REST API (OAuth2)** — the swap the architecture planned ("OAuth2 + Gmail API can replace it later without touching anything above L0"). It did exactly that: only L0 changed.
- Transport: `GmailApiChannel` (`src/channels/gmail-api.ts`), scope `gmail.modify`. Auth bootstrap: `src/channels/gmail-oauth.ts` (run once → refresh token in `secrets/gmail.token.json`, gitignored).
- Why migrated: IMAP throttled the account hard (15–47s per op). Gmail API is 1–2.5s, has native threads, and unlocks Sync (History API, Pub/Sub push) + Settings (filters, vacation, send-as) that IMAP structurally cannot do.
- IMAP `GmailChannel` kept dormant in `src/channels/gmail.ts` for reference; swap back = one line.
- Still draft-only: `gmail.modify` technically permits send, but no send tool is registered, so the guardrail holds at the tool level.

---

## 02-triggers.md

| # | Question | Decision |
|---|---|---|
| 1 | Push vs poll | **Poll** for v1. |
| 2 | Allow-list vs open | **Allow-list** (`ALLOWED_SENDERS` in `.env`). All other senders ignored. |
| 3 | Poll interval | **60 seconds**. |
| 4 | Scheduled jobs | **Inbox digest** (8:00 weekdays) + **unanswered-mail nudge** (17:30 weekdays). |
| 5 | Schedule authority | Schedules can **read + draft, never auto-send**. |

---

## 03-communication-layer.md

| # | Question | Decision |
|---|---|---|
| 1 | Reply tone | **One default persona**, overridable by skill. |
| 2 | First Tier-2 data skill | **`excel-to-chart`** (flagship demo: email an excel, get a chart back). |
| 3 | Attachment types | **.xlsx / .csv only** for v1. |
| 4 | Send authority | **Nothing auto-sends in v1** (no send tool registered). |
| 5 | Persona | **Named assistant** — drafts signed "Deep Agent (assistant)", clearly not the human. |

---

## Known v1 simplifications (accepted, revisit later)

1. **Excel parsing runs in-process** (SheetJS with size cap), not in the sandbox. Parsing is data-only; risk accepted for v1. Move into sandbox when hardening.
2. **Node `--permission` sandbox restricts filesystem but not network.** Acceptable for v1; Docker/E2B closes this gap later.
3. **Chart rendering uses QuickChart.io** (external HTTP API) — avoids native canvas build issues on Windows. Data leaves the machine for chart rendering; swap to local rendering when governance lands.
4. **Labels/flags:** v1 marks processed mail as read + tracks Message-IDs in the local store, rather than Gmail labels.
5. **Tool-output cap.** Any tool result over 8KB is truncated before going back into the LLM, and `gmail_list_unread` caps at 20 most-recent unread by default (max 50) — prevents context-window blowouts from large mailboxes.

---

## Build phases (from 01-architecture §10) — now in progress

```
Phase 1  Gmail channel adapter (IMAP poll, parse, draft)        — built
Phase 2  Intent classifier → skill routing                       — built
Phase 3  Sandbox (child process) + sub-agent spawning            — built
Phase 4  excel_read / excel_write / chart_generate               — built
Phase 5  sql_query (read-only)                                   — built
Phase 5b MCP client                                              — next review
Phase 6  Governance (constitution, roles, guardrails, audit)     — later
```
