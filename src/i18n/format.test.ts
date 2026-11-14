import { describe, expect, it } from "vitest"
import { formatTemplate } from "./format"

describe("formatTemplate", () => {
  it("remplace les jetons par les valeurs et conserve le reste du texte", () => {
    expect(formatTemplate("Fenêtre {window} — outils {tools}", { window: 16_384, tools: 24_189 }))
      .toBe("Fenêtre 16384 — outils 24189")
  })

  it("laisse intact un jeton sans valeur fournie", () => {
    expect(formatTemplate("A {absent} B", { present: 1 })).toBe("A {absent} B")
  })
})
