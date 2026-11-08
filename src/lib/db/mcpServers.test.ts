import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const { execute, select, executeTransaction } = vi.hoisted(() => ({
  execute: vi.fn(),
  select: vi.fn(),
  executeTransaction: vi.fn(),
}))

vi.mock("@/lib/db/database", () => ({
  execute,
  select,
  executeTransaction,
}))

import {
  mcpServers,
  serverConfigFromRow,
  StaleMcpDiscoveryError,
} from "@/lib/db/mcpServers"
import type { McpImportDiff } from "@/lib/mcp/importConfig"
import type {
  McpDiscoveredTool,
  McpServerConfig,
  McpServerRow,
  McpToolRow,
} from "@/lib/mcp/types"

const NOW = "2026-11-08T12:00:00.000Z"

const LIST_SQL =
  "SELECT id, name, endpoint, transport, auth_type, header_name, timeout_ms, enabled, builtin, created_at, updated_at FROM mcp_servers ORDER BY builtin DESC, created_at ASC"
const LIST_TOOLS_SQL =
  "SELECT server_id, native_name, llm_name, title, description, input_schema, output_schema, annotations, enabled, approval_mode, schema_hash, discovered_at FROM mcp_tools WHERE server_id = ? ORDER BY native_name ASC"
const LIST_AGENT_TOOLS_SQL =
  "SELECT t.server_id, s.name AS server_name, t.native_name, t.llm_name, t.title, t.description, t.input_schema, t.annotations, t.approval_mode FROM mcp_tools t JOIN mcp_servers s ON s.id = t.server_id WHERE s.enabled = ? AND t.enabled = ? ORDER BY t.llm_name ASC"
const SERVER_BY_ID_SQL =
  "SELECT id, name, endpoint, transport, auth_type, header_name, timeout_ms, enabled, builtin, created_at, updated_at FROM mcp_servers WHERE id = ?"

interface Statement {
  sql: string
  bind?: unknown[]
}

function statementsFromLastTransaction(): Statement[] {
  const call = executeTransaction.mock.calls[executeTransaction.mock.calls.length - 1]
  expect(call).toBeDefined()
  return call?.[0] as Statement[]
}

function serverRow(overrides: Partial<McpServerRow> = {}): McpServerRow {
  return {
    id: "github",
    name: "GitHub",
    endpoint: "https://example.com/mcp",
    transport: "streamable_http",
    auth_type: "none",
    header_name: null,
    timeout_ms: 60_000,
    enabled: 1,
    builtin: 0,
    created_at: "2026-11-01T10:00:00.000Z",
    updated_at: "2026-11-01T10:00:00.000Z",
    ...overrides,
  }
}

function serverConfig(overrides: Partial<McpServerConfig> = {}): McpServerConfig {
  return {
    id: "github",
    name: "GitHub",
    endpoint: "https://example.com/mcp",
    transport: "streamable_http",
    auth: { type: "none" },
    timeoutMs: 60_000,
    enabled: true,
    builtin: false,
    ...overrides,
  }
}

function toolRow(overrides: Partial<McpToolRow> = {}): McpToolRow {
  return {
    server_id: "github",
    native_name: "search",
    llm_name: "github__search",
    title: "Recherche",
    description: "Recherche les dépôts",
    input_schema: JSON.stringify({ type: "object", properties: { query: { type: "string" } } }),
    output_schema: null,
    annotations: JSON.stringify({ readOnlyHint: true, destructiveHint: false }),
    enabled: 1,
    approval_mode: "auto",
    schema_hash: "hash-search",
    discovered_at: "2026-11-01T10:00:00.000Z",
    ...overrides,
  }
}

