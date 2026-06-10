import initSqlJs from 'sql.js'
import fs from 'fs'
import path from 'path'

const DB_PATH = path.resolve('agent.db.json')

let db: Awaited<ReturnType<typeof initSqlJs>>['Database']['prototype'] | null = null

async function getDb() {
  if (db) return db
  const SQL = await initSqlJs()
  if (fs.existsSync(DB_PATH)) {
    const data = JSON.parse(fs.readFileSync(DB_PATH, 'utf8')) as number[]
    db = new SQL.Database(Buffer.from(data))
  } else {
    db = new SQL.Database()
  }
  db.run(`
    CREATE TABLE IF NOT EXISTS tasks (
      id TEXT PRIMARY KEY,
      goal TEXT NOT NULL,
      result TEXT,
      steps TEXT,
      created_at INTEGER NOT NULL,
      session_id TEXT
    )
  `)
  // Migrate pre-session DBs: add the column, then give each legacy task its
  // own session (session_id = task id) so old history stays visible.
  try {
    db.run(`ALTER TABLE tasks ADD COLUMN session_id TEXT`)
  } catch {
    /* column already exists */
  }
  db.run(`UPDATE tasks SET session_id = id WHERE session_id IS NULL`)
  db.run(`
    CREATE TABLE IF NOT EXISTS processed_messages (
      message_id TEXT PRIMARY KEY,
      processed_at INTEGER NOT NULL
    )
  `)
  return db
}

function persist(database: typeof db) {
  if (!database) return
  fs.writeFileSync(DB_PATH, JSON.stringify(Array.from(database.export())))
}

// sessionId defaults to the task's own id: trigger runs (email/schedule)
// become single-turn sessions without their call sites changing.
export async function saveTask(
  id: string,
  goal: string,
  result: string,
  steps: unknown,
  sessionId: string = id
) {
  const database = await getDb()
  database.run(
    `INSERT OR REPLACE INTO tasks (id, goal, result, steps, created_at, session_id) VALUES (?,?,?,?,?,?)`,
    [id, goal, result, JSON.stringify(steps), Date.now(), sessionId]
  )
  persist(database)
}

export async function getTask(id: string) {
  const database = await getDb()
  const res = database.exec(`SELECT * FROM tasks WHERE id = '${id.replace(/'/g, "''")}'`)
  if (!res[0]) return null
  const [cols, vals] = [res[0].columns, res[0].values[0]]
  const row: Record<string, unknown> = {}
  cols.forEach((c, i) => (row[c] = vals[i]))
  row.steps = JSON.parse(row.steps as string)
  return row
}

export async function isProcessed(messageId: string): Promise<boolean> {
  const database = await getDb()
  const res = database.exec(
    `SELECT 1 FROM processed_messages WHERE message_id = '${messageId.replace(/'/g, "''")}'`
  )
  return Boolean(res[0]?.values?.length)
}

export async function markProcessed(messageId: string): Promise<void> {
  const database = await getDb()
  database.run(
    `INSERT OR REPLACE INTO processed_messages (message_id, processed_at) VALUES (?,?)`,
    [messageId, Date.now()]
  )
  persist(database)
}

// One row per session: title = first goal, ordered by latest activity.
export async function listSessions(limit = 30) {
  const database = await getDb()
  const res = database.exec(`
    SELECT t1.session_id AS id,
           (SELECT goal FROM tasks t2 WHERE t2.session_id = t1.session_id
            ORDER BY t2.created_at ASC LIMIT 1) AS title,
           COUNT(*) AS turns,
           MAX(t1.created_at) AS updated_at
    FROM tasks t1
    GROUP BY t1.session_id
    ORDER BY updated_at DESC
    LIMIT ${Math.max(1, Math.floor(limit))}
  `)
  if (!res[0]) return []
  return res[0].values.map(vals =>
    Object.fromEntries(res[0].columns.map((c, i) => [c, vals[i]]))
  )
}

// All turns of one session, oldest first, steps parsed.
export async function listSessionTasks(sessionId: string) {
  const database = await getDb()
  const res = database.exec(
    `SELECT id, goal, result, steps, created_at FROM tasks
     WHERE session_id = '${sessionId.replace(/'/g, "''")}'
     ORDER BY created_at ASC`
  )
  if (!res[0]) return []
  return res[0].values.map(vals => {
    const row: Record<string, unknown> = Object.fromEntries(
      res[0].columns.map((c, i) => [c, vals[i]])
    )
    try { row.steps = JSON.parse(row.steps as string) } catch { row.steps = [] }
    return row
  })
}

export async function listTasks(limit = 20) {
  const database = await getDb()
  const res = database.exec(
    `SELECT id, goal, result, created_at FROM tasks ORDER BY created_at DESC LIMIT ${limit}`
  )
  if (!res[0]) return []
  return res[0].values.map(vals =>
    Object.fromEntries(res[0].columns.map((c, i) => [c, vals[i]]))
  )
}
