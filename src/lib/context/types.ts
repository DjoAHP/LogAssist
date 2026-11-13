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

export interface KnowledgeDocument {
  id: string
  name: string
  content: string
  sortOrder: number
}

export interface KnowledgeChunk {
  documentId: string
  documentName: string
  fingerprint: string
  chunkIndex: number
  headingPath: string[]
  content: string
  tokenEstimate: number
}

export interface RankedKnowledgeChunk extends KnowledgeChunk {
  score: number
}

export interface ContextHistoryMessage {
  id: string
  role: "user" | "assistant"
  content: string
}

export interface HistorySelection {
  messages: ContextHistoryMessage[]
  selectedTurns: number
  omittedTurns: number
  tokens: number
}