function discoveredTool(
  nativeName = "search",
  overrides: Partial<McpDiscoveredTool> = {},
): McpDiscoveredTool {
  return {
    nativeName,
    title: "Recherche actualisée",
    description: "Description actualisée",
    inputSchema: { type: "object", properties: { query: { type: "string" } } },
    outputSchema: { type: "object" },
    annotations: { readOnlyHint: true, destructiveHint: false },
    schemaHash: `new-hash-${nativeName}`,
    ...overrides,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  execute.mockResolvedValue(undefined)
  select.mockResolvedValue([])
  executeTransaction.mockResolvedValue(undefined)
})

afterEach(() => {
  vi.useRealTimers()
})

describe("conversion d'une ligne serveur MCP", () => {
  it.each([
    ["none", null, { type: "none" }],
    ["bearer", null, { type: "bearer" }],
    ["api_key", "X-API-Key", { type: "api_key", header: "X-API-Key" }],
  ] as const)("convertit l'authentification %s", (authType, headerName, expectedAuth) => {
    const config = serverConfigFromRow(
      serverRow({ auth_type: authType, header_name: headerName, enabled: 1, builtin: 1 }),
    )

    expect(config).toEqual({
      id: "github",
      name: "GitHub",
      endpoint: "https://example.com/mcp",
      transport: "streamable_http",
      auth: expectedAuth,
      timeoutMs: 60_000,
      enabled: true,
      builtin: true,
    })
  })

  it.each([null, "", "   "])(
    "refuse une ligne API Key sans header exploitable (%j)",
    (headerName) => {
      expect(() => serverConfigFromRow(
        serverRow({ auth_type: "api_key", header_name: headerName }),
      )).toThrow("Configuration MCP locale invalide")
    },
  )

  it.each([
    ["inconnu", "oauth"],
    ["absent", undefined],
  ])("refuse un type d'authentification %s", (_label, authType) => {
    expect(() => serverConfigFromRow(serverRow({
      auth_type: authType as McpServerRow["auth_type"],
    }))).toThrow("Configuration MCP locale invalide")
  })

  it("refuse un transport inconnu", () => {
    expect(() => serverConfigFromRow(serverRow({
      transport: "sse" as McpServerRow["transport"],
    }))).toThrow("Configuration MCP locale invalide")
  })
})

describe("lectures MCP", () => {
  it("retourne les lignes serveur brutes avec le tri SQL attendu", async () => {
    const row = serverRow()
    select.mockResolvedValueOnce([row])

    const result = await mcpServers.list()

    expect(result).toEqual([row])
    expect(result[0]).toBe(row)
    expect(select).toHaveBeenCalledExactlyOnceWith(LIST_SQL, [])
  })

  it("liste les outils d'un serveur avec le SQL et les binds exacts", async () => {
    const row = toolRow()
    select.mockResolvedValueOnce([row])

    await expect(mcpServers.listTools("github")).resolves.toEqual([row])
    expect(select).toHaveBeenCalledExactlyOnceWith(LIST_TOOLS_SQL, ["github"])
  })

  it("mappe le catalogue agent complet et sécurise le mode auto", async () => {
    select.mockResolvedValueOnce([
      {
        ...toolRow({
          server_id: "tinyfish",
          native_name: "search",
          llm_name: "tinyfish__search",
          annotations: null,
        }),
        server_name: "TinyFish",
      },
      {
        ...toolRow({
          server_id: "github",
          native_name: "issues",
          llm_name: "github__issues",
          title: null,
          description: null,
        }),
        server_name: "GitHub",
      },
      {
        ...toolRow({
          server_id: "filesystem",
          native_name: "remove",
          llm_name: "filesystem__remove",
          annotations: JSON.stringify({ readOnlyHint: true, destructiveHint: true }),
          approval_mode: "auto",
        }),
        server_name: "Fichiers",
      },
    ])

    await expect(mcpServers.listAgentTools()).resolves.toEqual([
      {
        serverId: "tinyfish",
        serverName: "TinyFish",
        nativeName: "search",
        llmName: "tinyfish__search",
        title: "Recherche",
        description: "Recherche les dépôts",
        inputSchema: { type: "object", properties: { query: { type: "string" } } },
        approvalMode: "auto",
        kind: "tinyfish_web",
      },
      {
        serverId: "github",
        serverName: "GitHub",
        nativeName: "issues",
        llmName: "github__issues",
        title: undefined,
        description: undefined,
        inputSchema: { type: "object", properties: { query: { type: "string" } } },
        approvalMode: "auto",
        kind: "generic",
      },
      {
        serverId: "filesystem",
        serverName: "Fichiers",
        nativeName: "remove",
        llmName: "filesystem__remove",
        title: "Recherche",
        description: "Recherche les dépôts",
        inputSchema: { type: "object", properties: { query: { type: "string" } } },
        approvalMode: "confirm",
        kind: "generic",
      },
    ])
    expect(select).toHaveBeenCalledExactlyOnceWith(LIST_AGENT_TOOLS_SQL, [1, 1])
  })

  it.each([
    ["un JSON invalide", "{"],
    ["une chaîne JSON", JSON.stringify("schéma")],
    ["un tableau JSON", JSON.stringify([])],
  ])("refuse tout le catalogue lorsque input_schema contient %s", async (_label, inputSchema) => {
    select.mockResolvedValueOnce([
      {
        ...toolRow({ input_schema: inputSchema }),
        server_name: "GitHub",
      },
    ])

    await expect(mcpServers.listAgentTools()).rejects.toThrow(
      "Catalogue MCP local invalide",
    )
    expect(execute).not.toHaveBeenCalled()
    expect(executeTransaction).not.toHaveBeenCalled()
  })
})

