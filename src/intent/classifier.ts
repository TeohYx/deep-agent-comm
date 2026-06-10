// L1 — Intent layer. One small LLM call: which skill handles this message?
// Does NOT do the work. Low confidence → route to 'clarify' skill.

import { callLLM } from '../core/llm.js'
import { Skill } from '../core/types.js'
import { ChannelMessage } from '../channels/types.js'

export interface IntentResult {
  intent: string
  skillName: string
  confidence: number   // 0..1
  reason: string
}

const CONFIDENCE_THRESHOLD = 0.6

export async function classifyIntent(
  msg: ChannelMessage,
  skills: Skill[]
): Promise<IntentResult> {
  // Only skills that declare an intent participate in email routing.
  const routable = skills.filter(s => s.intent)
  if (routable.length === 0) {
    return { intent: 'clarify', skillName: 'clarify', confidence: 0, reason: 'no routable skills' }
  }

  const menu = routable
    .map(s => `- intent: "${s.intent}" → skill: "${s.name}" — ${s.description}`)
    .join('\n')

  const attachInfo = msg.attachments.length
    ? `Attachments: ${msg.attachments.map(a => a.filename).join(', ')}`
    : 'No attachments.'

  const response = await callLLM([
    {
      role: 'system',
      content: `You are an intent classifier for an email agent. Given an email, pick exactly one intent from the menu.
Reply with ONLY a JSON object: {"intent": "...", "skill": "...", "confidence": 0.0-1.0, "reason": "..."}
If the email doesn't clearly match any intent, use intent "clarify", skill "clarify", confidence below 0.5.

Menu:
${menu}
- intent: "clarify" → skill: "clarify" — fallback when unclear`,
    },
    {
      role: 'user',
      content: `From: ${msg.from.address}\nSubject: ${msg.subject}\n${attachInfo}\n\nBody:\n${msg.body.slice(0, 2000)}`,
    },
  ])

  try {
    const text = (response.content ?? '').replace(/```json|```/g, '').trim()
    const parsed = JSON.parse(text)
    const result: IntentResult = {
      intent: String(parsed.intent ?? 'clarify'),
      skillName: String(parsed.skill ?? 'clarify'),
      confidence: Number(parsed.confidence ?? 0),
      reason: String(parsed.reason ?? ''),
    }
    // Below threshold → clarifying reply (decision: open question #5)
    if (result.confidence < CONFIDENCE_THRESHOLD) {
      return { ...result, intent: 'clarify', skillName: 'clarify' }
    }
    // Guard: classifier must name a real skill
    if (!routable.some(s => s.name === result.skillName) && result.skillName !== 'clarify') {
      return { ...result, intent: 'clarify', skillName: 'clarify' }
    }
    return result
  } catch {
    return { intent: 'clarify', skillName: 'clarify', confidence: 0, reason: 'classifier output unparseable' }
  }
}
