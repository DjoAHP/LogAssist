import type { ProviderModelContext } from "@/lib/ai/types"
import { ApiError } from "@/lib/ai/errors"
import { isOfficialOpenAiBaseUrl } from "@/lib/ai/url"
import { ContextLengthDiagnosticError } from "./diagnostics"
import type { ModelContextProfile } from "./types"

// Fenêtre optimiste : presque tous les modèles distants actuels offrent ≥ 16k.
// Une erreur context_length RÉELLE du fournisseur apprend une borne moitié,
// plancher 4096 (voir learnFromContextError) — le rejet local mandatory_overflow
// n'apprend rien : il vient de notre estimation, pas du modèle.
const FALLBACK_CONTEXT_WINDOW = 16_384
const LEARNED_CAP_FLOOR = 4_096
const CACHE_TTL_MS = 30_000
const cache = new Map<string, { expiresAt: number; value: ProviderModelContext | null }>()
// Dernière fenêtre EFFECTIVE résolue par clé (fournisseur/modèle) + borne apprise
// après une vraie erreur fournisseur. Survit à l'invalidation du cache d'inspection.
const lastResolved = new Map<string, { window: number; learnedCap: number | null }>()
const VERIFIED_OPENAI_WINDOWS: Record<string, number> = {
  "gpt-4o": 128_000,
  "gpt-4o-2024-11-20": 128_000,
  "gpt-4o-2024-08-06": 128_000,
  "gpt-4o-mini": 128_000,
  "gpt-4o-mini-2024-07-18": 128_000,
  "gpt-4-turbo": 128_000,
  "gpt-4": 8_192,
  "gpt-3.5-turbo": 16_385,
}

function outputReserve(windowTokens: number, override: number | null): number {
  const requested = override ?? Math.min(8_192, Math.max(1_024, Math.floor(windowTokens * 0.2)))
  return Math.min(requested, Math.max(1, windowTokens - 512))
}

function isValidWindow(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 512 && (value as number) <= 2_000_000
}

export function getVerifiedContextWindow(baseUrl: string, modelId: string): number | null {
  if (!isOfficialOpenAiBaseUrl(baseUrl)) return null
  return VERIFIED_OPENAI_WINDOWS[modelId] ?? null
}

export async function resolveModelContextProfile(input: {
  cacheKey: string
  contextWindowOverride: number | null
  maxOutputTokensOverride: number | null
  registryContextWindow?: number | null
  inspect(): Promise<ProviderModelContext | null>
  now?: number
}): Promise<ModelContextProfile> {
  if (input.contextWindowOverride !== null) {
    return {
      contextWindowTokens: input.contextWindowOverride,
      maxOutputTokens: outputReserve(input.contextWindowOverride, input.maxOutputTokensOverride),
      source: "manual",
      tokenizer: "conservative",
    }
  }

  const now = input.now ?? Date.now()
  let inspected = cache.get(input.cacheKey)
  if (!inspected || inspected.expiresAt <= now) {
    let value: ProviderModelContext | null = null
    try {
      const candidate = await input.inspect()
      if (candidate && isValidWindow(candidate.contextWindowTokens)) value = candidate
    } catch {
      value = null
    }
    inspected = { expiresAt: now + CACHE_TTL_MS, value }
    cache.set(input.cacheKey, inspected)
  }

  const registryWindow = isValidWindow(input.registryContextWindow)
    ? input.registryContextWindow
    : null
  const learned = lastResolved.get(input.cacheKey)
  const detected = inspected.value?.contextWindowTokens ?? registryWindow ?? FALLBACK_CONTEXT_WINDOW
  const windowTokens = learned?.learnedCap != null
    ? Math.min(detected, learned.learnedCap)
    : detected
  lastResolved.set(input.cacheKey, { window: windowTokens, learnedCap: learned?.learnedCap ?? null })
  return {
    contextWindowTokens: windowTokens,
    maxOutputTokens: outputReserve(windowTokens, input.maxOutputTokensOverride),
    source: inspected.value?.source === "loaded"
      ? "provider_loaded"
      : inspected.value?.source === "metadata"
        ? "provider_metadata"
        : registryWindow !== null
          ? "registry"
          : "fallback",
    tokenizer: "conservative",
  }
}

export function invalidateModelContextProfile(cacheKey: string): void {
  cache.delete(cacheKey)
}

/**
 * Apprend une borne de fenêtre après une VRAIE erreur context_length du
 * fournisseur (rejet du modèle, pas notre contrôle local). La borne vaut la
 * moitié de la dernière fenêtre effective, plancher 4096. Les rejets locaux
 * (ContextLengthDiagnosticError, mandatory_overflow) et les erreurs d'une
 * autre nature sont ignorés : ils ne prouvent rien sur la fenêtre du modèle.
 */
export function learnFromContextError(cacheKey: string, error: unknown): void {
  if (!(error instanceof ApiError) || error.kind !== "context_length") return
  if (error instanceof ContextLengthDiagnosticError) return

  const previous = lastResolved.get(cacheKey)
  const usedWindow = previous?.window ?? FALLBACK_CONTEXT_WINDOW
  const cap = Math.max(LEARNED_CAP_FLOOR, Math.floor(usedWindow / 2))
  const previousCap = previous?.learnedCap
  const learnedCap = previousCap != null ? Math.min(previousCap, cap) : cap
  lastResolved.set(cacheKey, { window: learnedCap, learnedCap })
}