describe("import MCP atomique", () => {
  it("crée un serveur désactivé sans jamais persister de secret", async () => {
    vi.useFakeTimers()
    vi.setSystemTime(NOW)
    const incoming = serverConfig({
      id: "gitlab",
      name: "GitLab",
      auth: { type: "api_key", header: "X-GitLab-Key" },
      enabled: true,
      builtin: true,
    })
    const diff: McpImportDiff = { kind: "create", incoming, sensitive: false }

    await expect(mcpServers.applyImport([diff])).resolves.toEqual([])

    expect(executeTransaction).toHaveBeenCalledTimes(1)
    expect(statementsFromLastTransaction()).toEqual([
      {
        sql: "INSERT INTO mcp_servers (id, name, endpoint, transport, auth_type, header_name, timeout_ms, enabled, builtin) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
        bind: [
          "gitlab",
          "GitLab",
          "https://example.com/mcp",
          "streamable_http",
          "api_key",
          "X-GitLab-Key",
          60_000,
          0,
          0,
        ],
      },
    ])
  })

  it("n'émet aucun IPC pour un import entièrement inchangé", async () => {
    const current = serverConfig()
    const diff: McpImportDiff = {
      kind: "unchanged",
      incoming: serverConfig({ enabled: false }),
      current,
      sensitive: false,
    }

    await expect(mcpServers.applyImport([diff])).resolves.toEqual([])

    expect(executeTransaction).not.toHaveBeenCalled()
    expect(execute).not.toHaveBeenCalled()
    expect(select).not.toHaveBeenCalled()
  })

  it("met à jour un serveur non builtin sans modifier enabled ni supprimer ses outils", async () => {
    vi.useFakeTimers()
    vi.setSystemTime(NOW)
    const diff: McpImportDiff = {
      kind: "update",
      incoming: serverConfig({
        name: "GitHub Enterprise",
        endpoint: "https://binding-sensible.example/mcp",
        auth: { type: "api_key", header: "X-Binding-Sensible" },
        enabled: false,
      }),
      current: serverConfig({ enabled: true }),
      sensitive: false,
    }

    await expect(mcpServers.applyImport([diff])).resolves.toEqual([])

    const statements = statementsFromLastTransaction()
    expect(statements).toHaveLength(1)
    expect(statements[0]?.sql).toBe(
      "UPDATE mcp_servers SET name = ?, timeout_ms = ?, updated_at = ? WHERE id = ? AND builtin = 0",
    )
    expect(statements[0]?.sql).not.toContain("enabled =")
    expect(statements[0]?.bind).toEqual([
      "GitHub Enterprise",
      60_000,
      NOW,
      "github",
    ])
    expect(statements.some(({ sql }) => sql.startsWith("DELETE"))).toBe(false)
  })

  it.each([
    ["un serveur builtin", "builtin-remote", true],
    ["TinyFish", "tinyfish", false],
  ])("refuse une mise à jour sensible de %s sans aucun IPC", async (_label, id, builtin) => {
    const current = serverConfig({ id, builtin })
    const diff: McpImportDiff = {
      kind: "update",
      incoming: serverConfig({ id, endpoint: "https://new.example/mcp" }),
      current,
      sensitive: true,
    }

    await expect(mcpServers.applyImport([diff])).rejects.toThrow(/serveur MCP intégré/i)
    expect(executeTransaction).not.toHaveBeenCalled()
    expect(execute).not.toHaveBeenCalled()
  })

  it("désactive et invalide le catalogue après une mise à jour sensible", async () => {
    vi.useFakeTimers()
    vi.setSystemTime(NOW)
    const diff: McpImportDiff = {
      kind: "update",
      incoming: serverConfig({ endpoint: "https://new.example/mcp" }),
      current: serverConfig(),
      sensitive: true,
    }

    await expect(mcpServers.applyImport([diff])).resolves.toEqual(["github"])

    expect(statementsFromLastTransaction()).toEqual([
      {
        sql: "UPDATE mcp_servers SET name = ?, endpoint = ?, transport = ?, auth_type = ?, header_name = ?, timeout_ms = ?, enabled = ?, updated_at = ? WHERE id = ? AND builtin = ?",
        bind: [
          "GitHub",
          "https://new.example/mcp",
          "streamable_http",
          "none",
          null,
          60_000,
          0,
          NOW,
          "github",
          0,
        ],
      },
      {
        sql: "DELETE FROM mcp_tools WHERE server_id = ?",
        bind: ["github"],
      },
    ])
  })

  it("regroupe un lot mixte dans un seul IPC transactionnel", async () => {
    const created = serverConfig({ id: "gitlab", name: "GitLab" })
    const unchanged = serverConfig({ id: "linear", name: "Linear" })
    const sensitive = serverConfig({ id: "github", endpoint: "https://new.example/mcp" })
    const diffs: McpImportDiff[] = [
      { kind: "create", incoming: created, sensitive: false },
      {
        kind: "unchanged",
        incoming: unchanged,
        current: unchanged,
        sensitive: false,
      },
      {
        kind: "update",
        incoming: sensitive,
        current: serverConfig(),
        sensitive: true,
      },
    ]

    await expect(mcpServers.applyImport(diffs)).resolves.toEqual(["github"])

    expect(executeTransaction).toHaveBeenCalledTimes(1)
    expect(statementsFromLastTransaction()).toHaveLength(3)
  })
})

