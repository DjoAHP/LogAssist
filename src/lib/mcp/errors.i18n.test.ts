import { describe, expect, it } from "vitest"
import { t } from "@/i18n/fr"
import { MCP_ERROR_KINDS } from "./types"

describe("erreurs MCP i18n", () => {
  it("possède un libellé pour chaque kind public", () => {
    for (const kind of MCP_ERROR_KINDS) {
      expect(t.mcp.errors[kind].trim().length).toBeGreaterThan(0)
    }
  })
})