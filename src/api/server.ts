import 'dotenv/config'
import express from 'express'
import path from 'path'
import { fileURLToPath } from 'url'
import { randomUUID } from 'crypto'
import { runAgent } from '../core/agent.js'
import { LLMMessage } from '../core/types.js'
import { registry } from '../registry/index.js'
import { saveTask, getTask, listTasks, listSessions, listSessionTasks } from '../memory/store.js'

import { calculatorTool } from '../tools/calculator.js'
import { webFetchTool } from '../tools/webFetch.js'
import { echoTool } from '../tools/echo.js'
import { gmailTools } from '../tools/gmail.js'
import { gmailSettingsTools } from '../tools/gmail-settings.js'
import { gmailChannel } from '../channels/gmail.js'
import { excelReadTool, excelWriteTool } from '../tools/excel.js'
import { chartGenerateTool } from '../tools/chart.js'
import { sqlQueryTool } from '../tools/sql.js'
import { spawnSubagentTool } from '../tools/subagent.js'
import { loadSkills } from '../skills/loader.js'
import { startEmailTrigger, emailTriggerStatus } from '../triggers/email.js'
import { startSchedules } from '../triggers/schedule.js'

// NOTE: run_code is NOT registered here — only sub-agents get it (least privilege).
// NOTE: there is NO gmail_send tool anywhere — draft-only enforced by absence.
registry.registerTool(calculatorTool)
registry.registerTool(webFetchTool)
registry.registerTool(echoTool)
for (const t of gmailTools) registry.registerTool(t)
for (const t of gmailSettingsTools) registry.registerTool(t)   // need settings scopes (re-consent)
registry.registerTool(excelReadTool)
registry.registerTool(excelWriteTool)
registry.registerTool(chartGenerateTool)
registry.registerTool(sqlQueryTool)
registry.registerTool(spawnSubagentTool)

// Auto-load all skill markdown files from src/skills/
for (const skill of loadSkills()) registry.registerSkill(skill)

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const PUBLIC_DIR = path.resolve(__dirname, '../../public')

const app = express()
app.use(express.json())
app.use(express.static(PUBLIC_DIR))

// Session memory: prior turns of the same session are replayed as plain
// user/assistant messages. Capped so long sessions don't blow the context.
const HISTORY_MAX_TURNS = 8
const HISTORY_MAX_RESULT_CHARS = 2000

async function sessionHistory(sessionId: string): Promise<LLMMessage[]> {
  const prior = await listSessionTasks(sessionId)
  return prior.slice(-HISTORY_MAX_TURNS).flatMap((t): LLMMessage[] => [
    { role: 'user', content: String(t.goal ?? '') },
    { role: 'assistant', content: String(t.result ?? '').slice(0, HISTORY_MAX_RESULT_CHARS) },
  ])
}

app.post('/run', async (req, res) => {
  const { goal, sessionId: requestedSession } = req.body
  if (!goal) return res.status(400).json({ error: 'goal required' })

  // No sessionId → new session. With sessionId → continue it with memory.
  const sessionId = typeof requestedSession === 'string' && requestedSession ? requestedSession : randomUUID()

  try {
    const history = requestedSession ? await sessionHistory(sessionId) : []
    const { taskId, steps, result } = await runAgent(
      goal,
      registry.listTools(),
      registry.listSkills(),
      { history }
    )
    await saveTask(taskId, goal, result, steps, sessionId)
    res.json({ taskId, sessionId, result, steps })
  } catch (e: any) {
    res.status(500).json({ error: e.message })
  }
})

app.get('/sessions', async (_req, res) => {
  res.json(await listSessions())
})

app.get('/sessions/:id', async (req, res) => {
  res.json(await listSessionTasks(req.params.id))
})

app.get('/tasks/:id', async (req, res) => {
  const task = await getTask(req.params.id)
  if (!task) return res.status(404).json({ error: 'not found' })
  res.json(task)
})

app.get('/tasks', async (_req, res) => {
  res.json(await listTasks())
})

app.get('/tools', (_req, res) => {
  res.json(registry.listTools().map(t => ({ name: t.name, description: t.description })))
})

app.get('/skills', (_req, res) => {
  res.json(
    registry.listSkills().map(s => ({
      name: s.name,
      description: s.description,
      intent: s.intent,
      subagent: s.subagent,
    }))
  )
})

// Channel / trigger status
app.get('/channel/status', (_req, res) => {
  res.json({
    gmail: {
      configured: gmailChannel.isConfigured(),
      user: gmailChannel.selfAddress,    // effective user (env or default fallback)
      defaulted: !process.env.GMAIL_USER,
      trigger: emailTriggerStatus,
    },
  })
})

const PORT = process.env.PORT ?? 3000
app.listen(PORT, () => {
  console.log(`Deep Agent Platform running on http://localhost:${PORT}`)
  startEmailTrigger()
  startSchedules()
})
