import { describe, it, expect } from "vitest"
import { buildSystemPrompt } from "@/lib/prompts/compose"
import { DEFAULT_GENERAL_INSTRUCTIONS, PROFILE_APPRENTISSAGE } from "@/lib/prompts/defaults"

describe("buildSystemPrompt", () => {
  it("assemble général + profil + projet dans le bon ordre", () => {
    const p = buildSystemPrompt({ general: "GEN", profile: "PROF", project: "PROJ" })
    expect(p).toContain("## Instructions générales")
    expect(p.indexOf("GEN")).toBeLessThan(p.indexOf("## Profil"))
    expect(p.indexOf("PROF")).toBeLessThan(p.indexOf("## Projet"))
    expect(p.indexOf("PROJ")).toBeLessThan(p.length)
  })
  it("omet les sections vides/inexistantes", () => {
    const p = buildSystemPrompt({ general: "GEN", profile: "" })
    expect(p).toContain("GEN")
    expect(p).not.toContain("## Profil")
    expect(p).not.toContain("## Projet")
  })
  it("retourne une chaîne vide si tout est vide", () => {
    expect(buildSystemPrompt({ general: "", profile: "" })).toBe("")
  })
  it("trimme chaque section", () => {
    const p = buildSystemPrompt({ general: "  GEN  ", profile: " PROF " })
    expect(p).toContain("GEN\n"); expect(p).toContain("PROF")
  })
  it("les defaults sont non vides et pédagogiques", () => {
    expect(DEFAULT_GENERAL_INSTRUCTIONS.length).toBeGreaterThan(50)
    expect(PROFILE_APPRENTISSAGE.length).toBeGreaterThan(20)
  })
})
