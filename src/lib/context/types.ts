import type { ChatMessage, ChatRequest, ToolDefinition } from "@/lib/ai/types"

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

export type ContextOmissionReason =
  | "budget_history"
  | "budget_knowledge"
  | "budget_mcp"
  | "mandatory_overflow"
  | "final_recheck"

export interface ContextTokenCategories {
  system: number
  knowledge: number
  history: number
  currentUser: number
  images: number
  tools: number
  mcpResults: number
  outputReserve: number
  safetyMargin: number
}

export interface ContextOmittedStats {
  knowledgeChunks: number
  historyTurns: number
  mcpSegments: number
  reasons: ContextOmissionReason[]
}

export interface ContextStats {
  categories: ContextTokenCategories
  inputTokens: number
  totalWithReserve: number
  selectedKnowledge: KnowledgeChunk[]
  historyMessages: number
  historyTurns: number
  omitted: ContextOmittedStats
}

export interface SafeContextDiagnostic {
  modelId: string
  contextWindowTokens: number
  contextWindowSource: ContextWindowSource
  tokenizer: TokenizerKind
  tokens: ContextTokenCategories & {
    input: number
    totalWithReserve: number
  }
  selected: {
    knowledge: Array<{ documentId: string; fingerprint: string; chunkIndex: number }>
    historyMessages: number
    historyTurns: number
  }
  omitted: ContextOmittedStats
}

export interface ContextDiagnosticSource {
  modelId: string
  profile: ModelContextProfile
  categories: ContextTokenCategories
  inputTokens: number
  totalWithReserve: number
  selectedKnowledge: KnowledgeChunk[]
  historyMessages: number
  historyTurns: number
  omitted: ContextOmittedStats
}

export type ContextAdditionalMessage =
  | { kind: "message"; message: ChatMessage }
  | {
      kind: "external_tool"
      toolCallId: string
      prefix: string
      segments: string[]
      suffix: string
    }

export interface ContextRoundInput {
  additionalMessages: ContextAdditionalMessage[]
  tools: ToolDefinition[]
}

export interface PreparedChatRequest extends ChatRequest {
  maxOutputTokens: number
}

export interface PreparedContextRound {
  request: PreparedChatRequest
  stats: ContextStats
}

export interface ContextSession {
  prepareRound(input: ContextRoundInput): PreparedContextRound
  estimateOutput(text: string): number
  dispose(): void
}
