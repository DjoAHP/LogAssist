import { describe, expect, it } from "vitest"
import { getModelPricing, getTiktokenModel, resolvePricingProvider } from "./pricing"
import * as pricingTools from "./pricing"

describe("pricing", () => {
  it("ne fournit un tokenizer exact qu’à un modèle OpenAI officiel connu", () => {
    const getExactTiktokenModel = (pricingTools as typeof pricingTools & {
      getExactTiktokenModel(baseUrl: string, modelId: string): string | null
    }).getExactTiktokenModel
    expect(pricingTools).toHaveProperty("getExactTiktokenModel")
    expect(getExactTiktokenModel("https://api.openai.com/v1", "gpt-4o-mini")).toBe("gpt-4o-mini")
    expect(getExactTiktokenModel("http://localhost:1234/v1", "gpt-4o-mini")).toBeNull()
    expect(getExactTiktokenModel("https://openrouter.ai/api/v1", "openai/gpt-4o-mini")).toBeNull()
    expect(getExactTiktokenModel("https://api.openai.com/v1", "modele-inconnu")).toBeNull()
  })

  it("normalise le nom du fournisseur", () => {
    expect(getModelPricing(" OpenAI ", "gpt-4o-mini")).toMatchObject({
      input: 0.15,
      cachedInput: 0.075,
      output: 0.6,
    })
  })

  it("utilise les tarifs officiels vérifiés de GPT-4o", () => {
    expect(getModelPricing("openai", "gpt-4o")).toMatchObject({
      input: 2.5,
      cachedInput: 1.25,
      output: 10,
    })
  })

  it("ne prétend pas connaître le tarif caché des autres modèles", () => {
    expect(getModelPricing("openai", "gpt-4-turbo")).not.toHaveProperty("cachedInput")
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
    ["gpt-4o-2024-11-20", "gpt-4o"],
    ["gpt-4o-2024-08-06", "gpt-4o"],
    ["gpt-4o-mini-2024-07-18", "gpt-4o-mini"],
  ] as const)("normalise le snapshot officiel %s pour pricing et tokenizer", (snapshot, alias) => {
    expect(getModelPricing("openai", snapshot)).toEqual(getModelPricing("openai", alias))
    expect(getTiktokenModel("Serveur privé", snapshot)).toBe(alias)
  })

  it.each([
    "gpt-4o-2024-8-06",
    "gpt-4o-2024-08-06-preview",
    "gpt-4o-mini-latest",
    "gpt-4o-2099-99-99",
    "gpt-4o-mini-9999-99-99",
    "gpt-4o-2024-05-13",
  ])("ne normalise pas un snapshot non répertorié : %s", (modelId) => {
    expect(getModelPricing("openai", modelId)).toBeNull()
    expect(getTiktokenModel("Serveur privé", modelId)).toBe("cl100k_base")
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
