import Database from "@tauri-apps/plugin-sql"
import { SCHEMA_V1, SCHEMA_VERSION } from "./migrations"

let dbPromise: Promise<Database> | null = null

export function getDb(): Promise<Database> {
  if (!dbPromise) dbPromise = init()
  return dbPromise
}

async function init(): Promise<Database> {
  const db = await Database.load("sqlite:logassist.db")
  // PRAGMA via select car execute ne renvoie pas de lignes ; la doc du plugin : select renvoie des lignes objet.
  const rows = await db.select(`PRAGMA user_version`) as { user_version: number }[]
  const version = rows?.[0]?.user_version ?? 0
  if (version < SCHEMA_VERSION) {
    await executeSchema(db, SCHEMA_V1)
    await db.execute(`PRAGMA user_version = ${SCHEMA_VERSION}`)
  }
  return db
}

// Le plugin sql (sqlx) peut rejeter un multi-statement dans un seul execute :
// on split sur ";" en statements non vides, exécutés séquentiellement.
async function executeSchema(db: Database, schema: string): Promise<void> {
  const statements = schema
    .split(";")
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
  for (const statement of statements) {
    await db.execute(statement)
  }
}

export async function execute(sql: string, bind: unknown[] = []): Promise<void> {
  const db = await getDb()
  await db.execute(sql, bind)
}

export async function select<T>(sql: string, bind: unknown[] = []): Promise<T[]> {
  const db = await getDb()
  return (await db.select(sql, bind)) as T[]
}
