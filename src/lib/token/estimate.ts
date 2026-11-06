import { encoding_for_model, get_encoding, type Tiktoken } from "@dqbd/tiktoken"
import type { ChatMessage, TokenUsage } from "@/lib/ai/types"
import type { TurnMetrics } from "./types"
import { getModelPricing, getTiktokenModel } from "./pricing"

function isValidTokenUsage(usage: unknown): usage is TokenUsage {
  if (typeof usage !== "object" || usage === null) return false

  const { inputTokens, outputTokens } = usage as Partial<TokenUsage>
  return typeof inputTokens === "number" &&
    Number.isSafeInteger(inputTokens) &&
    inputTokens >= 0 &&
    typeof outputTokens === "number" &&
    Number.isSafeInteger(outputTokens) &&
    outputTokens >= 0
}

function createEncoder(provider: string, modelId: string): Tiktoken {
  const model = getTiktokenModel(provider, modelId)
  try {
    return encoding_for_model(model)
  } catch {
    return get_encoding("cl100k_base")
  }
}

function calculateCostMicrousd(
  usage: TokenUsage,
  provider: string,
  modelId: string,
): number | null {
  const pricing = getModelPricing(provider, modelId)
  const cachedInputTokens = usage.cachedInputTokens
  if (
    !pricing ||
    cachedInputTokens === undefined ||
    !Number.isSafeInteger(cachedInputTokens) ||
    cachedInputTokens < 0 ||
    cachedInputTokens > usage.inputTokens ||
    pricing.cachedInput === undefined
  ) {
    return null
  }

  const ordinaryInputTokens = usage.inputTokens - cachedInputTokens
  const microUsd =
    ordinaryInputTokens * pricing.input +
    cachedInputTokens * pricing.cachedInput +
    usage.outputTokens * pricing.output
  if (!Number.isFinite(microUsd) || microUsd < 0) return null

  const roundedMicroUsd = Math.round(microUsd)
  return Number.isSafeInteger(roundedMicroUsd) ? roundedMicroUsd : null
}

export function metricsFromProviderUsage(
  usage: TokenUsage,
  provider: string,
  modelId: string,
): TurnMetrics | null {
  if (!isValidTokenUsage(usage)) return null

  return {
    inputTokens: usage.inputTokens,
    outputTokens: usage.outputTokens,
    usageSource: "provider",
    costMicrousd: calculateCostMicrousd(usage, provider, modelId),
  }
}

export function estimateTurnMetrics(
  messages: ChatMessage[],
  output: string,
  provider: string,
  modelId: string,
): TurnMetrics {
  const encoder = createEncoder(provider, modelId)
  try {
    const inputTokens = messages.reduce(
      (total, message) => total + encoder.encode(message.content).length,
      0,
    )
    const outputTokens = encoder.encode(output).length
    return {
      inputTokens,
      outputTokens,
      usageSource: "estimated",
      // Un comptage local ne permet pas de connaître la part réellement cachée.
      costMicrousd: null,
    }
  } finally {
    encoder.free()
  }
}
