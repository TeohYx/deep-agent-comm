import axios from 'axios'
import { Tool, ToolResult } from '../core/types.js'

export const webFetchTool: Tool = {
  name: 'web_fetch',
  description: 'Fetch the text content of a URL. Returns raw text (truncated to 8000 chars).',
  inputSchema: {
    type: 'object',
    properties: {
      url: { type: 'string', description: 'The URL to fetch' },
    },
    required: ['url'],
  },
  async execute(input): Promise<ToolResult> {
    try {
      const res = await axios.get(String(input.url), {
        timeout: 10000,
        headers: { 'User-Agent': 'DeepAgent/1.0' },
        responseType: 'text',
      })
      const text = String(res.data).slice(0, 8000)
      return { success: true, output: text }
    } catch (e) {
      return { success: false, output: null, error: String(e) }
    }
  },
}
