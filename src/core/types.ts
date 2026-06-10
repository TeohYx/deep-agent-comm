export interface ToolResult {
  success: boolean
  output: unknown
  error?: string
}

export interface Tool {
  name: string
  description: string
  inputSchema: Record<string, unknown>  // JSON Schema
  execute(input: Record<string, unknown>): Promise<ToolResult>
}

export interface Skill {
  name: string
  description: string
  triggers: string[]
  prompt: string     // injected into system message when a trigger matches the goal
  intent?: string    // intent label for the L1 classifier (email routing)
  subagent?: boolean // true → skill delegates heavy work to a sandboxed sub-agent
}

export interface AgentContext {
  taskId: string
  goal: string
  steps: StepRecord[]
  memory: MemoryEntry[]
  tools: Tool[]
  skills: Skill[]
  addStep(step: StepRecord): void
  getLastOutput(): unknown
}

export interface StepRecord {
  id: string
  type: 'llm' | 'tool' | 'skill'
  input: unknown
  output: unknown
  timestamp: number
  error?: string
}

export interface MemoryEntry {
  key: string
  value: unknown
  createdAt: number
}

export interface LLMMessage {
  role: 'system' | 'user' | 'assistant' | 'tool'
  content: string
  tool_call_id?: string
  name?: string
}

export interface LLMToolCall {
  id: string
  type: 'function'
  function: {
    name: string
    arguments: string
  }
}

export interface LLMResponse {
  content: string | null
  tool_calls?: LLMToolCall[]
  finish_reason: string
}
