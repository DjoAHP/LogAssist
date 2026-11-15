import { describe, expect, it, vi } from "vitest"
import { ApiError } from "@/lib/ai/errors"
import {
  invalidateModelContextProfile,
  learnFromContextError,
  resolveModelContextProfile,
} from "./modelCapabilities"
import * as modelCapabilities from "./modelCapabilities"
import { ContextLengthDiagnosticError } from "./diagnostics"
import type { SafeContextDiagnostic } from "./types"

describe("resolveModelContextProfile", () => {
  it("donne la priorité à l’override sans appeler le fournisseur", async () => {
    const inspect = vi.fn()
    const profile = await resolveModelContextProfile({
      cacheKey: "manual/model",
      contextWindowOverride: 16_384,
      maxOutputTokensOverride: 2_048,
      inspect,
    })

    expect(profile).toMatchObject({
      contextWindowTokens: 16_384,
      maxOutputTokens: 2_048,
      source: "manual",
    })
    expect(inspect).not.toHaveBeenCalled()
  })

  it("utilise la fenêtre chargée puis réserve 20 % de sortie", async () => {
    const profile = await resolveModelContextProfile({
      cacheKey: "loaded/model",
      contextWindowOverride: null,
      maxOutputTokensOverride: null,
      inspect: vi.fn().mockResolvedValue({ contextWindowTokens: 8_192, source: "loaded" }),
    })

    expect(profile).toMatchObject({
      contextWindowTokens: 8_192,
      maxOutputTokens: 1_638,
      source: "provider_loaded",
    })
  })

  it("utilise le registre vérifié après une inspection sans métadonnée", async () => {
    const profile = await resolveModelContextProfile({
      cacheKey: "registry/model",
      contextWindowOverride: null,
      maxOutputTokensOverride: null,
      registryContextWindow: 128_000,
      inspect: vi.fn().mockResolvedValue(null),
    })

    expect(profile).toMatchObject({
      contextWindowTokens: 128_000,
      maxOutputTokens: 8_192,
      source: "registry",
    })
  })

  it("retombe sur une fenêtre optimiste de 16384 si l’inspection échoue", async () => {
    const profile = await resolveModelContextProfile({
      cacheKey: "fallback/model",
      contextWindowOverride: null,
      maxOutputTokensOverride: null,
      inspect: vi.fn().mockRejectedValue(new Error("offline")),
    })

    expect(profile).toMatchObject({
      contextWindowTokens: 16_384,
      maxOutputTokens: 3_276,
      source: "fallback",
    })
  })

  it("réutilise le cache puis permet son invalidation", async () => {
    const inspect = vi.fn()
      .mockResolvedValueOnce({ contextWindowTokens: 8_192, source: "loaded" })
      .mockResolvedValueOnce({ contextWindowTokens: 16_384, source: "loaded" })
    const input = {
      cacheKey: "cache/model",
      contextWindowOverride: null,
      maxOutputTokensOverride: null,
      inspect,
      now: 1_000,
    } as const

    expect((await resolveModelContextProfile(input)).contextWindowTokens).toBe(8_192)
    expect((await resolveModelContextProfile({ ...input, now: 2_000 })).contextWindowTokens).toBe(8_192)
    expect(inspect).toHaveBeenCalledTimes(1)

    invalidateModelContextProfile(input.cacheKey)
    expect((await resolveModelContextProfile({ ...input, now: 2_001 })).contextWindowTokens).toBe(16_384)
    expect(inspect).toHaveBeenCalledTimes(2)
  })
})

describe("getVerifiedContextWindow", () => {
  const getVerifiedContextWindow = (modelCapabilities as typeof modelCapabilities & {
    getVerifiedContextWindow(baseUrl: string, modelId: string): number | null
  }).getVerifiedContextWindow

  it("ne fait confiance qu’au catalogue d’un endpoint OpenAI officiel", () => {
    expect(modelCapabilities).toHaveProperty("getVerifiedContextWindow")
    expect(getVerifiedContextWindow("https://api.openai.com/v1", "gpt-4o-mini")).toBe(128_000)
    expect(getVerifiedContextWindow("http://localhost:1234/v1", "gpt-4o-mini")).toBeNull()
    expect(getVerifiedContextWindow("https://openrouter.ai/api/v1", "openai/gpt-4o-mini")).toBeNull()
  })
})

