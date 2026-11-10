import { describe, it, expect, vi } from "vitest"
import {
  SCHEMA_V1,
  SCHEMA_V1_STATEMENTS,
  SCHEMA_V2_STATEMENTS,
  SCHEMA_V3_STATEMENTS,
  SCHEMA_V4_STATEMENTS,
  SCHEMA_V5_STATEMENTS,
  SCHEMA_V6_STATEMENTS,
  SCHEMA_V7_STATEMENTS,
  SCHEMA_V8_STATEMENTS,
  SCHEMA_V9_STATEMENTS,
  SCHEMA_VERSION,
} from "./migrations"
import { executeSchema } from "./database"

const ERROR_CLEANUP_STATEMENT =
  "UPDATE messages SET error = CASE WHEN error = '{\"interrupted\":true}' THEN '{\"interrupted\":true}' ELSE '{\"kind\":\"unknown\",\"message\":\"\"}' END WHERE error IS NOT NULL"
const EMPTY_ASSISTANT_REPAIR_STATEMENT =
  "UPDATE messages SET error = '{\"kind\":\"unknown\",\"message\":\"\"}' WHERE role = 'assistant' AND content = '' AND error IS NULL"

function createMigrationDbMock() {
  const execute = vi.fn().mockResolvedValue(undefined)
  return {
    execute,
    db: { execute } as unknown as Parameters<typeof executeSchema>[0],
  }
}

describe("SCHEMA_V1_STATEMENTS", () => {
  it("couvre 8 tables + 2 index en 10 statements non vides", () => {
    expect(SCHEMA_V1_STATEMENTS).toHaveLength(10)
    for (const statement of SCHEMA_V1_STATEMENTS) {
      expect(statement.trim().length).toBeGreaterThan(0)
    }
  })
  it("SCHEMA_V1 reste compatible avec le join des statements", () => {
    expect(SCHEMA_V1).toBe(SCHEMA_V1_STATEMENTS.join(";\n"))
  })
  it("SCHEMA_VERSION correspond à la dernière migration", () => {
    expect(SCHEMA_VERSION).toBe(9)
    expect(SCHEMA_V1).toContain("CREATE TABLE IF NOT EXISTS conversations")
    expect(SCHEMA_V1).toContain("idx_conversations_project")
  })
})

describe("SCHEMA_V2_STATEMENTS", () => {
  it("contient la migration UNIQUE providers + dédoublonnage models", () => {
    expect(SCHEMA_V2_STATEMENTS.length).toBeGreaterThan(0)
    const joined = SCHEMA_V2_STATEMENTS.join(";\n")
    expect(joined).toContain("UNIQUE")
    expect(joined).toContain("providers_new")
    expect(joined).toContain("models_new")
    expect(joined).toContain("ROW_NUMBER")
    expect(joined).toContain("foreign_keys = OFF")
    expect(joined).toContain("foreign_keys = ON")
  })
})

describe("SCHEMA_V3_STATEMENTS", () => {
  it("crée la table knowledge avec ses colonnes et son index", () => {
    expect(SCHEMA_V3_STATEMENTS).toHaveLength(2)
    const joined = SCHEMA_V3_STATEMENTS.join(";\n")
    expect(joined).toContain("CREATE TABLE IF NOT EXISTS knowledge")
    expect(joined).toContain("name TEXT NOT NULL")
    expect(joined).toContain("content TEXT NOT NULL")
    expect(joined).toContain("enabled INTEGER NOT NULL DEFAULT 1")
    expect(joined).toContain("idx_knowledge_enabled")
  })
})

describe("SCHEMA_V4_STATEMENTS", () => {
  it("pinned sur conversations, sort_order sur knowledge, table conversation_knowledge cascadée", () => {
    expect(SCHEMA_V4_STATEMENTS).toHaveLength(3)
    const joined = SCHEMA_V4_STATEMENTS.join(";\n")
    expect(joined).toContain("ALTER TABLE conversations ADD COLUMN pinned INTEGER NOT NULL DEFAULT 0")
    expect(joined).toContain("ALTER TABLE knowledge ADD COLUMN sort_order INTEGER NOT NULL DEFAULT 0")
    expect(joined).toContain("CREATE TABLE IF NOT EXISTS conversation_knowledge")
    expect(joined).toContain("REFERENCES conversations(id) ON DELETE CASCADE")
    expect(joined).toContain("REFERENCES knowledge(id) ON DELETE CASCADE")
    expect(joined).toContain("PRIMARY KEY (conversation_id, knowledge_id)")
  })
})

