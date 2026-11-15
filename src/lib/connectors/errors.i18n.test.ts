// @vitest-environment jsdom
import { describe, expect, it } from "vitest"
import { t } from "@/i18n/fr"
import { CONNECTOR_ERROR_KINDS } from "./errors"

describe("connectors.errors i18n exhaustivité", () => {
  it("chaque ConnectorErrorKind a sa clé i18n non vide", () => {
    for (const kind of CONNECTOR_ERROR_KINDS) {
      const key = `connectors.errors.${kind}`
      const keys = key.split(".")
      let obj: unknown = t
      for (const k of keys) {
        expect(obj).toBeDefined()
        obj = (obj as Record<string, unknown>)[k]
      }
      expect(typeof obj).toBe("string")
      expect((obj as string).length).toBeGreaterThan(0)
    }
  })
})