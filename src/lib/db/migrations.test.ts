import { describe, it, expect } from "vitest"
import { SCHEMA_V1, SCHEMA_V1_STATEMENTS, SCHEMA_V2_STATEMENTS, SCHEMA_VERSION } from "./migrations"

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
    expect(SCHEMA_VERSION).toBe(2)
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
