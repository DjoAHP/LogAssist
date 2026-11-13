export type ApiErrorKind =
  | "auth" | "model_not_found" | "network" | "rate_limit" | "quota"
  | "unavailable" | "image_unsupported" | "context_length" | "persistence" | "unknown"

export const API_ERROR_KINDS: ApiErrorKind[] =
  ["auth", "model_not_found", "network", "rate_limit", "quota", "unavailable", "image_unsupported", "context_length", "persistence", "unknown"]

export interface ChatMessage {
  role: "system" | "user" | "assistant" | "tool"
  content: string
  images?: { base64: string; mimeType: string }[]
  toolCallId?: string
  toolCalls?: ToolCall[]
}

export interface ChatRequest { messages: ChatMessage[]; timeoutMs?: number }

export interface TokenUsage {
  inputTokens: number
  outputTokens: number
  cachedInputTokens?: number
}

export interface CompletionStats {
  text: string
  firstTokenMs: number
  totalMs: number
  usage?: TokenUsage
}

export interface ToolDefinition {
  type: "function"
  function: {
    name: string
    description?: string
    parameters: Record<string, unknown>
  }
}

export type ToolChoice =
  | "auto"
  | "required"
  | "none"
  | { type: "function"; function: { name: string } }

export interface ToolCall {
  id: string
  name: string
  arguments: Record<string, unknown>
}

export interface TurnOptions {
  tools?: ToolDefinition[]
  toolChoice?: ToolChoice
}

export interface TurnResult extends CompletionStats {
  toolCalls: ToolCall[]
}

export interface StreamCallbacks {
  onFirstToken?: () => void
  onDelta?: (text: string) => void
  onDone?: (stats: CompletionStats) => Promise<void> | void
  onError?: (e: Error) => Promise<void> | void // ApiError ou AbortError
}

export type TurnCallbacks = Pick<StreamCallbacks, "onFirstToken" | "onDelta">

export interface ProviderConfig {
  id: string
  name: string
  apiFamily: "openai" | "gemini"
  baseUrl: string
  secretRef: string // identifiant Credential Manager, pas la clé
}

export interface ModelConfig {
  id: string
  providerId: string
  modelId: string
  supportsImages: boolean
  isDefault: boolean
}
