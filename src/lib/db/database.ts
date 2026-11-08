import { invoke } from "@tauri-apps/api/core"
import Database from "@tauri-apps/plugin-sql"
import {
  SCHEMA_VERSION,
  SCHEMA_V1_STATEMENTS,
  SCHEMA_V2_STATEMENTS,
  SCHEMA_V3_STATEMENTS,
  SCHEMA_V4_STATEMENTS,
  SCHEMA_V5_STATEMENTS,
  SCHEMA_V6_STATEMENTS,
  SCHEMA_V7_STATEMENTS,
  SCHEMA_V8_STATEMENTS,
} from "./migrations"

let dbPromise: Promise<Database> | null = null

export interface TransactionStatement {
  sql: string
  bind?: unknown[]
}

export function getDb(): Promise<Database> {
  if (!dbPromise) dbPromise = init()
  return dbPromise
}

export function createTransactionExecutor(
  loadDb: () => Promise<unknown>,
  runBatch: (statements: Array<{ sql: string; values: unknown[] }>) => Promise<void>,
) {
  let tail: Promise<void> = Promise.resolve()
  return async (statements: TransactionStatement[]): Promise<void> => {
    if (statements.length === 0) return
    const previous = tail
    let release!: () => void
    tail = new Promise<void>((resolve) => { release = resolve })
    await previous
    try {
      await loadDb()
      await runBatch(statements.map((statement) => ({
        sql: statement.sql,
        values: statement.bind ?? [],
      })))
    } finally {
      release()
    }
  }
}

export const executeTransaction = createTransactionExecutor(
  getDb,
  (statements) => invoke("execute_transaction", { statements }),
)

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
export async function executeSchema(db: Database, fromVersion: number): Promise<void> {
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
  if (fromVersion < 4) {
    for (const statement of SCHEMA_V4_STATEMENTS) {
      await db.execute(statement)
    }
  }
  if (fromVersion < 5) {
    for (const statement of SCHEMA_V5_STATEMENTS) {
      await db.execute(statement)
    }
  }
  if (fromVersion < 6) {
    for (const statement of SCHEMA_V6_STATEMENTS) {
      await db.execute(statement)
    }
  }
  if (fromVersion < 7) {
    for (const statement of SCHEMA_V7_STATEMENTS) {
      await db.execute(statement)
    }
  }
  if (fromVersion < 8) {
    for (const statement of SCHEMA_V8_STATEMENTS) {
      await db.execute(statement)
    }
  }
  // Ajouter ici les futures migrations (fromVersion < 9, etc.)
}

export async function execute(sql: string, bind: unknown[] = []): Promise<void> {
  const db = await getDb()
  await db.execute(sql, bind)
}

export async function select<T>(sql: string, bind: unknown[] = []): Promise<T[]> {
  const db = await getDb()
  return (await db.select(sql, bind)) as T[]
}
