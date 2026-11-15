import { beforeEach, describe, expect, it, vi } from "vitest"
import type { McpAgentTool } from "@/lib/mcp/types"

const mockList = vi.hoisted(() => vi.fn())
const mockListTools = vi.hoisted(() => vi.fn())
const mockListAgentTools = vi.hoisted(() => vi.fn())
const mockSetEnabled = vi.hoisted(() => vi.fn())
const mockValidateConfigs = vi.hoisted(() => vi.fn())
const mockSyncRegistry = vi.hoisted(() => vi.fn())
const mockAuthStatus = vi.hoisted(() => vi.fn())
const mockBuildActiveToolCatalog = vi.hoisted(() => vi.fn((tools) => tools))
const mockBuildConnectorTools = vi.hoisted(() =>
  vi.fn<(context: unknown) => McpAgentTool[]>(() => []),
)

vi.mock("@/lib/db/mcpServers", () => ({
  mcpServers: {
    list: mockList,
    listTools: mockListTools,
    listAgentTools: mockListAgentTools,
    setEnabled: mockSetEnabled,
  },
  serverConfigFromRow: vi.fn((row) => ({
    id: row.id,
    name: row.name,
    endpoint: row.endpoint,
    transport: "streamable_http" as const,
    auth: row.auth_type === "bearer" ? { type: "bearer" as const } : { type: "none" as const },
    timeoutMs: row.timeout_ms,
    enabled: row.enabled === 1,
    builtin: row.builtin === 1,
  })),
}))

vi.mock("@/lib/mcp/client", () => ({
  mcp: {
    validateConfigs: mockValidateConfigs,
    syncRegistry: mockSyncRegistry,
    authStatus: mockAuthStatus,
  },
}))

vi.mock("@/lib/mcp/catalog", () => ({
  buildActiveToolCatalog: mockBuildActiveToolCatalog,
  MAX_ACTIVE_MCP_TOOLS: 64,
  MAX_ACTIVE_MCP_SCHEMA_BYTES: 256 * 1024,
}))

vi.mock("@/lib/connectors/tools", () => ({
  buildConnectorTools: mockBuildConnectorTools,
}))

import { loadMcpRuntime, EMPTY_MCP_RUNTIME } from "@/lib/mcp/runtime"
import { tinyfishRow, tinyfishToolRow, agentTool, tinyfishTool, tool } from "@/test/mcpFixtures"

function setupDefaultMocks() {
  mockValidateConfigs.mockResolvedValue(undefined)
  mockSyncRegistry.mockResolvedValue(undefined)
  mockAuthStatus.mockResolvedValue("not_required")
  mockList.mockResolvedValue([])
  mockListTools.mockResolvedValue([])
  mockListAgentTools.mockResolvedValue([])
  mockSetEnabled.mockResolvedValue(undefined)
  mockBuildConnectorTools.mockReturnValue([])
  mockBuildActiveToolCatalog.mockImplementation((tools) => tools)
}

beforeEach(() => {
  vi.resetAllMocks()
  setupDefaultMocks()
})