describe("réconciliation atomique du catalogue", () => {
  it("réserve les aliases globaux et préserve alias, activation et mode sûrs", async () => {
    vi.useFakeTimers()
    vi.setSystemTime(NOW)
    const expectedServer = serverConfig()
    const existing = toolRow({ llm_name: "alias_historique", enabled: 1, approval_mode: "auto" })
    select
      .mockResolvedValueOnce([serverRow()])
      .mockResolvedValueOnce([existing])
      .mockResolvedValueOnce([{ llm_name: "other__reserved" }])

    const reconciled = await mcpServers.replaceCatalog(expectedServer, [discoveredTool()])

    expect(select.mock.calls).toEqual([
      [SERVER_BY_ID_SQL, ["github"]],
      [
        "SELECT server_id, native_name, llm_name, title, description, input_schema, output_schema, annotations, enabled, approval_mode, schema_hash, discovered_at FROM mcp_tools WHERE server_id = ? ORDER BY native_name ASC",
        ["github"],
      ],
      ["SELECT llm_name FROM mcp_tools WHERE server_id != ?", ["github"]],
    ])
    expect(reconciled).toEqual([
      expect.objectContaining({
        server_id: "github",
        native_name: "search",
        llm_name: "alias_historique",
        enabled: 1,
        approval_mode: "auto",
        discovered_at: NOW,
      }),
    ])
    const statements = statementsFromLastTransaction()
    expect(statements[0]).toEqual({
      sql: "DELETE FROM mcp_tools WHERE server_id = ?",
      bind: ["github"],
    })
    expect(statements[1]).toEqual({
      sql: "INSERT INTO mcp_tools (server_id, native_name, llm_name, title, description, input_schema, output_schema, annotations, enabled, approval_mode, schema_hash, discovered_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      bind: [
        "github",
        "search",
        "alias_historique",
        "Recherche actualisée",
        "Description actualisée",
        JSON.stringify({ type: "object", properties: { query: { type: "string" } } }),
        JSON.stringify({ type: "object" }),
        JSON.stringify({ readOnlyHint: true, destructiveHint: false }),
        1,
        "auto",
        "new-hash-search",
        NOW,
      ],
    })
  })

  it("rejette causalement une découverte A lorsque le serveur stocké est devenu B", async () => {
    const expectedServer = serverConfig({ endpoint: "https://a.example/mcp" })
    select.mockResolvedValueOnce([
      serverRow({ endpoint: "https://b.example/mcp" }),
    ])

    await expect(
      mcpServers.replaceCatalog(expectedServer, [discoveredTool()]),
    ).rejects.toBeInstanceOf(StaleMcpDiscoveryError)

    expect(select.mock.calls).toEqual([[SERVER_BY_ID_SQL, ["github"]]])
    expect(executeTransaction).not.toHaveBeenCalled()
    expect(execute).not.toHaveBeenCalled()
  })

  it.each([
    {
      label: "le type d'authentification",
      expected: serverConfig({ auth: { type: "none" } }),
      current: serverRow({ auth_type: "bearer" }),
    },
    {
      label: "le header API Key",
      expected: serverConfig({ auth: { type: "api_key", header: "X-Expected-Key" } }),
      current: serverRow({ auth_type: "api_key", header_name: "X-Current-Key" }),
    },
  ])("rejette la découverte lorsque $label a changé", async ({ expected, current }) => {
    select.mockResolvedValueOnce([current])

    await expect(
      mcpServers.replaceCatalog(expected, [discoveredTool()]),
    ).rejects.toBeInstanceOf(StaleMcpDiscoveryError)

    expect(select).toHaveBeenCalledExactlyOnceWith(SERVER_BY_ID_SQL, [expected.id])
    expect(executeTransaction).not.toHaveBeenCalled()
  })

  it("rejette une découverte dont le serveur a disparu sans écrire", async () => {
    select.mockResolvedValueOnce([])

    await expect(
      mcpServers.replaceCatalog(serverConfig(), [discoveredTool()]),
    ).rejects.toBeInstanceOf(StaleMcpDiscoveryError)

    expect(select).toHaveBeenCalledExactlyOnceWith(SERVER_BY_ID_SQL, ["github"])
    expect(executeTransaction).not.toHaveBeenCalled()
    expect(execute).not.toHaveBeenCalled()
  })

  it("accepte le catalogue lorsque seuls le nom et le timeout ont changé", async () => {
    select
      .mockResolvedValueOnce([
        serverRow({ name: "GitHub renommé", timeout_ms: 90_000 }),
      ])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])

    await expect(
      mcpServers.replaceCatalog(serverConfig(), []),
    ).resolves.toEqual([])

    expect(executeTransaction).toHaveBeenCalledTimes(1)
  })

  it("compare un endpoint normalisé et le header API Key sans tenir compte de la casse", async () => {
    const expectedServer = serverConfig({
      endpoint: "https://EXAMPLE.com:443/mcp",
      auth: { type: "api_key", header: "X-API-Key" },
    })
    select
      .mockResolvedValueOnce([
        serverRow({
          endpoint: "https://example.com/mcp",
          auth_type: "api_key",
          header_name: "x-api-key",
        }),
      ])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])

    await expect(mcpServers.replaceCatalog(expectedServer, [])).resolves.toEqual([])
    expect(executeTransaction).toHaveBeenCalledTimes(1)
  })

  it("suffixe une collision avec l'alias d'un autre serveur", async () => {
    const expectedServer = serverConfig({ id: "a__" })
    select
      .mockResolvedValueOnce([serverRow({ id: "a__" })])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ llm_name: "a___b" }])

    const [reconciled] = await mcpServers.replaceCatalog(expectedServer, [discoveredTool("b")])

    expect(reconciled?.llm_name).not.toBe("a___b")
    expect(reconciled?.llm_name).toMatch(/^a___b__[a-z0-9]{7}$/)
    expect(statementsFromLastTransaction()[1]?.bind?.[2]).toBe(reconciled?.llm_name)
  })

  it("remplace un catalogue vide avec le seul DELETE atomique", async () => {
    select
      .mockResolvedValueOnce([serverRow()])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])

    await expect(mcpServers.replaceCatalog(serverConfig(), [])).resolves.toEqual([])

    expect(statementsFromLastTransaction()).toEqual([
      { sql: "DELETE FROM mcp_tools WHERE server_id = ?", bind: ["github"] },
    ])
  })
})