describe("apprentissage adaptatif de la fenêtre (erreurs fournisseur)", () => {
  const resolve = (cacheKey: string, detectedWindow?: number) =>
    resolveModelContextProfile({
      cacheKey,
      contextWindowOverride: null,
      maxOutputTokensOverride: null,
      inspect: vi.fn().mockResolvedValue(
        detectedWindow === undefined
          ? null
          : { contextWindowTokens: detectedWindow, source: "metadata" },
      ),
    })

  it("divise la fenêtre par deux après une vraie erreur fournisseur, plancher 4096", async () => {
    const cacheKey = "learn/provider"
    const providerError = new ApiError("context_length", "réponse trop longue")

    expect((await resolve(cacheKey)).contextWindowTokens).toBe(16_384)
    learnFromContextError(cacheKey, providerError)
    expect((await resolve(cacheKey)).contextWindowTokens).toBe(8_192)
    learnFromContextError(cacheKey, providerError)
    expect((await resolve(cacheKey)).contextWindowTokens).toBe(4_096)
    learnFromContextError(cacheKey, providerError)
    expect((await resolve(cacheKey)).contextWindowTokens).toBe(4_096)
  })

  it("borne aussi une fenêtre détectée chez le fournisseur", async () => {
    const cacheKey = "learn/metadata"

    expect((await resolve(cacheKey, 131_072)).contextWindowTokens).toBe(131_072)
    learnFromContextError(cacheKey, new ApiError("context_length", "réponse trop longue"))
    expect((await resolve(cacheKey, 131_072)).contextWindowTokens).toBe(65_536)
  })

  it("ignore les rejets locaux mandatory_overflow (diagnostic interne)", async () => {
    const cacheKey = "learn/local"

    expect((await resolve(cacheKey)).contextWindowTokens).toBe(16_384)
    learnFromContextError(
      cacheKey,
      new ContextLengthDiagnosticError({} as SafeContextDiagnostic),
    )
    expect((await resolve(cacheKey)).contextWindowTokens).toBe(16_384)
  })

  it("ignore les erreurs qui ne sont pas context_length", async () => {
    const cacheKey = "learn/auth"

    expect((await resolve(cacheKey)).contextWindowTokens).toBe(16_384)
    learnFromContextError(cacheKey, new ApiError("auth", "clé refusée"))
    learnFromContextError(cacheKey, new Error("réseau"))
    expect((await resolve(cacheKey)).contextWindowTokens).toBe(16_384)
  })

  it("garde les clés de cache indépendantes", async () => {
    learnFromContextError("learn/iso-a", new ApiError("context_length", "x"))
    expect((await resolve("learn/iso-b")).contextWindowTokens).toBe(16_384)
  })

  it("ne plafonne jamais l’override manuel", async () => {
    const cacheKey = "learn/manual"
    learnFromContextError(cacheKey, new ApiError("context_length", "x"))

    const profile = await resolveModelContextProfile({
      cacheKey,
      contextWindowOverride: 16_384,
      maxOutputTokensOverride: null,
      inspect: vi.fn(),
    })
    expect(profile).toMatchObject({ contextWindowTokens: 16_384, source: "manual" })
  })

  it("conserve la borne apprise malgré l’invalidation du cache d’inspection", async () => {
    const cacheKey = "learn/survive"
    expect((await resolve(cacheKey)).contextWindowTokens).toBe(16_384)
    learnFromContextError(cacheKey, new ApiError("context_length", "x"))
    invalidateModelContextProfile(cacheKey)
    expect((await resolve(cacheKey)).contextWindowTokens).toBe(8_192)
  })
})
