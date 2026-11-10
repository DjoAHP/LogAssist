import type {
  McpAgentTool,
  McpDiscoveredTool,
  McpToolAnnotations,
  McpToolRow,
} from "@/lib/mcp/types"

export const MAX_ACTIVE_MCP_TOOLS = 64
export const MAX_ACTIVE_MCP_SCHEMA_BYTES = 256 * 1024

function shortHash(value: string): string {
  let hash = 0x811c9dc5
  for (const character of value) {
    hash ^= character.codePointAt(0) ?? 0
    hash = Math.imul(hash, 0x01000193)
  }
  return (hash >>> 0).toString(36).padStart(7, "0").slice(0, 7)
}

export function makeLlmToolName(
  serverId: string,
  nativeName: string,
  used: Set<string>,
): string {
  const sanitize = (value: string) =>
    value.replace(/[^a-zA-Z0-9_-]/g, "_").replace(/_+/g, "_")
  const normalized = `${sanitize(serverId)}__${sanitize(nativeName)}`
  let candidate = normalized.slice(0, 64)
  if (normalized.length > 64 || used.has(candidate)) {
    let salt = 0
    do {
      const suffix = `__${shortHash(`${serverId}\0${nativeName}\0${salt}`)}`
      candidate = `${normalized.slice(0, 64 - suffix.length)}${suffix}`
      salt++
    } while (used.has(candidate))
  }
  used.add(candidate)
  return candidate
}

function mayRunAutomatically(annotations?: McpToolAnnotations): boolean {
  return annotations?.readOnlyHint === true && annotations.destructiveHint !== true
}

export function reconcileDiscoveredTools(
  serverId: string,
  discovered: McpDiscoveredTool[],
  existingForServer: McpToolRow[],
  reservedAliases: ReadonlySet<string>,
  discoveredAt: string,
): McpToolRow[] {
  const byName = new Map(existingForServer.map((tool) => [tool.native_name, tool]))
  const used = new Set(reservedAliases)
  for (const tool of existingForServer) {
    used.add(tool.llm_name)
  }
  return discovered.map((tool) => {
    const previous = byName.get(tool.nativeName)
    const annotations = tool.annotations ?? {}
    return {
      server_id: serverId,
      native_name: tool.nativeName,
      llm_name: previous?.llm_name ?? makeLlmToolName(serverId, tool.nativeName, used),
      title: tool.title ?? null,
      description: tool.description ?? null,
      input_schema: JSON.stringify(tool.inputSchema),
      output_schema: tool.outputSchema ? JSON.stringify(tool.outputSchema) : null,
      annotations: JSON.stringify(annotations),
      enabled: previous?.enabled ?? 0,
      approval_mode:
        previous?.approval_mode === "auto" && mayRunAutomatically(annotations)
          ? "auto"
          : "confirm",
      schema_hash: tool.schemaHash,
      discovered_at: discoveredAt,
    }
  })
}

export function buildActiveToolCatalog(tools: McpAgentTool[]): McpAgentTool[] {
  if (tools.length > MAX_ACTIVE_MCP_TOOLS) {
    throw new Error("Maximum de 64 outils MCP actifs")
  }
  const bytes = new TextEncoder().encode(
    JSON.stringify(tools.map((tool) => tool.inputSchema)),
  ).byteLength
  if (bytes > MAX_ACTIVE_MCP_SCHEMA_BYTES) {
    throw new Error("Maximum de 256 Kio de schémas MCP actifs")
  }
  return tools
}
