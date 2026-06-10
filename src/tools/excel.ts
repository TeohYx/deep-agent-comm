// Excel tools (SheetJS — pure JS, no native build).
// v1 simplification: parsing runs in-process with size caps (see docs/answer-for-md.md).

import XLSX from 'xlsx'
import fs from 'fs'
import path from 'path'
import { Tool, ToolResult } from '../core/types.js'

const MAX_ROWS = 100
const SCRATCH = path.resolve('scratch')

export const excelReadTool: Tool = {
  name: 'excel_read',
  description:
    'Read an .xlsx or .csv file from a local path. Returns sheet names and rows as JSON (capped at 500 rows per sheet).',
  inputSchema: {
    type: 'object',
    properties: {
      filePath: { type: 'string', description: 'Absolute path to the .xlsx/.csv file' },
    },
    required: ['filePath'],
  },
  async execute(input): Promise<ToolResult> {
    try {
      const p = String(input.filePath)
      if (!fs.existsSync(p)) return { success: false, output: null, error: `File not found: ${p}` }
      if (!/\.(xlsx|csv)$/i.test(p))
        return { success: false, output: null, error: 'Only .xlsx/.csv supported in v1' }

      const wb = XLSX.read(fs.readFileSync(p))
      const out: Record<string, unknown[]> = {}
      for (const name of wb.SheetNames) {
        const rows = XLSX.utils.sheet_to_json(wb.Sheets[name], { defval: null })
        out[name] = rows.slice(0, MAX_ROWS)
      }
      return { success: true, output: { sheets: wb.SheetNames, data: out } }
    } catch (e) {
      return { success: false, output: null, error: String(e) }
    }
  },
}

export const excelWriteTool: Tool = {
  name: 'excel_write',
  description:
    'Create an .xlsx file from JSON rows. Input: filename and an array of row objects. Returns the created file path.',
  inputSchema: {
    type: 'object',
    properties: {
      filename: { type: 'string', description: 'Output filename, e.g. report.xlsx' },
      rows: {
        type: 'array',
        items: { type: 'object' },
        description: 'Array of row objects, keys become column headers',
      },
      sheetName: { type: 'string', description: 'Optional sheet name (default Sheet1)' },
    },
    required: ['filename', 'rows'],
  },
  async execute(input): Promise<ToolResult> {
    try {
      const dir = path.join(SCRATCH, 'outbound')
      fs.mkdirSync(dir, { recursive: true })
      const safe = String(input.filename).replace(/[^\w.\-]/g, '_').replace(/\.\w+$/, '') + '.xlsx'
      const outPath = path.join(dir, safe)

      const ws = XLSX.utils.json_to_sheet(input.rows as object[])
      const wb = XLSX.utils.book_new()
      XLSX.utils.book_append_sheet(wb, ws, String(input.sheetName ?? 'Sheet1'))
      XLSX.writeFile(wb, outPath)

      return { success: true, output: { filePath: outPath } }
    } catch (e) {
      return { success: false, output: null, error: String(e) }
    }
  },
}
