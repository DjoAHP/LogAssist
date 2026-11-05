import { describe, expect, it } from "vitest"
import { getModelPricing, getTiktokenModel } from "./pricing"

describe("pricing", () => {
  it("normalise le nom du fournisseur", () => {
    expect(getModelPricing(" OpenAI ", "gpt-4o-mini")).toMatchObject({
      input: 0.15,
      output: 0.6,
    })
  })

  it("masque les tarifs OpenRouter approximatifs", () => {
    expect(getModelPricing("OpenRouter", "openai/gpt-4o-mini")).toBeNull()
  })

  it("masque le tarif générique réservé au pont legacy", () => {
    expect(getModelPricing("default", "default")).toBeNull()
  })

  it("ne fabrique aucun tarif pour un modèle inconnu", () => {
    expect(getModelPricing("Serveur privé", "modele-inconnu")).toBeNull()
  })

  it("conserve un encodeur générique pour un modèle inconnu", () => {
    expect(getTiktokenModel("Serveur privé", "modele-inconnu")).toBe("cl100k_base")
  })

  it("résout le tokenizer indépendamment du tarif fournisseur", () => {
    expect(getTiktokenModel("Serveur privé", "gpt-4o-mini")).toBe("gpt-4o-mini")
  })
})
