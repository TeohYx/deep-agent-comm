// Trigger ① — inbound email. Polls Gmail every POLL_INTERVAL_MS, applies the
// guard chain (self-filter → dedupe → allow-list), classifies intent, runs the
// agent with the matched skill, marks the mail read + processed.

import { runAgent } from '../core/agent.js'
import { registry } from '../registry/index.js'
import { classifyIntent } from '../intent/classifier.js'
import { gmailChannel } from '../channels/gmail.js'
import { ChannelMessage } from '../channels/types.js'
import { saveTask, isProcessed, markProcessed } from '../memory/store.js'

const POLL_MS = Number(process.env.POLL_INTERVAL_MS ?? 60_000)

const allowList = (process.env.ALLOWED_SENDERS ?? '')
  .split(',')
  .map(s => s.trim().toLowerCase())
  .filter(Boolean)

let timer: NodeJS.Timeout | null = null
let polling = false
export const emailTriggerStatus = {
  enabled: false,
  lastPollAt: 0,
  lastError: '',
  processedCount: 0,
}

function buildGoal(msg: ChannelMessage): string {
  const attachLines = msg.attachments
    .map(a => `- ${a.filename} (${a.mimeType}, ${a.sizeBytes} bytes) at local path: ${a.localPath}`)
    .join('\n')

  return `You received an inbound email. Handle it according to your active skill.

From: ${msg.from.name} <${msg.from.address}>
Subject: ${msg.subject}
Message-ID (use as inReplyTo when drafting the reply): ${msg.id}
Attachments:
${attachLines || '(none)'}

Email body:
"""
${msg.body.slice(0, 6000)}
"""`
}

const EMAIL_RULES = `You are handling email on behalf of the mailbox owner as a named assistant ("Deep Agent").
Hard rules:
- You can ONLY create drafts (gmail_create_draft). Sending mail is impossible — never claim you sent anything; say a draft was prepared.
- Reply in-thread: always pass the original Message-ID as inReplyTo.
- Sign drafts "— Deep Agent (assistant)".
- Never invent facts about the sender's business; if unsure, ask in the draft.`

async function handleMessage(msg: ChannelMessage): Promise<void> {
  // guard chain
  if (msg.from.address === gmailChannel.selfAddress) return            // self-mail → loop guard
  if (await isProcessed(msg.id)) return                                 // dedupe
  if (allowList.length && !allowList.includes(msg.from.address)) {
    await markProcessed(msg.id)                                         // ignore, but don't reprocess
    return
  }

  console.log(`[email-trigger] processing: "${msg.subject}" from ${msg.from.address}`)

  const skills = registry.listSkills()
  const intent = await classifyIntent(msg, skills)
  console.log(`[email-trigger] intent=${intent.intent} skill=${intent.skillName} conf=${intent.confidence}`)

  const { taskId, steps, result } = await runAgent(
    buildGoal(msg),
    registry.listTools(),
    skills,
    { forceSkillNames: [intent.skillName], systemSuffix: EMAIL_RULES }
  )

  await saveTask(taskId, `[email] ${msg.subject} (${intent.skillName})`, result, steps)
  await markProcessed(msg.id)
  await gmailChannel.markRead(msg.id).catch(() => {})
  emailTriggerStatus.processedCount++
}

async function poll(): Promise<void> {
  if (polling) return            // skip overlapping polls (agent runs can exceed interval)
  polling = true
  try {
    const messages = await gmailChannel.fetchUnread()
    emailTriggerStatus.lastPollAt = Date.now()
    emailTriggerStatus.lastError = ''
    for (const msg of messages) {
      try {
        await handleMessage(msg)
      } catch (e) {
        console.error(`[email-trigger] failed on "${msg.subject}":`, e)
      }
    }
  } catch (e) {
    emailTriggerStatus.lastError = String(e)
    console.error('[email-trigger] poll error:', e)
  } finally {
    polling = false
  }
}

export function startEmailTrigger(): void {
  if (!gmailChannel.isConfigured()) {
    console.warn('[email-trigger] GMAIL_USER / GMAIL_APP_PASSWORD not set — email trigger disabled')
    return
  }
  emailTriggerStatus.enabled = true
  console.log(`[email-trigger] polling every ${POLL_MS / 1000}s, allow-list: ${allowList.join(', ') || '(open!)'}`)
  poll()                          // immediate first poll
  timer = setInterval(poll, POLL_MS)
}

export function stopEmailTrigger(): void {
  if (timer) clearInterval(timer)
  timer = null
  emailTriggerStatus.enabled = false
}
