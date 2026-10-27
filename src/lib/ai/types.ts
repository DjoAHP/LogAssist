export type ApiErrorKind =
  | "auth" | "model_not_found" | "network" | "rate_limit" | "quota"
  | "unavailable" | "image_unsupported" | "unknown"

export interface ChatMessage {
  role: "system" | "user" | "assistant"
  content: string
  images?: { base64: string; mimeType: string }[]
}

export interface ChatRequest { messages: ChatMessage[]; timeoutMs?: number }

export interface CompletionStats { text: string; firstTokenMs: number; totalMs: number }

export interface StreamCallbacks {
  onFirstToken?: () => void
  onDelta?: (text: string) => void
  onDone?: (stats: CompletionStats) => void
  onError?: (e: Error) => void // ApiError ou AbortError
}

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
