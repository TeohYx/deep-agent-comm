import axios from 'axios'
import { LLMMessage, LLMResponse, Tool } from './types.js'

const BASE_URL = process.env.DEEPSEEK_BASE_URL ?? 'https://api.deepseek.com'
const MODEL = process.env.DEEPSEEK_MODEL ?? 'deepseek-chat'

function toolToFunction(tool: Tool) {
  return {
    type: 'function',
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.inputSchema,
    },
  }
}

export async function callLLM(
  messages: LLMMessage[],
  tools: Tool[] = [],
  maxTokens = 4096
): Promise<LLMResponse> {
  const apiKey = process.env.DEEPSEEK_API_KEY
  if (!apiKey) throw new Error('DEEPSEEK_API_KEY not set')

  const body: Record<string, unknown> = {
    model: MODEL,
    messages,
    max_tokens: maxTokens,
  }

  if (tools.length > 0) {
    body.tools = tools.map(toolToFunction)
    body.tool_choice = 'auto'
  }

  // Retry on transient network errors (DNS, reset, timeout). NOT on 4xx —
  // those are our bug (bad request, auth, context too big) and won't fix on retry.
  const TRANSIENT = new Set(['ENOTFOUND', 'EAI_AGAIN', 'ECONNRESET', 'ETIMEDOUT', 'ECONNREFUSED'])
  const MAX_RETRIES = 3
  let res: any
  let lastErr: any

  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      res = await axios.post(`${BASE_URL}/v1/chat/completions`, body, {
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        timeout: 60_000,
      })
      lastErr = null
      break
    } catch (e: any) {
      lastErr = e
      const code = e.code as string | undefined
      const status = e.response?.status as number | undefined
      const retryable = (code && TRANSIENT.has(code)) || status === 429 || (status && status >= 500)
      if (!retryable || attempt === MAX_RETRIES - 1) break
      const backoff = 500 * 2 ** attempt        // 500ms, 1s, 2s
      console.warn(`[llm] transient error (${code ?? status}), retry ${attempt + 1}/${MAX_RETRIES} in ${backoff}ms`)
      await new Promise(r => setTimeout(r, backoff))
    }
  }

  if (lastErr) {
    const detail = lastErr.response?.data ? JSON.stringify(lastErr.response.data) : lastErr.message
    throw new Error(`DeepSeek API error: ${detail}`)
  }

  const choice = res.data.choices[0]
  return {
    content: choice.message.content ?? null,
    tool_calls: choice.message.tool_calls,
    finish_reason: choice.finish_reason,
  }
}
