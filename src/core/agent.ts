import { v4 as uuid } from 'uuid'
import { callLLM } from './llm.js'
import { AgentContext, LLMMessage, StepRecord, Tool, Skill, MemoryEntry } from './types.js'
import { matchSkills } from '../skills/loader.js'
import { gmailChannel } from '../channels/gmail.js'

const MAX_STEPS = 20

// Static identity facts the agent should know without calling tools.
// Read at module load — env is already loaded by `dotenv/config` in server.ts.
function identityBlock(): string {
  const mailbox = gmailChannel.selfAddress
  return `Your identity (answer directly, do NOT call tools for these facts):
- You are "Deep Agent (assistant)".
- The Gmail mailbox you manage is: ${mailbox}
- Channel: Gmail (IMAP). You can draft replies but cannot send mail — drafts only.
- Allowed senders (whitelist): ${process.env.ALLOWED_SENDERS || '(none configured)'}`
}

class AgentContextImpl implements AgentContext {
  taskId: string
  goal: string
  steps: StepRecord[] = []
  memory: MemoryEntry[] = []
  tools: Tool[]
  skills: Skill[]

  constructor(taskId: string, goal: string, tools: Tool[], skills: Skill[]) {
    this.taskId = taskId
    this.goal = goal
    this.tools = tools
    this.skills = skills
  }

  addStep(step: StepRecord) {
    this.steps.push(step)
  }

  getLastOutput() {
    return this.steps.at(-1)?.output ?? null
  }
}

export interface RunOptions {
  forceSkillNames?: string[]   // activate these skills regardless of trigger match
  maxSteps?: number
  systemSuffix?: string        // extra system-prompt content (e.g. email context rules)
  history?: LLMMessage[]       // prior conversation turns (same session), inserted before the goal
}

export async function runAgent(
  goal: string,
  tools: Tool[],
  skills: Skill[],
  opts: RunOptions = {}
): Promise<{ taskId: string; steps: StepRecord[]; result: string }> {
  const taskId = uuid()
  const ctx = new AgentContextImpl(taskId, goal, tools, skills)

  // Activate skills: trigger-matched + force-activated (intent router), deduped.
  const matched = matchSkills(goal, skills)
  const forced = (opts.forceSkillNames ?? [])
    .map(n => skills.find(s => s.name === n))
    .filter((s): s is Skill => Boolean(s))
  const activeSkills = [...new Map([...matched, ...forced].map(s => [s.name, s])).values()]
  let systemContent = `You are a deep agent. Accomplish the user's goal step by step using the available tools.
Be methodical. When done, respond with a final answer without calling any tool.

${identityBlock()}`

  if (activeSkills.length > 0) {
    const skillBlocks = activeSkills
      .map(s => `### Skill: ${s.name}\n${s.prompt}`)
      .join('\n\n')
    systemContent += `\n\nThe following skill(s) are active for this task. Follow their instructions:\n\n${skillBlocks}`

    ctx.addStep({
      id: uuid(),
      type: 'skill',
      input: { matched: activeSkills.map(s => s.name) },
      output: `Activated ${activeSkills.length} skill(s): ${activeSkills.map(s => s.name).join(', ')}`,
      timestamp: Date.now(),
    })
  }

  if (opts.systemSuffix) systemContent += `\n\n${opts.systemSuffix}`

  const messages: LLMMessage[] = [
    { role: 'system', content: systemContent },
    ...(opts.history ?? []),
    { role: 'user', content: goal },
  ]

  let stepCount = 0
  const maxSteps = opts.maxSteps ?? MAX_STEPS

  while (stepCount < maxSteps) {
    stepCount++

    const response = await callLLM(messages, tools)

    if (response.tool_calls && response.tool_calls.length > 0) {
      messages.push({
        role: 'assistant',
        content: response.content ?? '',
        tool_calls: response.tool_calls,
      } as unknown as LLMMessage)

      for (const tc of response.tool_calls) {
        const tool = tools.find(t => t.name === tc.function.name)
        const args = JSON.parse(tc.function.arguments)

        let toolResult
        if (!tool) {
          toolResult = { success: false, output: null, error: `Tool "${tc.function.name}" not found` }
        } else {
          toolResult = await tool.execute(args)
        }

        ctx.addStep({
          id: uuid(),
          type: 'tool',
          input: { tool: tc.function.name, args },
          output: toolResult,
          timestamp: Date.now(),
          error: toolResult.error,
        })

        // Defensive cap: tool results are sent back into LLM context EVERY
        // subsequent loop iteration, so a fat result (e.g. 100 emails) gets
        // re-paid for each step. Tools should self-cap; this is the safety net.
        const MAX_TOOL_BYTES = 8000
        let serialized = JSON.stringify(toolResult)
        if (serialized.length > MAX_TOOL_BYTES) {
          serialized = JSON.stringify({
            success: toolResult.success,
            error: toolResult.error,
            output: `[truncated: tool returned ${serialized.length} bytes, capped at ${MAX_TOOL_BYTES}. Ask for a smaller result — fewer rows, a limit param, or filter at the source.]`,
          })
        }
        messages.push({
          role: 'tool',
          tool_call_id: tc.id,
          name: tc.function.name,
          content: serialized,
        } as LLMMessage)
      }
    } else {
      const finalAnswer = response.content ?? ''
      ctx.addStep({
        id: uuid(),
        type: 'llm',
        input: messages,
        output: finalAnswer,
        timestamp: Date.now(),
      })
      return { taskId, steps: ctx.steps, result: finalAnswer }
    }
  }

  return { taskId, steps: ctx.steps, result: 'Max steps reached without final answer.' }
}
