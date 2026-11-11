import type {
  McpAgentTool,
  McpDiscoveredTool,
  McpRuntimeServer,
  McpServerConfig,
  McpServerRow,
  McpToolApprovalRequest,
  McpToolResult,
  McpToolRow,
} from "@/lib/mcp/types"
import type { McpRuntimeSnapshot } from "@/lib/mcp/runtime"

export const server = (patch: Partial<McpServerConfig> = {}): McpServerConfig => ({
  id: "docs",
  name: "Docs",
  endpoint: "https://docs.example/mcp",
  transport: "streamable_http",
  auth: { type: "none" },
  timeoutMs: 60_000,
  enabled: false,
  builtin: false,
  ...patch,
})

export const remoteRow = (id = "docs", patch: Partial<McpServerRow> = {}): McpServerRow => ({
  id,
  name: id === "docs" ? "Docs" : id,
  endpoint: `https://${id}.example/mcp`,
  transport: "streamable_http",
  auth_type: "none",
  header_name: null,
  timeout_ms: 60_000,
  enabled: 0,
  builtin: 0,
  created_at: "2026-11-08 00:00:00",
  updated_at: "2026-11-08 00:00:00",
  ...patch,
})

export const tinyfishRow = (patch: Partial<McpServerRow> = {}): McpServerRow => remoteRow("tinyfish", {
  name: "TinyFish",
  endpoint: "https://agent.tinyfish.ai/mcp",
  auth_type: "bearer",
  builtin: 1,
  ...patch,
})

export const tool = (patch: Partial<McpToolRow> = {}): McpToolRow => ({
  server_id: "docs",
  native_name: "delete_data",
  llm_name: "docs__delete_data",
  title: "Delete data",
  description: "Delete data",
  input_schema: "{\"type\":\"object\"}",
  output_schema: null,
  annotations: null,
  enabled: 0,
  approval_mode: "confirm",
  schema_hash: "sha256:test",
  discovered_at: "2026-11-08T00:00:00Z",
  ...patch,
})

export const descriptor = (nativeName = "echo"): McpDiscoveredTool => ({
  nativeName,
  description: nativeName,
  inputSchema: { type: "object" },
  schemaHash: `sha256:${nativeName}`,
})

export const agentTool = (serverId = "docs", nativeName = "echo", llmName = `${serverId}__${nativeName}`): McpAgentTool => ({
  serverId,
  serverName: serverId,
  nativeName,
  llmName,
  description: nativeName,
  inputSchema: { type: "object" },
  approvalMode: "confirm",
  kind: "generic",
})

export const genericTool = (serverId: string, nativeName: string, llmName: string, approvalMode: "confirm" | "auto" = "confirm"): McpAgentTool => ({
  ...agentTool(serverId, nativeName, llmName),
  approvalMode,
})

export const tinyfishTool = (nativeName: "search" | "fetch_content"): McpAgentTool => ({
  ...agentTool("tinyfish", nativeName, `tinyfish__${nativeName}`),
  serverName: "TinyFish",
  approvalMode: "auto",
  kind: "tinyfish_web",
})

export const tinyfishToolRow = (nativeName: "search" | "fetch_content", enabled = 1): McpToolRow => tool({
  server_id: "tinyfish",
  native_name: nativeName,
  llm_name: `tinyfish__${nativeName}`,
  enabled,
  approval_mode: "auto",
  annotations: "{\"readOnlyHint\":true,\"destructiveHint\":false}",
})

export const runtimeServer = (patch: Partial<McpRuntimeServer> = {}): McpRuntimeServer => ({
  ...server(),
  tools: [],
  ...patch,
})

export const snapshot = (patch: Partial<McpRuntimeSnapshot> = {}): McpRuntimeSnapshot => ({
  servers: [],
  activeTools: [],
  authStatuses: {},
  webAccess: { enabled: false, configured: false },
  ...patch,
})

export const approval = (): McpToolApprovalRequest => ({
  id: "call-1",
  serverId: "docs",
  serverName: "Docs",
  toolName: "delete_data",
  arguments: {},
})

export const result = (content: string): McpToolResult => ({
  content,
  media: [],
  resourceLinks: [],
  sources: [],
  isError: false,
})