describe("loadMcpRuntime", () => {
  it("charge SQLite, synchronise Rust et construit le snapshot actif", async () => {
    mockList.mockResolvedValueOnce([tinyfishRow({ enabled: 1 })])
    mockListTools.mockResolvedValueOnce([tinyfishToolRow("search", 1)])
    mockAuthStatus.mockResolvedValueOnce("configured")
    mockListAgentTools.mockResolvedValueOnce([tinyfishTool("search")])

    const snapshot = await loadMcpRuntime()

    expect(mockSyncRegistry).toHaveBeenCalledWith([
      expect.objectContaining({ id: "tinyfish", enabled: true }),
    ])
    expect(snapshot.webAccess).toEqual({ enabled: true, configured: true })
    expect(snapshot.activeTools[0]?.llmName).toBe("tinyfish__search")
  })

  it("n'expose rien si la synchronisation Rust échoue", async () => {
    mockList.mockResolvedValueOnce([tinyfishRow({ enabled: 1 })])
    mockListTools.mockResolvedValueOnce([tinyfishToolRow("search", 1)])
    mockAuthStatus.mockResolvedValueOnce("configured")
    mockListAgentTools.mockResolvedValueOnce([tinyfishTool("search")])
    mockSyncRegistry.mockRejectedValueOnce(new Error("IPC"))

    await expect(loadMcpRuntime()).rejects.toThrow("IPC")
  })

  it("retourne un snapshot vide quand aucun serveur n'est configuré", async () => {
    mockList.mockResolvedValueOnce([])
    mockListAgentTools.mockResolvedValueOnce([])

    const snapshot = await loadMcpRuntime()

    expect(snapshot).toEqual(EMPTY_MCP_RUNTIME)
  })

  it("webAccess.enabled est false si tinyfish n'est pas activé", async () => {
    mockList.mockResolvedValueOnce([tinyfishRow({ enabled: 0 })])
    mockListTools.mockResolvedValueOnce([tinyfishToolRow("search", 1)])
    mockAuthStatus.mockResolvedValueOnce("configured")
    mockListAgentTools.mockResolvedValueOnce([tinyfishTool("search")])

    const snapshot = await loadMcpRuntime()

    expect(snapshot.webAccess.enabled).toBe(false)
    expect(snapshot.webAccess.configured).toBe(true)
  })

  it("webAccess.enabled est false si tinyfish n'est pas configuré", async () => {
    mockList.mockResolvedValueOnce([tinyfishRow({ enabled: 1 })])
    mockListTools.mockResolvedValueOnce([tinyfishToolRow("search", 1)])
    mockAuthStatus.mockResolvedValueOnce("missing")
    mockListAgentTools.mockResolvedValueOnce([tinyfishTool("search")])

    const snapshot = await loadMcpRuntime()

    expect(snapshot.webAccess.enabled).toBe(false)
    expect(snapshot.webAccess.configured).toBe(false)
  })

  it("webAccess.enabled est false si tinyfish n'a pas d'outil actif", async () => {
    mockList.mockResolvedValueOnce([tinyfishRow({ enabled: 1 })])
    mockListTools.mockResolvedValueOnce([tinyfishToolRow("search", 0)])
    mockAuthStatus.mockResolvedValueOnce("configured")
    mockListAgentTools.mockResolvedValueOnce([])

    const snapshot = await loadMcpRuntime()

    expect(snapshot.webAccess.enabled).toBe(false)
    expect(snapshot.webAccess.configured).toBe(true)
  })

  it("inclut les serveurs non-tinyfish dans le snapshot", async () => {
    const docsRow = tinyfishRow({ id: "docs", name: "Docs", endpoint: "https://docs.example/mcp", auth_type: "none", builtin: 0, enabled: 1 })
    mockList.mockResolvedValueOnce([docsRow, tinyfishRow({ enabled: 1 })])
    mockListTools.mockResolvedValueOnce([tool({ server_id: "docs", native_name: "search", llm_name: "docs__search", enabled: 1 })])
    mockListTools.mockResolvedValueOnce([tinyfishToolRow("search", 1)])
    mockAuthStatus.mockResolvedValueOnce("not_required")
    mockAuthStatus.mockResolvedValueOnce("configured")
    mockListAgentTools.mockResolvedValueOnce([
      agentTool("docs", "search", "docs__search"),
      tinyfishTool("search"),
    ])

    const snapshot = await loadMcpRuntime()

    expect(snapshot.servers).toHaveLength(2)
    expect(snapshot.activeTools).toHaveLength(2)
  })

  it("fusionne les outils du dépôt attaché dans le catalogue borné", async () => {
    const github = {
      binding: { owner: "DjoAHP", name: "LogAssist", ref: "main" },
      configured: true,
    }
    const mcpTool = agentTool("docs", "echo", "docs__echo")
    const connectorTool = {
      ...agentTool("connector_github", "repo_map", "connector_github__repo_map"),
      approvalMode: "auto" as const,
      kind: "connector" as const,
    }
    mockList.mockResolvedValueOnce([
      tinyfishRow({
        id: "docs",
        name: "Docs",
        endpoint: "https://docs.example/mcp",
        auth_type: "none",
        builtin: 0,
        enabled: 1,
      }),
    ])
    mockListTools.mockResolvedValueOnce([])
    mockAuthStatus.mockResolvedValueOnce("not_required")
    mockListAgentTools.mockResolvedValueOnce([mcpTool])
    mockBuildConnectorTools.mockReturnValueOnce([connectorTool])

    const snapshot = await loadMcpRuntime({ github })

    expect(mockBuildConnectorTools).toHaveBeenCalledWith(github)
    expect(mockBuildActiveToolCatalog).toHaveBeenCalledWith([mcpTool, connectorTool])
    expect(snapshot.activeTools).toEqual([mcpTool, connectorTool])
    expect(snapshot.connectors.github).toEqual(github)
  })
})
