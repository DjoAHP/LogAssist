export type McpServerId = "tinyfish"

export type WebToolName = "search" | "fetch_content"

export type WebSourceOrigin = WebToolName

export interface WebSource {
  url: string
  title?: string
  origin: WebSourceOrigin
}

export type WebStatus = "searching" | "fetching"

export type McpErrorKind =
  | "not_configured"
  | "auth"
  | "rate_limit"
  | "timeout"
  | "network"
  | "tool_denied"
  | "invalid_response"
  | "unknown"

export type WebToolRequest =
  | { tool: "search"; arguments: { query: string; purpose?: string } }
  | { tool: "fetch_content"; arguments: { urls: string[]; purpose?: string } }

export interface WebToolResult {
  content: string
  sources: WebSource[]
}

export interface WebAccessConfig {
  enabled: boolean
  configured: boolean
}
