import { execute, executeTransaction, select, type TransactionStatement } from "./database"
import { reconcileDiscoveredTools } from "@/lib/mcp/catalog"
import type {
  McpAgentTool,
  McpDiscoveredTool,
  McpServerConfig,
  McpServerRow,
  McpToolRow,
} from "@/lib/mcp/types"
import type { McpImportDiff } from "@/lib/mcp/importConfig"

const LIST_SERVERS_SQL =
  "SELECT id, name, endpoint, transport, auth_type, header_name, timeout_ms, enabled, builtin, created_at, updated_at FROM mcp_servers ORDER BY builtin DESC, created_at ASC"
const LIST_TOOLS_SQL =
  "SELECT server_id, native_name, llm_name, title, description, input_schema, output_schema, annotations, enabled, approval_mode, schema_hash, discovered_at FROM mcp_tools WHERE server_id = ? ORDER BY native_name ASC"
const LIST_AGENT_TOOLS_SQL =
  "SELECT t.server_id, s.name AS server_name, t.native_name, t.llm_name, t.title, t.description, t.input_schema, t.annotations, t.approval_mode FROM mcp_tools t JOIN mcp_servers s ON s.id = t.server_id WHERE s.enabled = ? AND t.enabled = ? ORDER BY t.llm_name ASC"
const SERVER_BY_ID_SQL =
  "SELECT id, name, endpoint, transport, auth_type, header_name, timeout_ms, enabled, builtin, created_at, updated_at FROM mcp_servers WHERE id = ?"
const INSERT_SERVER_SQL =
  "INSERT INTO mcp_servers (id, name, endpoint, transport, auth_type, header_name, timeout_ms, enabled, builtin) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)"
const UPDATE_SERVER_SQL =
  "UPDATE mcp_servers SET name = ?, timeout_ms = ?, updated_at = ? WHERE id = ? AND builtin = 0"
const UPDATE_SENSITIVE_SERVER_SQL =
  "UPDATE mcp_servers SET name = ?, endpoint = ?, transport = ?, auth_type = ?, header_name = ?, timeout_ms = ?, enabled = ?, updated_at = ? WHERE id = ? AND builtin = ?"
const DELETE_TOOLS_SQL = "DELETE FROM mcp_tools WHERE server_id = ?"
const INSERT_TOOL_SQL =
  "INSERT INTO mcp_tools (server_id, native_name, llm_name, title, description, input_schema, output_schema, annotations, enabled, approval_mode, schema_hash, discovered_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"

interface AgentToolRow {
  server_id: string
  server_name: string
  native_name: string
  llm_name: string
  title: string | null
  description: string | null
  input_schema: string
  annotations: string | null
  approval_mode: McpToolRow["approval_mode"]
}

interface AnnotationRow {
  annotations: string | null
}

let mutationTail: Promise<void> = Promise.resolve()

/**
 * Les mutations MCP partagent une file unique : les séquences lecture-écriture
 * ne peuvent donc pas réserver le même alias ni écraser un état plus récent.
 */
function runMcpMutation<T>(mutation: () => Promise<T>): Promise<T> {
  const previous = mutationTail
  let release!: () => void
  mutationTail = new Promise<void>((resolve) => {
    release = resolve
  })

  return (async () => {
    await previous
    try {
      return await mutation()
    } finally {
      // Un rejet ne doit jamais bloquer définitivement les mutations suivantes.
      release()
    }
  })()
}

function headerName(config: McpServerConfig): string | null {
  return config.auth.type === "api_key" ? config.auth.header : null
}

function parseObject(value: string | null): Record<string, unknown> | undefined {
  if (value === null) return undefined

  try {
    const parsed = JSON.parse(value) as unknown
    return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : undefined
  } catch {
    return undefined
  }
}

function permitsAutomaticApproval(annotations: string | null): boolean {
  const parsed = parseObject(annotations)
  return parsed?.readOnlyHint === true && parsed.destructiveHint !== true
}

function invalidLocalServer(): Error {
  return new Error("Configuration MCP locale invalide")
}

