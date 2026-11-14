import { describe, it, expect } from "vitest"
import { API_ERROR_KINDS } from "@/lib/ai/types"
import { KIND_TO_KEY } from "@/lib/ai/errors"
import { t } from "@/i18n/fr"

describe("garde-fou i18n des erreurs", () => {
  it("chaque ApiErrorKind a une entrée traduite", () => {
    for (const k of API_ERROR_KINDS) expect(t.errors[KIND_TO_KEY[k]]).toBeTruthy()
  })
  it("le mapping couvre exactement tous les kinds déclarés", () => {
    expect(Object.keys(KIND_TO_KEY)).toHaveLength(API_ERROR_KINDS.length)
  })

  it("déclare un libellé local dédié aux échecs de persistance", () => {
    expect(API_ERROR_KINDS).toContain("persistence")
    expect(KIND_TO_KEY).toHaveProperty("persistence", "persistence")
    expect(t.errors).toHaveProperty("persistence", "Réponse non enregistrée localement")
  })

  it("déclare un libellé dédié au contexte trop volumineux", () => {
    expect(API_ERROR_KINDS).toContain("context_length")
    expect(KIND_TO_KEY).toHaveProperty("context_length", "contextLength")
    expect(t.errors).toHaveProperty("contextLength")
    expect((t.errors as Record<string, string>).contextLength).toContain("contexte")
  })
})
