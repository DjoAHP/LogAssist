import { encoding_for_model, type Tiktoken } from "@dqbd/tiktoken"
import type { ChatMessage, ToolDefinition } from "@/lib/ai/types"
import { getExactTiktokenModel } from "@/lib/token/pricing"
import type { ContextTokenEstimator } from "./types"

function conservativeTextTokens(text: string): number {
  if (text.length === 0) return 0
  const codePoints = Array.from(text).length
  const bytes = new TextEncoder().encode(text).length
  return Math.max(1, Math.ceil(codePoints / 3), Math.ceil(bytes / 3))
}

function conservativeImageTokens(image: { width?: number; height?: number }): number {
  if (!image.width || !image.height || image.width <= 0 || image.height <= 0) return 4_096
  const patches = Math.ceil(image.width / 32) * Math.ceil(image.height / 32)
  return Math.min(8_192, Math.max(256, patches))
}

export function createTokenEstimator(input: {
  baseUrl: string
  modelId: string
}): ContextTokenEstimator {
  const exactModel = getExactTiktokenModel(input.baseUrl, input.modelId)
  let encoder: Tiktoken | null = null
  if (exactModel) {
    try {
      encoder = encoding_for_model(exactModel)
    } catch {
      encoder = null
    }
  }
  let disposed = false

  const countText = (text: string): number =>
    encoder ? encoder.encode(text).length : conservativeTextTokens(text)

  const countImage = (image: NonNullable<ChatMessage["images"]>[number]): number =>
    conservativeImageTokens(image)

  const countMessage = (message: ChatMessage): number => {
    let total = 4 + countText(message.role) + countText(message.content)
    if (message.toolCallId) total += countText(message.toolCallId)
    if (message.toolCalls?.length) {
      total += countText(JSON.stringify(message.toolCalls))
    }
    for (const image of message.images ?? []) total += countImage(image)
    return total
  }

  const countTools = (tools: readonly ToolDefinition[]): number =>
    tools.reduce((total, tool) => total + 8 + countText(JSON.stringify(tool)), 0)

  return {
    kind: encoder ? "openai_tiktoken" : "conservative",
    countText,
    countMessage,
    countMessages: (messages) => 2 + messages.reduce((total, message) => total + countMessage(message), 0),
    countTools,
    countImage,
    dispose: () => {
      if (disposed) return
      disposed = true
      encoder?.free()
      encoder = null
    },
  }
}
