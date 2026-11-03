import { describe, expect, it } from "vitest"

import { resolveWebChoice } from "@/lib/mcp/webIntent"

describe("resolveWebChoice", () => {
  it("force un outil une fois via le bouton", () => {
    expect(resolveWebChoice("Question ordinaire", true)).toBe("required")
  })

  it("force fetch_content lorsqu'une URL est fournie", () => {
    expect(resolveWebChoice("https://example.com/guide", false)).toEqual({
      type: "function",
      function: { name: "fetch_content" },
    })
  })

  it.each(["Cherche sur Internet la version de Tauri", "Vérifie en ligne cette information"])(
    "force search pour une demande explicite : %s",
    (text) => {
      expect(resolveWebChoice(text, false)).toEqual({
        type: "function",
        function: { name: "search" },
      })
    },
  )

  it("laisse le modèle choisir pour une question ordinaire", () => {
    expect(resolveWebChoice("Comment fonctionne le state dans React ?", false)).toBe("auto")
  })

  it("ne force pas une expression citée ou descriptive", () => {
    expect(resolveWebChoice('Le bouton « cherche sur Internet » est visible.', false)).toBe("auto")
  })
})