describe("mutations MCP simples", () => {
  it("paramètre l'activation d'un serveur et actualise sa date", async () => {
    vi.useFakeTimers()
    vi.setSystemTime(NOW)

    await mcpServers.setEnabled("github", false)

    expect(execute).toHaveBeenCalledExactlyOnceWith(
      "UPDATE mcp_servers SET enabled = ?, updated_at = ? WHERE id = ?",
      [0, NOW, "github"],
    )
  })

  it("paramètre l'activation d'un outil", async () => {
    await mcpServers.setToolEnabled("github", "search", true)

    expect(execute).toHaveBeenCalledExactlyOnceWith(
      "UPDATE mcp_tools SET enabled = ? WHERE server_id = ? AND native_name = ?",
      [1, "github", "search"],
    )
  })

  it("accepte auto pour un outil read-only non destructif", async () => {
    select.mockResolvedValueOnce([
      { annotations: JSON.stringify({ readOnlyHint: true, destructiveHint: false }) },
    ])

    await mcpServers.setApprovalMode("github", "search", "auto")

    expect(select).toHaveBeenCalledExactlyOnceWith(
      "SELECT annotations FROM mcp_tools WHERE server_id = ? AND native_name = ?",
      ["github", "search"],
    )
    expect(execute).toHaveBeenCalledExactlyOnceWith(
      "UPDATE mcp_tools SET approval_mode = ? WHERE server_id = ? AND native_name = ?",
      ["auto", "github", "search"],
    )
  })

  it("refuse auto pour un outil destructif sans émettre d'UPDATE", async () => {
    select.mockResolvedValueOnce([
      { annotations: JSON.stringify({ readOnlyHint: true, destructiveHint: true }) },
    ])

    await expect(mcpServers.setApprovalMode("github", "remove", "auto")).rejects.toThrow(
      /automatique|read-only|destructif/i,
    )
    expect(execute).not.toHaveBeenCalled()
  })

  it("ne modifie rien lorsque l'outil est absent", async () => {
    select.mockResolvedValueOnce([])

    await mcpServers.setApprovalMode("github", "missing", "confirm")

    expect(execute).not.toHaveBeenCalled()
  })

  it("refuse de supprimer TinyFish", async () => {
    await expect(mcpServers.remove("tinyfish")).rejects.toThrow(/TinyFish|builtin|intégré/i)
    expect(execute).not.toHaveBeenCalled()
  })

  it("supprime uniquement un serveur distant non builtin", async () => {
    await mcpServers.remove("github")

    expect(execute).toHaveBeenCalledExactlyOnceWith(
      "DELETE FROM mcp_servers WHERE id = ? AND builtin = ?",
      ["github", 0],
    )
  })
})

