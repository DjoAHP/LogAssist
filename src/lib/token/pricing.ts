import { TiktokenModel } from "@dqbd/tiktoken"

/**
 * Configuration du pricing par provider et modèle.
 * Prix en USD par 1 000 000 tokens (input / output).
 * Sources : tarifs publics OpenAI, Anthropic, Google, OpenRouter (approx.).
 * À maintenir à jour selon les changements de tarifs.
 */

export interface ModelPricing {
  input: number   // USD par million de tokens d'entrée
  output: number  // USD par million de tokens de sortie
  tiktokenModel?: TiktokenModel  // modèle tiktoken pour encodage exact
}

export interface ProviderPricing {
  [modelId: string]: ModelPricing
}

export const MODEL_PRICING: Record<string, ProviderPricing> = {
  // --- OpenAI ---
  openai: {
    "gpt-4o": { input: 5.00, output: 15.00, tiktokenModel: "gpt-4o" as TiktokenModel },
    "gpt-4o-mini": { input: 0.15, output: 0.60, tiktokenModel: "gpt-4o-mini" as TiktokenModel },
    "gpt-4-turbo": { input: 10.00, output: 30.00, tiktokenModel: "gpt-4-turbo" as TiktokenModel },
    "gpt-4": { input: 30.00, output: 60.00, tiktokenModel: "gpt-4" as TiktokenModel },
    "gpt-3.5-turbo": { input: 0.50, output: 1.50, tiktokenModel: "gpt-3.5-turbo" as TiktokenModel },
    "o1-preview": { input: 15.00, output: 60.00, tiktokenModel: "o1-preview" as TiktokenModel },
    "o1-mini": { input: 3.00, output: 12.00, tiktokenModel: "o1-mini" as TiktokenModel },
  },

  // --- Anthropic (via OpenRouter ou direct) ---
  anthropic: {
    "claude-3.5-sonnet": { input: 3.00, output: 15.00, tiktokenModel: "cl100k_base" as TiktokenModel },
    "claude-3.5-haiku": { input: 0.80, output: 4.00, tiktokenModel: "cl100k_base" as TiktokenModel },
    "claude-3-opus": { input: 15.00, output: 75.00, tiktokenModel: "cl100k_base" as TiktokenModel },
    "claude-3-sonnet": { input: 3.00, output: 15.00, tiktokenModel: "cl100k_base" as TiktokenModel },
    "claude-3-haiku": { input: 0.25, output: 1.25, tiktokenModel: "cl100k_base" as TiktokenModel },
  },

  // --- Google ---
  google: {
    "gemini-1.5-pro": { input: 3.50, output: 10.50, tiktokenModel: "cl100k_base" as TiktokenModel },
    "gemini-1.5-flash": { input: 0.075, output: 0.30, tiktokenModel: "cl100k_base" as TiktokenModel },
    "gemini-1.0-pro": { input: 0.50, output: 1.50, tiktokenModel: "cl100k_base" as TiktokenModel },
  },

  // --- OpenRouter (agrégateur) - tarifs approximatifs ---
  // OpenRouter ajoute sa marge, ces prix sont indicatifs
  openrouter: {
    "openai/gpt-4o": { input: 5.00, output: 15.00, tiktokenModel: "gpt-4o" as TiktokenModel },
    "openai/gpt-4o-mini": { input: 0.15, output: 0.60, tiktokenModel: "gpt-4o-mini" as TiktokenModel },
    "anthropic/claude-3.5-sonnet": { input: 3.00, output: 15.00, tiktokenModel: "cl100k_base" as TiktokenModel },
    "anthropic/claude-3.5-haiku": { input: 0.80, output: 4.00, tiktokenModel: "cl100k_base" as TiktokenModel },
    "anthropic/claude-3-opus": { input: 15.00, output: 75.00, tiktokenModel: "cl100k_base" as TiktokenModel },
    "google/gemini-1.5-pro": { input: 3.50, output: 10.50, tiktokenModel: "cl100k_base" as TiktokenModel },
    "google/gemini-1.5-flash": { input: 0.075, output: 0.30, tiktokenModel: "cl100k_base" as TiktokenModel },
    "meta-llama/llama-3.1-405b-instruct": { input: 3.00, output: 3.00, tiktokenModel: "cl100k_base" as TiktokenModel },
    "meta-llama/llama-3.1-70b-instruct": { input: 0.80, output: 0.80, tiktokenModel: "cl100k_base" as TiktokenModel },
    "meta-llama/llama-3.1-8b-instruct": { input: 0.15, output: 0.15, tiktokenModel: "cl100k_base" as TiktokenModel },
    "mistralai/mistral-large": { input: 2.00, output: 6.00, tiktokenModel: "cl100k_base" as TiktokenModel },
    "mistralai/mistral-nemo": { input: 0.15, output: 0.15, tiktokenModel: "cl100k_base" as TiktokenModel },
    "qwen/qwen-2.5-72b-instruct": { input: 0.40, output: 0.40, tiktokenModel: "cl100k_base" as TiktokenModel },
  },

  // --- Fallback générique ---
  default: {
    "default": { input: 1.00, output: 2.00, tiktokenModel: "cl100k_base" as TiktokenModel },
  },
}

function normalizeProvider(provider: string): string {
  return provider.trim().toLowerCase()
}

/**
 * Récupère uniquement un tarif explicitement associé au fournisseur et au modèle.
 */
export function getModelPricing(provider: string, modelId: string): ModelPricing | null {
  const normalizedProvider = normalizeProvider(provider)
  if (normalizedProvider === "openrouter" || normalizedProvider === "default") return null

  const providerPricing = MODEL_PRICING[normalizedProvider]
  return providerPricing?.[modelId] ?? null
}

/**
 * Retourne le modèle tiktoken à utiliser pour l'encodage.
 */
export function getTiktokenModel(provider: string, modelId: string): TiktokenModel {
  const providerPricing = MODEL_PRICING[normalizeProvider(provider)]?.[modelId]
  if (providerPricing?.tiktokenModel) return providerPricing.tiktokenModel

  for (const pricing of Object.values(MODEL_PRICING)) {
    const knownModel = pricing[modelId]
    if (knownModel?.tiktokenModel) return knownModel.tiktokenModel
  }

  return "cl100k_base" as TiktokenModel
}
