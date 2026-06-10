import { Tool, Skill } from '../core/types.js'

class Registry {
  private tools = new Map<string, Tool>()
  private skills = new Map<string, Skill>()

  registerTool(tool: Tool): void {
    this.tools.set(tool.name, tool)
  }

  registerSkill(skill: Skill): void {
    this.skills.set(skill.name, skill)
  }

  getTool(name: string): Tool | undefined {
    return this.tools.get(name)
  }

  getSkill(name: string): Skill | undefined {
    return this.skills.get(name)
  }

  listTools(): Tool[] {
    return [...this.tools.values()]
  }

  listSkills(): Skill[] {
    return [...this.skills.values()]
  }
}

export const registry = new Registry()
