import { describe, expect, it } from "vitest"
import { estimateTurnMetrics, metricsFromProviderUsage } from "./estimate"

const messages = [
  { role: "system" as const, content: "Tu aides." },
  { role: "user" as const, content: "Bonjour" },
]

describe("turn metrics", () => {
  it("marque le comptage local comme estimé", () => {
    const metrics = estimateTurnMetrics(messages, "Réponse", "Serveur privé", "modele-inconnu")
    expect(metrics.inputTokens).toBeGreaterThan(0)
    expect(metrics.outputTokens).toBeGreaterThan(0)
    expect(metrics.usageSource).toBe("estimated")
    expect(metrics.costMicrousd).toBeNull()
  })

  it("utilise l'usage fournisseur et calcule le coût seulement si le tarif est connu", () => {
    const metrics = metricsFromProviderUsage(
      { inputTokens: 1_000, outputTokens: 500 },
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
      { inputTokens: 0, outputTokens: Number.MAX_SAFE_INTEGER },
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
