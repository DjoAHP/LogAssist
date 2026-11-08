export type McpServerId = string

export type McpTransport = "streamable_http"

export type McpAuthConfig =
  | { type: "none" }
  | { type: "bearer" }
  | { type: "api_key"; header: string }

export type McpApprovalMode = "confirm" | "auto"

export type McpAuthStatus = "not_required" | "missing" | "configured" | "stale"

export interface McpServerConfig {
  id: string
  name: string
  endpoint: string
  transport: McpTransport
  auth: McpAuthConfig
  timeoutMs: number
  enabled: boolean
  builtin: boolean
}

export interface McpServerRow {
  id: string
  name: string
  endpoint: string
  transport: McpTransport
  auth_type: McpAuthConfig["type"]
  header_name: string | null
  timeout_ms: number
  enabled: number
  builtin: number
  created_at: string
  updated_at: string
}

export interface McpToolAnnotations {
  readOnlyHint?: boolean
  destructiveHint?: boolean
  idempotentHint?: boolean
  openWorldHint?: boolean
}

export interface McpDiscoveredTool {
  nativeName: string
  title?: string
  description?: string
  inputSchema: Record<string, unknown>
  outputSchema?: Record<string, unknown>
  annotations?: McpToolAnnotations
  schemaHash: string
}

export interface McpAgentTool {
  serverId: string
  serverName: string
  nativeName: string
  llmName: string
  title?: string
  description?: string
  inputSchema: Record<string, unknown>
  approvalMode: McpApprovalMode
  kind: "tinyfish_web" | "generic"
}

export interface McpRuntimeServer extends McpServerConfig {
  tools: Array<{
    nativeName: string
    inputSchema: Record<string, unknown>
    enabled: boolean
  }>
}

export interface McpResourceLink {
  uri: string
  name?: string
  description?: string
  mimeType?: string
}

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
  | "invalid_config"
  | "auth"
  | "timeout"
  | "rate_limit"
  | "offline"
  | "tool_not_found"
  | "invalid_arguments"
  | "protocol"
  | "cancelled"
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

export interface McpToolResult {
  content: string
  structuredContent?: unknown
  resourceLinks: McpResourceLink[]
  sources: WebSource[]
  isError: boolean
}

export interface McpToolApprovalRequest {
  id: string
  serverId: string
  serverName: string
  toolName: string
  toolTitle?: string
  arguments: Record<string, unknown>
}

export interface McpToolRow {
  server_id: string
  native_name: string
  llm_name: string
  title: string | null
  description: string | null
  input_schema: string
  output_schema: string | null
  annotations: string | null
  enabled: number
  approval_mode: McpApprovalMode
  schema_hash: string
  discovered_at: string
}

export interface WebAccessConfig {
  enabled: boolean
  configured: boolean
}