describe("SCHEMA_V5_STATEMENTS", () => {
  it("ajoute les sources Web aux messages historiques avec un tableau vide par défaut", () => {
    expect(SCHEMA_V5_STATEMENTS).toEqual([
      "ALTER TABLE messages ADD COLUMN sources TEXT NOT NULL DEFAULT '[]'",
    ])
  })
})

describe("SCHEMA_V6_STATEMENTS", () => {
  it("ajoute des métriques optionnelles aux réponses historiques", () => {
    expect(SCHEMA_V6_STATEMENTS).toEqual([
      "ALTER TABLE messages ADD COLUMN first_token_ms INTEGER",
      "ALTER TABLE messages ADD COLUMN input_tokens INTEGER",
      "ALTER TABLE messages ADD COLUMN output_tokens INTEGER",
      "ALTER TABLE messages ADD COLUMN usage_source TEXT CHECK (usage_source IN ('provider','estimated'))",
      "ALTER TABLE messages ADD COLUMN cost_microusd INTEGER",
    ])
  })

  it("reste limitée aux cinq ALTER de métriques", () => {
    expect(SCHEMA_V6_STATEMENTS).toHaveLength(5)
    expect(SCHEMA_V6_STATEMENTS.every((statement) =>
      statement.startsWith("ALTER TABLE messages ADD COLUMN"),
    )).toBe(true)
  })
})

describe("SCHEMA_V7_STATEMENTS", () => {
  it("nettoie les erreurs legacy en conservant un état d'erreur générique", () => {
    expect(SCHEMA_V7_STATEMENTS).toEqual([ERROR_CLEANUP_STATEMENT])
  })

  it("applique V7 à V9 à une base déjà en V6", async () => {
    const { db, execute } = createMigrationDbMock()

    await executeSchema(db, 6)

    expect(execute.mock.calls.map(([statement]) => statement)).toEqual([
      ERROR_CLEANUP_STATEMENT,
      EMPTY_ASSISTANT_REPAIR_STATEMENT,
      ...SCHEMA_V9_STATEMENTS,
    ])
  })

  it("applique V6 à V9 à une base en V5", async () => {
    const { db, execute } = createMigrationDbMock()

    await executeSchema(db, 5)

    expect(execute.mock.calls.map(([statement]) => statement)).toEqual([
      ...SCHEMA_V6_STATEMENTS,
      ERROR_CLEANUP_STATEMENT,
      EMPTY_ASSISTANT_REPAIR_STATEMENT,
      ...SCHEMA_V9_STATEMENTS,
    ])
  })
})

describe("SCHEMA_V8_STATEMENTS", () => {
  it("répare les assistants vides sans erreur avec le marqueur générique exact", () => {
    expect(SCHEMA_V8_STATEMENTS).toEqual([EMPTY_ASSISTANT_REPAIR_STATEMENT])
  })

  it("applique V8 puis V9 à une base déjà en V7", async () => {
    const { db, execute } = createMigrationDbMock()

    await executeSchema(db, 7)

    expect(execute.mock.calls.map(([statement]) => statement)).toEqual([
      EMPTY_ASSISTANT_REPAIR_STATEMENT,
      ...SCHEMA_V9_STATEMENTS,
    ])
  })
})

describe("SCHEMA_V9_STATEMENTS", () => {
  it("crée le registre MCP sans colonne de secret", () => {
    const schema = SCHEMA_V9_STATEMENTS.join(";\n")
    expect(schema).toContain("CREATE TABLE IF NOT EXISTS mcp_servers")
    expect(schema).toContain("id TEXT PRIMARY KEY NOT NULL")
    expect(schema).toContain("CREATE TABLE IF NOT EXISTS mcp_tools")
    expect(schema).toContain("CHECK (auth_type IN ('none','bearer','api_key'))")
    expect(schema).toContain("REFERENCES mcp_servers(id) ON DELETE CASCADE")
    expect(schema).not.toMatch(/api_key\s+TEXT|token\s+TEXT|secret\s+TEXT/i)
  })

  it("amorce TinyFish et ses aliases sans écraser les données", () => {
    const schema = SCHEMA_V9_STATEMENTS.join(";\n")
    expect(schema).toContain("INSERT OR IGNORE INTO mcp_servers")
    expect(schema).toContain("'tinyfish__search'")
    expect(schema).toContain("'tinyfish__fetch_content'")
    expect(schema).toContain("WHERE key = 'web.enabled'")
  })

  it("applique uniquement V9 à une base V8", async () => {
    const { db, execute } = createMigrationDbMock()
    await executeSchema(db, 8)
    expect(execute.mock.calls.map(([statement]) => statement)).toEqual(SCHEMA_V9_STATEMENTS)
  })
})