function parseInputSchema(value: string): Record<string, unknown> {
  let parsed: unknown
  try {
    parsed = JSON.parse(value) as unknown
  } catch {
    throw new Error("Catalogue MCP local invalide")
  }

  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error("Catalogue MCP local invalide")
  }
  return parsed as Record<string, unknown>
}

export class StaleMcpDiscoveryError extends Error {
  constructor() {
    super("La configuration MCP a changé depuis la découverte")
    this.name = "StaleMcpDiscoveryError"
  }
}

function normalizedEndpoint(endpoint: string): string | undefined {
  try {
    return new URL(endpoint).toString()
  } catch {
    return undefined
  }
}

function hasSameRemoteBinding(
  expected: McpServerConfig,
  current: McpServerConfig,
): boolean {
  const expectedEndpoint = normalizedEndpoint(expected.endpoint)
  const currentEndpoint = normalizedEndpoint(current.endpoint)
  if (
    expectedEndpoint === undefined ||
    currentEndpoint === undefined ||
    expectedEndpoint !== currentEndpoint ||
    expected.transport !== current.transport ||
    expected.auth.type !== current.auth.type
  ) {
    return false
  }

  return expected.auth.type !== "api_key" || (
    current.auth.type === "api_key" &&
    expected.auth.header.toLowerCase() === current.auth.header.toLowerCase()
  )
}

export function serverConfigFromRow(row: McpServerRow): McpServerConfig {
  if (String(row.transport) !== "streamable_http") {
    throw invalidLocalServer()
  }

  let auth: McpServerConfig["auth"]
  switch (String(row.auth_type)) {
    case "none":
      auth = { type: "none" }
      break
    case "bearer":
      auth = { type: "bearer" }
      break
    case "api_key":
      if (typeof row.header_name !== "string" || row.header_name.trim() === "") {
        throw invalidLocalServer()
      }
      auth = { type: "api_key", header: row.header_name }
      break
    default:
      throw invalidLocalServer()
  }

  return {
    id: row.id,
    name: row.name,
    endpoint: row.endpoint,
    transport: "streamable_http",
    auth,
    timeoutMs: row.timeout_ms,
    enabled: row.enabled === 1,
    builtin: row.builtin === 1,
  }
}

