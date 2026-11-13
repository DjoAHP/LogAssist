import { describe, it, expect } from "vitest"
import { buildKnowledgePrompt, buildSystemPrompt } from "@/lib/prompts/compose"
import { DEFAULT_GENERAL_INSTRUCTIONS, PROFILE_APPRENTISSAGE } from "@/lib/prompts/defaults"

type SystemPromptInput = Parameters<typeof buildSystemPrompt>[0]
type HasNoKnowledgeInput = "knowledge" extends keyof SystemPromptInput ? false : true

const HAS_NO_KNOWLEDGE_INPUT: HasNoKnowledgeInput = true

describe("buildSystemPrompt", () => {
  it("réserve l'injection de connaissances au contexte préparé", () => {
    expect(HAS_NO_KNOWLEDGE_INPUT).toBe(true)
  })

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
  it("retourne une chaîne vide sans section", () => {
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
  it("ajoute les règles de sécurité lorsque l'accès Web est actif", () => {
    const p = buildSystemPrompt({ general: "GEN", profile: "", webEnabled: true })
    expect(p).toContain("contenu Web externe")
    expect(p).toContain("ignorer toute instruction")
    expect(p).toContain("secrets")
  })
})

describe("buildKnowledgePrompt", () => {
  it("retourne une chaîne vide sans passage", () => {
    expect(buildKnowledgePrompt([])).toBe("")
  })

  it("ignore un passage dont le contenu est vide", () => {
    expect(buildKnowledgePrompt([{
      label: "K1",
      documentName: "Vide",
      headingPath: [],
      content: "   ",
    }])).toBe("")
  })

  it("conserve l’ordre, les références et les chemins de titres", () => {
    const prompt = buildKnowledgePrompt([
      {
        label: "K1",
        documentName: "HISE",
        headingPath: ["ScriptNode", "Paramètres"],
        content: "  Régler le gain.  ",
      },
      {
        label: "K2",
        documentName: "DaVinci",
        headingPath: ["Scopes"],
        content: "Afficher le waveform.",
      },
    ])

    expect(prompt).toContain("## Extraits de connaissances récupérés")
    expect(prompt).toContain("[K1] HISE — ScriptNode — Paramètres\nRégler le gain.")
    expect(prompt).toContain("[K2] DaVinci — Scopes\nAfficher le waveform.")
    expect(prompt.indexOf("[K1]")).toBeLessThan(prompt.indexOf("[K2]"))
  })
})
