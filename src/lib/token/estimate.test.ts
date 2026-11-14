import { describe, expect, it } from "vitest"
import { estimateTurnMetrics, metricsFromProviderUsage } from "./estimate"

const messages = [
  { role: "system" as const, content: "Tu aides." },
  { role: "user" as const, content: "Bonjour" },
]

describe("turn metrics", () => {
  it("marque le comptage local comme estimé", () => {
    const metrics = estimateTurnMetrics(messages, "Réponse", "https://serveur-prive.example/v1", "modele-inconnu")
    expect(metrics.inputTokens).toBeGreaterThan(0)
    expect(metrics.outputTokens).toBeGreaterThan(0)
    expect(metrics.usageSource).toBe("estimated")
    expect(metrics.costMicrousd).toBeNull()
  })

  it("compte une image selon ses dimensions sans compter son Base64", () => {
    const textOnly = estimateTurnMetrics([
      ...messages,
      { role: "user" as const, content: "Décris" },
    ], "Réponse", "http://localhost:1234/v1", "qwen")
    const shortBase64 = estimateTurnMetrics([
      ...messages,
      {
        role: "user" as const,
        content: "Décris",
        images: [{ base64: "A", mimeType: "image/png", width: 1024, height: 768 }],
      },
    ], "Réponse", "http://localhost:1234/v1", "qwen")
    const longBase64 = estimateTurnMetrics([
      ...messages,
      {
        role: "user" as const,
        content: "Décris",
        images: [{ base64: "A".repeat(1_000_000), mimeType: "image/png", width: 1024, height: 768 }],
      },
    ], "Réponse", "http://localhost:1234/v1", "qwen")

    expect(shortBase64.inputTokens).toBe(longBase64.inputTokens)
    expect(shortBase64.inputTokens).toBeGreaterThan(textOnly.inputTokens)
  })

  it("calcule le coût mini sans remise quand aucun token d'entrée n'est caché", () => {
    const metrics = metricsFromProviderUsage(
      { inputTokens: 1_000, outputTokens: 500, cachedInputTokens: 0 },
      "OpenAI",
      "gpt-4o-mini",
    )
    expect(metrics).toEqual({
      inputTokens: 1_000,
      outputTokens: 500,
      usageSource: "provider",
      costMicrousd: 450,
    })
  })

  it("applique le tarif réduit aux tokens d'entrée cachés", () => {
    expect(metricsFromProviderUsage(
      { inputTokens: 1_000, outputTokens: 500, cachedInputTokens: 400 },
      "OpenAI",
      "gpt-4o-mini",
    )).toEqual({
      inputTokens: 1_000,
      outputTokens: 500,
      usageSource: "provider",
      costMicrousd: 420,
    })
  })

  it("conserve l'usage fournisseur mais omet le coût si le cache est absent", () => {
    expect(metricsFromProviderUsage(
      { inputTokens: 1_000, outputTokens: 500 },
      "OpenAI",
      "gpt-4o-mini",
    )).toEqual({
      inputTokens: 1_000,
      outputTokens: 500,
      usageSource: "provider",
      costMicrousd: null,
    })
  })

  it("conserve l'usage fournisseur mais omet le coût si le cache dépasse l'entrée", () => {
    expect(metricsFromProviderUsage(
      { inputTokens: 1_000, outputTokens: 500, cachedInputTokens: 1_001 },
      "OpenAI",
      "gpt-4o-mini",
    )).toEqual({
      inputTokens: 1_000,
      outputTokens: 500,
      usageSource: "provider",
      costMicrousd: null,
    })
  })

  it("omet le coût si le modèle n'a aucun tarif d'entrée cachée vérifié", () => {
    expect(metricsFromProviderUsage(
      { inputTokens: 1_000, outputTokens: 500, cachedInputTokens: 0 },
      "OpenAI",
      "gpt-4-turbo",
    )).toEqual({
      inputTokens: 1_000,
      outputTokens: 500,
      usageSource: "provider",
      costMicrousd: null,
    })
  })

  it("utilise les tarifs corrigés de GPT-4o avec l'entrée cachée", () => {
    expect(metricsFromProviderUsage(
      { inputTokens: 1_000, outputTokens: 500, cachedInputTokens: 400 },
      "OpenAI",
      "gpt-4o",
    )).toEqual({
      inputTokens: 1_000,
      outputTokens: 500,
      usageSource: "provider",
      costMicrousd: 7_000,
    })
  })

  it("ne chiffre jamais une estimation locale même pour un endpoint officiel", () => {
    const metrics = estimateTurnMetrics(messages, "Réponse", "OpenAI", "gpt-4o-mini")

    expect(metrics.inputTokens).toBeGreaterThan(0)
    expect(metrics.outputTokens).toBeGreaterThan(0)
    expect(metrics.usageSource).toBe("estimated")
    expect(metrics.costMicrousd).toBeNull()
  })

  it.each([
    ["un compteur négatif", { inputTokens: -1, outputTokens: 0 }],
    ["un compteur décimal", { inputTokens: 0, outputTokens: 0.5 }],
    ["un compteur infini", { inputTokens: Number.POSITIVE_INFINITY, outputTokens: 0 }],
    ["un compteur NaN", { inputTokens: 0, outputTokens: Number.NaN }],
    ["un compteur supérieur à MAX_SAFE_INTEGER", {
      inputTokens: Number.MAX_SAFE_INTEGER + 1,
      outputTokens: 0,
    }],
  ])("rejette %s", (_label, usage) => {
    expect(metricsFromProviderUsage(usage, "OpenAI", "gpt-4o-mini")).toBeNull()
  })

  it("conserve les compteurs valides quand leur coût ne peut pas être représenté sûrement", () => {
    expect(metricsFromProviderUsage(
      {
        inputTokens: 0,
        outputTokens: Number.MAX_SAFE_INTEGER,
        cachedInputTokens: 0,
      },
      "OpenAI",
      "gpt-4",
    )).toEqual({
      inputTokens: 0,
      outputTokens: Number.MAX_SAFE_INTEGER,
      usageSource: "provider",
      costMicrousd: null,
    })
  })
})
