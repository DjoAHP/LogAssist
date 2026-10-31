import { describe, it, expect, vi, beforeEach } from "vitest"

// Le store s'appuie sur le repo settings existant : on le mocke.
const mockGet = vi.hoisted(() => vi.fn())
const mockSet = vi.hoisted(() => vi.fn())
vi.mock("@/lib/db/settings", () => ({
  settings: { get: mockGet, set: mockSet },
}))

import { loadPromptSettings, savePromptSettings } from "@/lib/prompts/store"
import { DEFAULT_GENERAL_INSTRUCTIONS, PROFILE_APPRENTISSAGE } from "@/lib/prompts/defaults"

beforeEach(() => {
  vi.clearAllMocks()
})

describe("loadPromptSettings", () => {
  it("retourne les défauts quand aucune clé n'est stockée", async () => {
    mockGet.mockResolvedValue(null)
    const s = await loadPromptSettings()
    expect(s.general).toBe(DEFAULT_GENERAL_INSTRUCTIONS)
    expect(s.profile).toBe(PROFILE_APPRENTISSAGE)
    expect(mockGet).toHaveBeenCalledWith("prompt.general")
    expect(mockGet).toHaveBeenCalledWith("prompt.profile")
  })

  it("retourne les valeurs stockées quand elles existent", async () => {
    mockGet.mockImplementation((key: string) =>
      key === "prompt.general" ? Promise.resolve("Texte custom") : Promise.resolve(null),
    )
    const s = await loadPromptSettings()
    expect(s.general).toBe("Texte custom")
    expect(s.profile).toBe(PROFILE_APPRENTISSAGE)
  })

  it("une valeur stockée vide reste vide (choix explicite de l'utilisateur)", async () => {
    mockGet.mockImplementation((key: string) =>
      key === "prompt.profile" ? Promise.resolve("") : Promise.resolve(null),
    )
    const s = await loadPromptSettings()
    expect(s.general).toBe(DEFAULT_GENERAL_INSTRUCTIONS)
    expect(s.profile).toBe("")
  })
})

describe("savePromptSettings", () => {
  it("écrit les deux clés dans settings", async () => {
    await savePromptSettings({ general: "G", profile: "P" })
    expect(mockSet).toHaveBeenCalledWith("prompt.general", "G")
    expect(mockSet).toHaveBeenCalledWith("prompt.profile", "P")
  })
})
