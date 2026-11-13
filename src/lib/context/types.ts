import type { ChatMessage, ToolDefinition } from "@/lib/ai/types"

export type ContextWindowSource =
  | "manual"
  | "provider_loaded"
  | "provider_metadata"
  | "registry"
  | "fallback"

export type TokenizerKind = "openai_tiktoken" | "conservative"

export interface ModelContextProfile {
  contextWindowTokens: number
  maxOutputTokens: number
  source: ContextWindowSource
  tokenizer: TokenizerKind
}

export interface ContextTokenEstimator {
  readonly kind: TokenizerKind
  countText(text: string): number
  countMessage(message: ChatMessage): number
  countMessages(messages: readonly ChatMessage[]): number
  countTools(tools: readonly ToolDefinition[]): number
  countImage(image: NonNullable<ChatMessage["images"]>[number]): number
  dispose(): void
}
