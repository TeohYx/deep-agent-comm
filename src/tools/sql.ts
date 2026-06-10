// sql_query — READ-ONLY (decision: architecture open question #4).
// Single SELECT statement only. Runs against a local demo DB (sql.js),
// seeded with sample sales data on first use so the skill is demoable.

import initSqlJs, { Database } from 'sql.js'
import fs from 'fs'
import path from 'path'
import { Tool, ToolResult } from '../core/types.js'

const DB_PATH = path.resolve('demo-data.db.json')
let db: Database | null = null

async function getDemoDb(): Promise<Database> {
  if (db) return db
  const SQL = await initSqlJs()
  if (fs.existsSync(DB_PATH)) {
    db = new SQL.Database(Buffer.from(JSON.parse(fs.readFileSync(DB_PATH, 'utf8'))))
    return db
  }
  db = new SQL.Database()
  db.run(`
    CREATE TABLE orders (
      id INTEGER PRIMARY KEY,
      customer TEXT NOT NULL,
      product TEXT NOT NULL,
      qty INTEGER NOT NULL,
      unit_price REAL NOT NULL,
      order_date TEXT NOT NULL,
      status TEXT NOT NULL
    );
  `)
  const seed = [
    [1, 'Acme Corp', 'Widget A', 120, 9.5, '2026-05-04', 'shipped'],
    [2, 'Globex', 'Widget B', 40, 24.0, '2026-05-11', 'shipped'],
    [3, 'Initech', 'Widget A', 75, 9.5, '2026-05-18', 'pending'],
    [4, 'Acme Corp', 'Widget C', 200, 4.25, '2026-05-25', 'shipped'],
    [5, 'Umbrella', 'Widget B', 60, 24.0, '2026-06-01', 'shipped'],
    [6, 'Globex', 'Widget C', 150, 4.25, '2026-06-03', 'cancelled'],
    [7, 'Initech', 'Widget B', 30, 24.0, '2026-06-05', 'shipped'],
    [8, 'Acme Corp', 'Widget A', 90, 9.5, '2026-06-08', 'pending'],
  ]
  for (const row of seed) {
    db.run(`INSERT INTO orders VALUES (?,?,?,?,?,?,?)`, row as (string | number)[])
  }
  fs.writeFileSync(DB_PATH, JSON.stringify(Array.from(db.export())))
  return db
}

function isReadOnlySelect(sql: string): boolean {
  const trimmed = sql.trim().replace(/;\s*$/, '')
  if (trimmed.includes(';')) return false                 // single statement only
  if (!/^select\b/i.test(trimmed)) return false           // must start with SELECT
  // block sneaky writes via CTE or PRAGMA-style escapes
  if (/\b(insert|update|delete|drop|alter|create|attach|pragma|replace)\b/i.test(trimmed)) return false
  return true
}

export const sqlQueryTool: Tool = {
  name: 'sql_query',
  description:
    'Run a READ-ONLY SQL SELECT against the demo database. Schema: orders(id, customer, product, qty, unit_price, order_date, status). Single SELECT statement only — writes are rejected.',
  inputSchema: {
    type: 'object',
    properties: {
      sql: { type: 'string', description: 'A single SELECT statement' },
    },
    required: ['sql'],
  },
  async execute(input): Promise<ToolResult> {
    try {
      const sql = String(input.sql)
      if (!isReadOnlySelect(sql)) {
        return { success: false, output: null, error: 'Rejected: only a single SELECT statement is allowed (read-only v1).' }
      }
      const database = await getDemoDb()
      const res = database.exec(sql)
      if (!res[0]) return { success: true, output: { rows: [], note: 'query returned no rows' } }
      const rows = res[0].values.map(vals =>
        Object.fromEntries(res[0].columns.map((c, i) => [c, vals[i]]))
      )
      return { success: true, output: { rows: rows.slice(0, 50), totalReturned: rows.length } }
    } catch (e) {
      return { success: false, output: null, error: String(e) }
    }
  },
}
