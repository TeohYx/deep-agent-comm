// L4 — Sandbox. Runs LLM-generated JS in a child process with the Node
// permission model: filesystem restricted to the job's scratch dir (+ read-only
// node_modules), no child processes, no workers.
// v1 limitation (accepted): network is NOT restricted by --permission.

import { spawn } from 'child_process'
import fs from 'fs'
import path from 'path'
import { v4 as uuid } from 'uuid'

const SCRATCH = path.resolve('scratch')
const TIMEOUT_MS = 30_000

export interface SandboxResult {
  success: boolean
  stdout: string
  stderr: string
  files: string[]      // files present in job dir after run (absolute paths)
  jobDir: string
}

export async function runInSandbox(code: string, inputFiles: string[] = []): Promise<SandboxResult> {
  const jobDir = path.join(SCRATCH, 'jobs', uuid())
  fs.mkdirSync(jobDir, { recursive: true })

  // copy input files (e.g. downloaded attachments) into the job dir
  for (const f of inputFiles) {
    if (fs.existsSync(f)) fs.copyFileSync(f, path.join(jobDir, path.basename(f)))
  }

  const scriptPath = path.join(jobDir, 'script.mjs')
  fs.writeFileSync(scriptPath, code, 'utf8')

  const nodeModules = path.resolve('node_modules')

  const child = spawn(
    process.execPath,
    [
      '--permission',
      `--allow-fs-read=${jobDir}`,
      `--allow-fs-read=${nodeModules}`,
      `--allow-fs-write=${jobDir}`,
      scriptPath,
    ],
    { cwd: jobDir, timeout: TIMEOUT_MS, windowsHide: true }
  )

  let stdout = ''
  let stderr = ''
  child.stdout.on('data', d => (stdout += d.toString()))
  child.stderr.on('data', d => (stderr += d.toString()))

  const exitCode: number = await new Promise(resolve => {
    child.on('close', code => resolve(code ?? 1))
    child.on('error', () => resolve(1))
  })

  const files = fs
    .readdirSync(jobDir)
    .filter(f => f !== 'script.mjs')
    .map(f => path.join(jobDir, f))

  return {
    success: exitCode === 0,
    stdout: stdout.slice(0, 8000),
    stderr: stderr.slice(0, 4000),
    files,
    jobDir,
  }
}