export const mcpServers = {
  async list(): Promise<McpServerRow[]> {
    return select<McpServerRow>(LIST_SERVERS_SQL, [])
  },

  async listTools(serverId: string): Promise<McpToolRow[]> {
    return select<McpToolRow>(LIST_TOOLS_SQL, [serverId])
  },

  async listAgentTools(): Promise<McpAgentTool[]> {
    const rows = await select<AgentToolRow>(LIST_AGENT_TOOLS_SQL, [1, 1])

    return rows.map((row) => ({
      serverId: row.server_id,
      serverName: row.server_name,
      nativeName: row.native_name,
      llmName: row.llm_name,
      title: row.title ?? undefined,
      description: row.description ?? undefined,
      inputSchema: parseInputSchema(row.input_schema),
      approvalMode:
        row.approval_mode === "auto" &&
        (row.server_id === "tinyfish" || permitsAutomaticApproval(row.annotations))
          ? "auto"
          : "confirm",
      kind: row.server_id === "tinyfish" ? "tinyfish_web" : "generic",
    }))
  },

  applyImport(items: readonly McpImportDiff[]): Promise<string[]> {
    return runMcpMutation(async () => {
      const statements: TransactionStatement[] = []
      const invalidated: string[] = []
      const updatedAt = new Date().toISOString()

      for (const item of items) {
        if (item.kind === "unchanged") continue

        const incoming = item.incoming
        if (item.kind === "create") {
          statements.push({
            sql: INSERT_SERVER_SQL,
            bind: [
              incoming.id,
              incoming.name,
              incoming.endpoint,
              incoming.transport,
              incoming.auth.type,
              headerName(incoming),
              incoming.timeoutMs,
              0,
              0,
            ],
          })
          continue
        }

        if (item.current.builtin || incoming.id === "tinyfish") {
          throw new Error("Un serveur MCP intégré ne peut pas être importé")
        }

        if (item.sensitive) {
          statements.push({
            sql: UPDATE_SENSITIVE_SERVER_SQL,
            bind: [
              incoming.name,
              incoming.endpoint,
              incoming.transport,
              incoming.auth.type,
              headerName(incoming),
              incoming.timeoutMs,
              0,
              updatedAt,
              incoming.id,
              0,
            ],
          })
          statements.push({ sql: DELETE_TOOLS_SQL, bind: [incoming.id] })
          invalidated.push(incoming.id)
          continue
        }

        statements.push({
          sql: UPDATE_SERVER_SQL,
          bind: [
            incoming.name,
            incoming.timeoutMs,
            updatedAt,
            incoming.id,
          ],
        })
      }

      if (statements.length > 0) {
        await executeTransaction(statements)
      }
      return invalidated
    })
  },

  replaceCatalog(
    expectedServer: McpServerConfig,
    discovered: readonly McpDiscoveredTool[],
  ): Promise<McpToolRow[]> {
    return runMcpMutation(async () => {
      const serverId = expectedServer.id
      const serverRows = await select<McpServerRow>(SERVER_BY_ID_SQL, [serverId])
      const serverRow = serverRows[0]
      if (!serverRow) {
        throw new StaleMcpDiscoveryError()
      }
      const currentServer = serverConfigFromRow(serverRow)
      if (!hasSameRemoteBinding(expectedServer, currentServer)) {
        throw new StaleMcpDiscoveryError()
      }

      const existingForServer = await select<McpToolRow>(LIST_TOOLS_SQL, [serverId])
      const reserved = await select<{ llm_name: string }>(
        "SELECT llm_name FROM mcp_tools WHERE server_id != ?",
        [serverId],
      )
      const reconciled = reconcileDiscoveredTools(
        serverId,
        [...discovered],
        existingForServer,
        new Set(reserved.map((row) => row.llm_name)),
        new Date().toISOString(),
      )
      const statements: TransactionStatement[] = [
        { sql: DELETE_TOOLS_SQL, bind: [serverId] },
        ...reconciled.map((tool) => ({
          sql: INSERT_TOOL_SQL,
          bind: [
            tool.server_id,
            tool.native_name,
            tool.llm_name,
            tool.title,
            tool.description,
            tool.input_schema,
            tool.output_schema,
            tool.annotations,
            tool.enabled,
            tool.approval_mode,
            tool.schema_hash,
            tool.discovered_at,
          ],
        })),
      ]

      await executeTransaction(statements)
      return reconciled
    })
  },

  setEnabled(id: string, enabled: boolean): Promise<void> {
    return runMcpMutation(() => execute(
      "UPDATE mcp_servers SET enabled = ?, updated_at = ? WHERE id = ?",
      [enabled ? 1 : 0, new Date().toISOString(), id],
    ))
  },

  setToolEnabled(serverId: string, nativeName: string, enabled: boolean): Promise<void> {
    return runMcpMutation(() => execute(
      "UPDATE mcp_tools SET enabled = ? WHERE server_id = ? AND native_name = ?",
      [enabled ? 1 : 0, serverId, nativeName],
    ))
  },

  setApprovalMode(
    serverId: string,
    nativeName: string,
    mode: McpToolRow["approval_mode"],
  ): Promise<void> {
    return runMcpMutation(async () => {
      const rows = await select<AnnotationRow>(
        "SELECT annotations FROM mcp_tools WHERE server_id = ? AND native_name = ?",
        [serverId, nativeName],
      )
      const row = rows[0]
      if (!row) return
      if (mode === "auto" && !permitsAutomaticApproval(row.annotations)) {
        throw new Error(
          "Le mode automatique est réservé aux outils read-only non destructifs",
        )
      }

      await execute(
        "UPDATE mcp_tools SET approval_mode = ? WHERE server_id = ? AND native_name = ?",
        [mode, serverId, nativeName],
      )
    })
  },

  remove(id: string): Promise<void> {
    return runMcpMutation(async () => {
      if (id === "tinyfish") {
        throw new Error("Le serveur TinyFish intégré ne peut pas être supprimé")
      }
      await execute(
        "DELETE FROM mcp_servers WHERE id = ? AND builtin = ?",
        [id, 0],
      )
    })
  },
}
