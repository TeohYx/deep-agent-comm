import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { Skill } from '../core/types.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

// Minimal frontmatter parser. Expects:
// ---
// name: ...
// description: ...
// triggers: a, b, c
// ---
// <body becomes prompt>
function parseSkillFile(raw: string, fallbackName: string): Skill | null {
  const match = raw.match(/^---\s*\n([\s\S]*?)\n---\s*\n([\s\S]*)$/)
  if (!match) return null

  const [, fm, body] = match
  const meta: Record<string, string> = {}
  for (const line of fm.split('\n')) {
    const idx = line.indexOf(':')
    if (idx === -1) continue
    const key = line.slice(0, idx).trim()
    const val = line.slice(idx + 1).trim()
    if (key) meta[key] = val
  }

  return {
    name: meta.name || fallbackName,
    description: meta.description || '',
    triggers: (meta.triggers || '')
      .split(',')
      .map(t => t.trim().toLowerCase())
      .filter(Boolean),
    prompt: body.trim(),
    intent: meta.intent || undefined,
    subagent: meta.subagent === 'true',
  }
}

export function loadSkills(): Skill[] {
  const dir = __dirname
  const skills: Skill[] = []

  for (const file of fs.readdirSync(dir)) {
    if (!file.endsWith('.md')) continue
    const raw = fs.readFileSync(path.join(dir, file), 'utf8')
    const skill = parseSkillFile(raw, path.basename(file, '.md'))
    if (skill) skills.push(skill)
  }

  return skills
}

// Return skills whose triggers appear in the goal text.
export function matchSkills(goal: string, skills: Skill[]): Skill[] {
  const g = goal.toLowerCase()
  return skills.filter(s => s.triggers.some(t => g.includes(t)))
}
