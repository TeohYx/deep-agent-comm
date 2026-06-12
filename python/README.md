# Deep Agent Platform — LangGraph / deepagents implementation

Python port of the TS platform, rebuilt on [deepagents](https://pypi.org/project/deepagents/)
(LangGraph). Same architecture (L0 channel → L1 intent → L2 deep agent → L3 tools →
L4 sandbox → L5 memory), same HTTP surface, same web UI.

## What maps where

| TS (custom)                          | Python (LangGraph/deepagents)                         |
|--------------------------------------|-------------------------------------------------------|
| `src/core/agent.ts` runAgent loop    | `create_deep_agent()` (deepagents)                     |
| `src/intent/classifier.ts`           | `app/agent/classifier.py` — node in the supervisor graph |
| ad-hoc routing in triggers           | `app/agent/supervisor.py` — StateGraph: classify → agent |
| `src/skills/*.md` prompt injection   | each skill .md becomes a **subagent** (`task` tool delegation) |
| `src/tools/subagent.ts`              | deepagents built-in `task` tool                        |
| session replay in `server.ts`        | LangGraph **checkpointer** (`AsyncSqliteSaver`, thread_id = sessionId) |
| `src/memory/store.ts` (sql.js)       | `app/memory/store.py` (sqlite3) — task records for the UI |
| `src/sandbox/runner.ts` (Node child) | `app/sandbox/runner.py` (python -I subprocess)         |
| Express + public/                    | FastAPI + the same `public/`                           |

Skill markdown files are read from `../src/skills/` — single source of truth,
both implementations share them. Gmail OAuth secrets are also shared
(`secrets/google_oauth_client.json` + `secrets/gmail.token.json`); authorize once
with `npx tsx src/channels/gmail-oauth.ts` and both sides work.

## Run

```powershell
cd python
.venv\Scripts\python.exe -m uvicorn app.main:app --port 3001
```

Requires `DEEPSEEK_API_KEY` (via repo-root `.env` or environment). Server boots
without it; LLM calls fail until set. Default port 3001 (`PY_PORT` env) so it can
run side-by-side with the TS server on 3000.

## Setup from scratch

```powershell
python -m venv python\.venv
python\.venv\Scripts\pip install -r python\requirements.txt
```

## Layout

```
app/
  main.py             FastAPI server (POST /run, /sessions, /tasks, /tools, /skills, /channel/status, static UI)
  config.py           env + shared paths
  core/               model (ChatDeepSeek), skill loader, step extraction
  agent/              classifier (L1), deepagents builder (L2), supervisor graph
  tools/              calculator, echo, web_fetch, excel, chart, sql_query, run_code, gmail_*
  channels/           Gmail REST channel (OAuth, draft-only — no send capability exists)
  sandbox/            python subprocess sandbox (cwd-locked job dirs, 30s timeout)
  memory/             sqlite task store (UI listing); conversation state lives in the checkpointer
  triggers/           email polling loop, APScheduler cron (digest 08:00 wd, nudge 17:30 wd)
data/                 tasks.sqlite, checkpoints.sqlite, demo-data.sqlite (gitignored)
```

## Known deltas vs the TS implementation

- `run_code` executes **Python**, not JS; isolation is `python -I` + private cwd +
  timeout (no OS-level fs permission model like Node's `--permission`).
- Scheduled runs can't shrink the toolset per-run (deepagents fixes tools at build
  time); the restriction is stated in the run's system suffix instead.
- `gmail-settings` tools (filters, vacation, signature, delegates) and Pub/Sub
  watch are not ported yet.
- deepagents adds built-ins the TS side never had: `write_todos` planning and a
  virtual filesystem (`ls`/`read_file`/`write_file`/`edit_file`).