describe("file des mutations MCP", () => {
  it("ne démarre pas une seconde mutation avant la libération de la première", async () => {
    let releaseFirst!: () => void
    execute
      .mockImplementationOnce(
        () => new Promise<void>((resolve) => {
          releaseFirst = resolve
        }),
      )
      .mockResolvedValueOnce(undefined)

    const first = mcpServers.setEnabled("first", true)
    await vi.waitFor(() => expect(execute).toHaveBeenCalledTimes(1))
    const second = mcpServers.setToolEnabled("second", "search", true)
    await Promise.resolve()

    expect(execute).toHaveBeenCalledTimes(1)
    releaseFirst()
    await Promise.all([first, second])
    expect(execute).toHaveBeenCalledTimes(2)
  })

  it("libère la file après le rejet d'une mutation", async () => {
    let rejectFirst!: (reason: Error) => void
    execute
      .mockImplementationOnce(
        () => new Promise<void>((_resolve, reject) => {
          rejectFirst = reject
        }),
      )
      .mockResolvedValueOnce(undefined)

    const first = mcpServers.setEnabled("first", true)
    await vi.waitFor(() => expect(execute).toHaveBeenCalledTimes(1))
    const second = mcpServers.setEnabled("second", true)
    rejectFirst(new Error("échec transactionnel simulé"))

    await expect(first).rejects.toThrow("échec transactionnel simulé")
    await expect(second).resolves.toBeUndefined()
    expect(execute).toHaveBeenCalledTimes(2)
  })
})

