import Database from "@tauri-apps/plugin-sql"
import { SCHEMA_V1_STATEMENTS, SCHEMA_VERSION } from "./migrations"

let dbPromise: Promise<Database> | null = null

export function getDb(): Promise<Database> {
  if (!dbPromise) dbPromise = init()
  return dbPromise
}

async function init(): Promise<Database> {
  const db = await Database.load("sqlite:logassist.db")
  // FK cascade garantie explicitement, indépendamment des défauts du driver ;
  // activée AVANT la migration pour que les CREATE TABLE en profitent.
  await db.execute("PRAGMA foreign_keys = ON")
  // PRAGMA via select car execute ne renvoie pas de lignes ; la doc du plugin : select renvoie des lignes objet.
  const rows = await db.select(`PRAGMA user_version`) as { user_version: number }[]
  const version = rows?.[0]?.user_version ?? 0
  if (version < SCHEMA_VERSION) {
    await executeSchema(db)
    await db.execute(`PRAGMA user_version = ${SCHEMA_VERSION}`)
  }
  return db
}

// Exécution séquentielle des statements du schéma (sqlx rejette le multi-statement).
async function executeSchema(db: Database): Promise<void> {
  for (const statement of SCHEMA_V1_STATEMENTS) {
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
