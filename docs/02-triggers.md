# Trigger Types — How the Agent Wakes Up

> **Status:** v1 BUILT (updated 2026-06-10). ①②④⑤ live; ③⑥ not built. Open questions resolved in `answer-for-md.md`.
> **Purpose:** Catalog every way the deep agent can be started, which ones matter for a Gmail-centric communication agent, and how each maps onto the existing `runAgent()` engine.

---

## 0. The principle

The engine doesn't care who starts it:

```
        TRIGGERS                          ENGINE
   ┌──────────────────┐
   │ inbound email    │──┐
   │ schedule (cron)  │──┤
   │ webhook / push   │──┼──►  runAgent(goal, tools, skills)  ──► result
   │ manual (UI/API)  │──┤
   │ agent → agent    │──┤
   │ state poll       │──┘
   └──────────────────┘
```

A trigger's only job: **build a `goal` / `Message` and call the engine.** Each trigger is a thin adapter. Adding a trigger never touches the core loop.

---

## 1. The six trigger types

### ① Inbound message (PRIMARY for this project)
The sender emails → that *is* the trigger. This is the heart of a communication agent.

```
new Gmail message → Gmail adapter → Message → intent → runAgent()
```

- **Detection mechanism (two options):**
  - **Push (best):** Gmail API `watch` + Google Pub/Sub → near-instant notification on new mail.
  - **Poll (simplest):** check inbox every N seconds via Gmail API.
- **Recommend:** start with **poll** (dead simple, no Pub/Sub setup), move to **push** for production latency.
- **Risk:** loops. If the agent's own reply lands back in the inbox and re-triggers → infinite loop. Must filter out self-sent mail + already-processed message IDs.

### ② Schedule (cron)
Time fires the agent. No human, no message.

```
cron "0 8 * * 1-5" → runAgent("Summarize unread inbox, send me a digest")
```

Use cases here: morning inbox digest, end-of-day unanswered-email report, weekly metrics email.

### ③ Webhook / external event
Some outside system POSTs an event → agent runs.

```
POST /webhook/<source> → build goal from payload → runAgent()
```

Use cases: a form submission, a CRM update, a calendar event, a payment — any of which might warrant an email being composed/sent by the agent.

### ④ Manual (UI / API) — ALREADY BUILT
Human types a goal in the web UI or hits `POST /run`. This is your current trigger. Stays useful for testing, admin tasks, and "do this for me now" requests.

### ⑤ Agent → Agent (sub-agent spawning)
The main agent triggers a sub-agent for heavy/sandboxed work. This is an *internal* trigger (see architecture §6).

```
main agent → spawnSubAgent(goal, limitedTools, sandbox) → result
```

### ⑥ State poll / watcher
Agent watches some state and fires on change. (A generalization of ① if you poll the inbox.)

```
watch: DB table / folder / queue → on new row → runAgent()
```

Lower priority for v1 unless a non-email data source needs reacting to.

---

## 2. Priority for THIS project

| Trigger | Priority | Status | Notes |
|---|---|---|---|
| ① Inbound email | **P0 — core** | ✅ built | 60s poll, allow-list + Message-ID dedupe (`src/triggers/email.ts`). Pub/Sub push reachable via `gmail_watch` (needs Cloud topic). |
| ④ Manual (UI/API) | **P0 — have it** | ✅ built | `POST /run` — now **session-aware**: carries `sessionId`, prior turns replayed as agent memory (see `01-architecture.md` §11). |
| ② Schedule | **P1** | ✅ built | Inbox digest 08:00 + unanswered-nudge 17:30, weekdays (`src/triggers/schedule.ts`). Read + draft only. |
| ⑤ Agent→agent | **P1** | ✅ built | `spawn_subagent` → sandboxed least-privilege sub-agent (`src/tools/subagent.ts`). |
| ③ Webhook | **P2** | 🔲 | Add when a specific external event source appears. |
| ⑥ State poll | **P3** | 🔲 | Only if a non-email data source needs watching. |

---

## 3. Inbound-email trigger — the details that bite

This is the one we must get right. Failure modes:

| Problem | Cause | Mitigation |
|---|---|---|
| **Reply loop** | agent's own mail re-triggers it | dedupe by message-id; ignore mail from self; mark threads "handled" |
| **Double-processing** | poll picks same mail twice | persist processed message-ids in memory store |
| **Spam / junk firing the agent** | every mail triggers a costly LLM run | pre-filter: only act on whitelisted senders OR labeled threads for v1 |
| **Huge attachments** | 50MB excel → memory blowup | size cap; lazy fetch; hand to sandbox, never main process |
| **Latency expectations** | sender expects instant reply | poll interval sets floor; set expectations or use push |
| **Partial thread context** | agent replies without reading the thread | always load full thread into Message context |

**Recommended v1 guard:** the agent only acts on emails that are **(a) from an allow-listed sender** or **(b) carry a specific label** (e.g. `agent`). Everything else is ignored. This caps cost + risk while you learn. Loosen later.

---

## 4. How each trigger maps to code

All triggers live under `src/triggers/` (new folder) and call the same engine.

```typescript
// src/triggers/email.ts  (① inbound)
async function onNewEmail(msg: Message) {
  if (isFromSelf(msg) || alreadyProcessed(msg.id)) return        // loop guard
  if (!isAllowed(msg)) return                                     // allow-list guard
  const { skill } = await classifyIntent(msg)                     // L1
  await runAgent(buildGoal(msg, skill), registry.listTools(), registry.listSkills())
  markProcessed(msg.id)
}

// src/triggers/schedule.ts  (② cron)
cron.schedule('0 8 * * 1-5', () =>
  runAgent('Summarize unread inbox and send me a digest', tools, skills))

// src/api/server.ts  (④ manual — exists today)
app.post('/run', ...)

// src/triggers/webhook.ts  (③ event)
app.post('/webhook/:source', (req, res) => runAgent(goalFrom(req.body), tools, skills))
```

> Note: ① and ② both ultimately produce a `goal` (or `Message`) and call `runAgent`. Same engine, different doorways.

---

## 5. Open questions — RESOLVED (see `answer-for-md.md`)

1. **Push vs poll for Gmail** — ✅ poll for v1 (Pub/Sub push now reachable post-Gmail-API-migration; `gmail_watch` built, needs a Cloud topic).
2. **Allow-list vs open** — ✅ allow-list (`ALLOWED_SENDERS` in `.env`).
3. **Poll interval** — ✅ 60 seconds.
4. **Which schedules** — ✅ inbox digest (08:00 weekdays) + unanswered-mail nudge (17:30 weekdays).
5. **Per-trigger skill restriction** — ✅ schedules read + draft, never auto-send (no send tool exists at all).
