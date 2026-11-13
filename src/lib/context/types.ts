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