describe("invariants d'intégrité des entrées", () => {
  it("ne mute ni les diffs d'import ni les outils découverts", async () => {
    const auth = Object.freeze({ type: "api_key" as const, header: "X-API-Key" })
    const incoming = Object.freeze(serverConfig({ id: "gitlab", auth }))
    const diff = Object.freeze({
      kind: "create" as const,
      incoming,
      sensitive: false as const,
    })
    const diffs = Object.freeze([diff])
    const discovered = Object.freeze(
      discoveredTool("search", {
        inputSchema: Object.freeze({ type: "object" }),
        annotations: Object.freeze({ readOnlyHint: true }),
      }),
    )
    const discoveredList = Object.freeze([discovered])
    const expectedServer = Object.freeze(serverConfig())
    const diffsBefore = structuredClone(diffs)
    const discoveredBefore = structuredClone(discoveredList)
    const expectedServerBefore = structuredClone(expectedServer)

    await mcpServers.applyImport(diffs)
    select
      .mockResolvedValueOnce([serverRow()])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
    await mcpServers.replaceCatalog(expectedServer, discoveredList)

    expect(diffs).toEqual(diffsBefore)
    expect(discoveredList).toEqual(discoveredBefore)
    expect(expectedServer).toEqual(expectedServerBefore)
  })

  it("n'envoie jamais une valeur secrète présente hors contrat dans SQL ou les binds", async () => {
    const forbiddenValue = "VALEUR_CONFIDENTIELLE_HORS_CONTRAT"
    const incoming = {
      ...serverConfig({ auth: { type: "bearer" } }),
      secret: forbiddenValue,
      token: forbiddenValue,
      accessIdentifierValue: forbiddenValue,
    } as McpServerConfig

    await mcpServers.applyImport([{ kind: "create", incoming, sensitive: false }])

    const databaseCalls = JSON.stringify({
      execute: execute.mock.calls,
      select: select.mock.calls,
      executeTransaction: executeTransaction.mock.calls,
    })
    expect(databaseCalls).not.toContain(forbiddenValue)
  })
})
