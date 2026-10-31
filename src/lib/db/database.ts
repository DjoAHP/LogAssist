import Database from "@tauri-apps/plugin-sql"
import { SCHEMA_VERSION, SCHEMA_V1_STATEMENTS, SCHEMA_V2_STATEMENTS, SCHEMA_V3_STATEMENTS } from "./migrations"

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
    await executeSchema(db, version)
    await db.execute(`PRAGMA user_version = ${SCHEMA_VERSION}`)
  }
  return db
}

// Exécution séquentielle des statements du schéma (sqlx rejette le multi-statement).
// `fromVersion` = version actuelle de la DB ; on applique les migrations manquantes.
async function executeSchema(db: Database, fromVersion: number): Promise<void> {
  if (fromVersion < 1) {
    for (const statement of SCHEMA_V1_STATEMENTS) {
      await db.execute(statement)
    }
  }
  if (fromVersion < 2) {
    for (const statement of SCHEMA_V2_STATEMENTS) {
      await db.execute(statement)
    }
  }
  if (fromVersion < 3) {
    for (const statement of SCHEMA_V3_STATEMENTS) {
      await db.execute(statement)
    }
  }
  // Ajouter ici les futures migrations (fromVersion < 4, etc.)
}

export async function execute(sql: string, bind: unknown[] = []): Promise<void> {
  const db = await getDb()
  await db.execute(sql, bind)
}

export async function select<T>(sql: string, bind: unknown[] = []): Promise<T[]> {
  const db = await getDb()
  return (await db.select(sql, bind)) as T[]
}
