// run_code — execute LLM-written JS in the L4 sandbox (child process,
// fs locked to job dir). Available ONLY to sub-agents, never the main agent.

import { Tool, ToolResult } from '../core/types.js'
import { runInSandbox } from '../sandbox/runner.js'

export const runCodeTool: Tool = {
  name: 'run_code',
  description:
    'Run JavaScript (ESM, Node) in an isolated sandbox. Filesystem access is limited to the job directory (cwd). Input files you list are copied into cwd first. Use console.log for output; write any produced files to cwd. Returns stdout, stderr, and paths of files created.',
  inputSchema: {
    type: 'object',
    properties: {
      code: { type: 'string', description: 'JavaScript module code to run' },
      inputFiles: {
        type: 'array',
        items: { type: 'string' },
        description: 'Absolute paths of files to copy into the sandbox cwd before running',
      },
    },
    required: ['code'],
  },
  async execute(input): Promise<ToolResult> {
    try {
      const result = await runInSandbox(
        String(input.code),
        Array.isArray(input.inputFiles) ? input.inputFiles.map(String) : []
      )
      return {
        success: result.success,
        output: {
          stdout: result.stdout,
          stderr: result.stderr,
          filesCreated: result.files,
        },
        error: result.success ? undefined : `exit non-zero. stderr: ${result.stderr.slice(0, 500)}`,
      }
    } catch (e) {
      return { success: false, output: null, error: String(e) }
    }
  },
}
