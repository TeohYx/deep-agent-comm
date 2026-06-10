// spawn_subagent — agent→agent trigger (⑤). The main agent delegates heavy or
// risky work. The sub-agent gets ONLY the sandbox-tier toolset (least
// privilege): excel, chart, run_code, calculator. It cannot touch Gmail and
// cannot spawn further sub-agents (no recursion — this tool is not in its set).

import { Tool, ToolResult } from '../core/types.js'
import { runAgent } from '../core/agent.js'
import { excelReadTool, excelWriteTool } from './excel.js'
import { chartGenerateTool } from './chart.js'
import { runCodeTool } from './runCode.js'
import { calculatorTool } from './calculator.js'

const SUBAGENT_TOOLS: Tool[] = [
  excelReadTool,
  excelWriteTool,
  chartGenerateTool,
  runCodeTool,
  calculatorTool,
]

export const spawnSubagentTool: Tool = {
  name: 'spawn_subagent',
  description:
    'Delegate a heavy or data-processing task to an isolated sub-agent. The sub-agent can read/write excel, generate charts, and run sandboxed code — but has NO email access. Give it a complete, self-contained goal including any file paths. Returns its final answer (mention any output file paths in the goal so it reports them back).',
  inputSchema: {
    type: 'object',
    properties: {
      goal: {
        type: 'string',
        description:
          'Self-contained task description. Include absolute input file paths and what outputs you need (e.g. "Read C:\\...\\sales.xlsx, compute revenue by month, generate a bar chart, report the chart file path").',
      },
    },
    required: ['goal'],
  },
  async execute(input): Promise<ToolResult> {
    try {
      const { result, steps } = await runAgent(
        String(input.goal),
        SUBAGENT_TOOLS,
        [],            // sub-agent gets no skills — pure task execution
        {
          maxSteps: 15,
          systemSuffix:
            'You are a sub-agent working on a delegated task. Always end your final answer with a line "FILES: <comma-separated absolute paths>" listing every output file you produced (or "FILES: none").',
        }
      )
      return {
        success: true,
        output: {
          result,
          toolCallCount: steps.filter(s => s.type === 'tool').length,
        },
      }
    } catch (e) {
      return { success: false, output: null, error: String(e) }
    }
  },
}
