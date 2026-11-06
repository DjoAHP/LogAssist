import { describe, expect, it } from "vitest"
import { getModelPricing, getTiktokenModel, resolvePricingProvider } from "./pricing"

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

  it.each([
    "https://api.openai.com/v1",
    "HTTPS://API.OPENAI.COM/V1/chat/completions",
  ])("reconnaît uniquement l'endpoint OpenAI officiel : %s", (baseUrl) => {
    expect(resolvePricingProvider(baseUrl)).toBe("openai")
  })

  it.each([
    "https://api.openai.com.evil.test/v1",
    "https://openrouter.ai/api/v1",
    "http://api.openai.com/v1",
    "https://api.openai.com:444/v1",
    "https://user:pass@api.openai.com/v1",
    "http://localhost:1234/v1",
    "invalid",
  ])("refuse une identité tarifaire non fiable : %s", (baseUrl) => {
    expect(resolvePricingProvider(baseUrl)).toBeNull()
  })

  it("accepte le port HTTPS standard normalisé par URL", () => {
    expect(resolvePricingProvider("https://api.openai.com:443/v1")).toBe("openai")
  })
})
