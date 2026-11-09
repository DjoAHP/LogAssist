import { describe, expect, it } from "vitest"

import { resolveWebIntent } from "@/lib/mcp/webIntent"

describe("resolveWebIntent", () => {
  it("retourne required quand forceOnce est true", () => {
    expect(resolveWebIntent("Question ordinaire", true)).toBe("required")
  })

  it("retourne fetch_content lorsqu'une URL est fournie", () => {
    expect(resolveWebIntent("https://example.com/guide", false)).toBe("fetch_content")
  })

  it.each([
    "Cherche sur Internet la version de Tauri",
    "Vérifie en ligne cette information",
    "Peux-tu rechercher sur le web ?",
  ])("retourne search pour une demande explicite : %s", (text) => {
    expect(resolveWebIntent(text, false)).toBe("search")
  })

  it("retourne auto pour une question ordinaire", () => {
    expect(resolveWebIntent("Comment fonctionne le state dans React ?", false)).toBe("auto")
  })

  it("ne force pas une expression citée ou descriptive", () => {
    expect(resolveWebIntent('Le bouton « cherche sur Internet » est visible.', false)).toBe("auto")
  })
})