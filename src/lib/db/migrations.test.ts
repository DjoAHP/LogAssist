import { describe, it, expect } from "vitest"
import {
  SCHEMA_V1,
  SCHEMA_V1_STATEMENTS,
  SCHEMA_V2_STATEMENTS,
  SCHEMA_V3_STATEMENTS,
  SCHEMA_V4_STATEMENTS,
  SCHEMA_V5_STATEMENTS,
  SCHEMA_VERSION,
} from "./migrations"

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
    expect(SCHEMA_VERSION).toBe(5)
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
