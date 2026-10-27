import { describe, it, expect } from "vitest"
import { SCHEMA_V1, SCHEMA_V1_STATEMENTS, SCHEMA_VERSION } from "./migrations"

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
  it("SCHEMA_VERSION v1 en phase avec les statements v1", () => {
    expect(SCHEMA_VERSION).toBe(1)
    expect(SCHEMA_V1).toContain("CREATE TABLE IF NOT EXISTS conversations")
    expect(SCHEMA_V1).toContain("idx_conversations_project")
  })
})
