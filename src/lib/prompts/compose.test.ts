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
  it("une connaissance activée porte le prompt quand les sections de base sont vides", () => {
    const p = buildSystemPrompt({ general: "", profile: "", knowledge: [{ name: "HISE", content: "md" }] })
    expect(p).toContain("## Connaissance : HISE")
    expect(p).not.toContain("## Instructions générales")
  })
  it("retourne une chaîne vide sans section ni connaissance", () => {
    expect(buildSystemPrompt({ general: "", profile: "" })).toBe("")
    expect(buildSystemPrompt({ general: "", profile: "", knowledge: [] })).toBe("")
  })
  it("trimme chaque section", () => {
    const p = buildSystemPrompt({ general: "  GEN  ", profile: " PROF " })
    expect(p).toContain("GEN\n"); expect(p).toContain("PROF")
  })
  it("les defaults sont non vides et pédagogiques", () => {
    expect(DEFAULT_GENERAL_INSTRUCTIONS.length).toBeGreaterThan(50)
    expect(PROFILE_APPRENTISSAGE.length).toBeGreaterThan(20)
  })
  it("injecte chaque connaissance activée après les sections de base", () => {
    const p = buildSystemPrompt({
      general: "GEN",
      profile: "PROF",
      knowledge: [
        { name: "HISE", content: "## Mode d'emploi HISE" },
        { name: "DaVinci", content: "## Color grading" },
      ],
    })
    expect(p).toContain("## Connaissance : HISE")
    expect(p).toContain("## Mode d'emploi HISE")
    expect(p).toContain("## Connaissance : DaVinci")
    expect(p.indexOf("## Profil")).toBeLessThan(p.indexOf("## Connaissance : HISE"))
    expect(p.indexOf("## Connaissance : HISE")).toBeLessThan(p.indexOf("## Connaissance : DaVinci"))
  })
  it("omet un contenu de connaissance vide", () => {
    const p = buildSystemPrompt({ general: "GEN", profile: "", knowledge: [{ name: "HISE", content: "  " }] })
    expect(p).not.toContain("## Connaissance : HISE")
  })
})
