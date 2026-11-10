import { buildActiveToolCatalog } from "./catalog"
import { mcpServers, serverConfigFromRow } from "@/lib/db/mcpServers"
import { mcp } from "./client"
import type {
  McpAgentTool,
  McpAuthStatus,
  McpRuntimeServer,
  WebAccessConfig,
} from "./types"

export interface McpRuntimeSnapshot {
  servers: McpRuntimeServer[]
  activeTools: McpAgentTool[]
  authStatuses: Record<string, McpAuthStatus>
  webAccess: WebAccessConfig
}

export const EMPTY_MCP_RUNTIME: McpRuntimeSnapshot = {
  servers: [],
  activeTools: [],
  authStatuses: {},
  webAccess: { enabled: false, configured: false },
}

export async function loadMcpRuntime(): Promise<McpRuntimeSnapshot> {
  const rows = await mcpServers.list()
  const toolLists = await Promise.all(rows.map((row) => mcpServers.listTools(row.id)))
  const servers: McpRuntimeServer[] = rows.map((row, index) => ({
    ...serverConfigFromRow(row),
    tools: toolLists[index].map((tool) => ({
      nativeName: tool.native_name,
      inputSchema: JSON.parse(tool.input_schema) as Record<string, unknown>,
      enabled: tool.enabled === 1,
    })),
  }))
  await mcp.validateConfigs(servers)
  await mcp.syncRegistry(servers)
  const statuses = await Promise.all(servers.map((server) => mcp.authStatus(server.id)))
  const authStatuses = Object.fromEntries(servers.map((server, index) => [server.id, statuses[index]]))
  const readyServerIds = new Set(
    servers
      .filter((server) => ["configured", "not_required"].includes(authStatuses[server.id]))
      .map((server) => server.id),
  )
  const activeTools = buildActiveToolCatalog(
    (await mcpServers.listAgentTools()).filter((tool) => readyServerIds.has(tool.serverId)),
  )
  const tinyfish = servers.find((server) => server.id === "tinyfish")
  const tinyfishReady = authStatuses.tinyfish === "configured" || authStatuses.tinyfish === "not_required"
  const tinyfishHasActiveTool = activeTools.some((tool) => tool.kind === "tinyfish_web")
  return {
    servers,
    activeTools,
    authStatuses,
    webAccess: {
      enabled: Boolean(tinyfish?.enabled) && tinyfishReady && tinyfishHasActiveTool,
      configured: tinyfishReady,
    },
  }
}