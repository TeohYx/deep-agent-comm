import { Tool, ToolResult } from '../core/types.js'

export const calculatorTool: Tool = {
  name: 'calculator',
  description: 'Evaluate a mathematical expression. Returns numeric result.',
  inputSchema: {
    type: 'object',
    properties: {
      expression: { type: 'string', description: 'Math expression, e.g. "2 + 2 * 10"' },
    },
    required: ['expression'],
  },
  async execute(input): Promise<ToolResult> {
    try {
      // Safe eval: only allow numbers and math operators
      const expr = String(input.expression)
      if (!/^[\d\s+\-*/().]+$/.test(expr)) {
        return { success: false, output: null, error: 'Invalid expression' }
      }
      const result = Function(`"use strict"; return (${expr})`)()
      return { success: true, output: result }
    } catch (e) {
      return { success: false, output: null, error: String(e) }
    }
  },
}
