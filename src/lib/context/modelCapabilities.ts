import type { ProviderModelContext } from "@/lib/ai/types"
import { isOfficialOpenAiBaseUrl } from "@/lib/ai/url"
import type { ModelContextProfile } from "./types"

const FALLBACK_CONTEXT_WINDOW = 4_096
const CACHE_TTL_MS = 30_000
const cache = new Map<string, { expiresAt: number; value: ProviderModelContext | null }>()
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
  const windowTokens = inspected.value?.contextWindowTokens ?? registryWindow ?? FALLBACK_CONTEXT_WINDOW
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
