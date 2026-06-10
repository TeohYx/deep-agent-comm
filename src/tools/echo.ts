import { Tool, ToolResult } from '../core/types.js'

// Simple test tool — echoes input back. Good for verifying the pipeline works.
export const echoTool: Tool = {
  name: 'echo',
  description: 'Echo the input message back. Used for testing.',
  inputSchema: {
    type: 'object',
    properties: {
      message: { type: 'string' },
    },
    required: ['message'],
  },
  async execute(input): Promise<ToolResult> {
    return { success: true, output: input.message }
  },
}
