// Trigger ② — schedules. Decision: digest (8:00 weekdays) + unanswered-mail
// nudge (17:30 weekdays). Schedules can read + draft, never send (no send tool
// exists). They get a restricted toolset: Gmail read/draft only.

import cron from 'node-cron'
import { runAgent } from '../core/agent.js'
import { registry } from '../registry/index.js'
import { saveTask } from '../memory/store.js'
import { gmailChannel } from '../channels/gmail.js'

const SCHEDULE_TOOL_NAMES = ['gmail_list_unread', 'gmail_create_draft']

async function runScheduled(label: string, goal: string, forceSkill?: string) {
  console.log(`[schedule] running: ${label}`)
  try {
    const tools = registry.listTools().filter(t => SCHEDULE_TOOL_NAMES.includes(t.name))
    const { taskId, steps, result } = await runAgent(goal, tools, registry.listSkills(), {
      forceSkillNames: forceSkill ? [forceSkill] : [],
    })
    await saveTask(taskId, `[schedule] ${label}`, result, steps)
    console.log(`[schedule] ${label} done`)
  } catch (e) {
    console.error(`[schedule] ${label} failed:`, e)
  }
}

export function startSchedules(): void {
  if (!gmailChannel.isConfigured()) {
    console.warn('[schedule] gmail not configured — schedules disabled')
    return
  }

  // Inbox digest — weekdays 08:00
  cron.schedule('0 8 * * 1-5', () =>
    runScheduled(
      'inbox digest',
      `Produce the morning inbox digest. The mailbox owner's address is ${gmailChannel.selfAddress}.`,
      'inbox-digest'
    )
  )

  // Unanswered-mail nudge — weekdays 17:30
  cron.schedule('30 17 * * 1-5', () =>
    runScheduled(
      'unanswered nudge',
      `End-of-day check: call gmail_list_unread. If any unread mail is waiting, create a DRAFT to ${gmailChannel.selfAddress} with subject "Unanswered mail nudge" listing each one (sender — subject — one-line gist) so the owner can deal with them. If inbox is clear, just finish without drafting. Sign "— Deep Agent (assistant)".`
    )
  )

  console.log('[schedule] registered: inbox digest (08:00 wd), unanswered nudge (17:30 wd)')
}
