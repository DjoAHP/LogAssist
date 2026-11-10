import { describe, expect, it } from "vitest"

import {
  buildActiveToolCatalog,
  makeLlmToolName,
  MAX_ACTIVE_MCP_SCHEMA_BYTES,
  reconcileDiscoveredTools,
} from "@/lib/mcp/catalog"
import type {
  McpAgentTool,
  McpDiscoveredTool,
  McpToolAnnotations,
  McpToolRow,
} from "@/lib/mcp/types"

const DISCOVERED_AT = "2026-11-08T12:00:00.000Z"

function discoveredTool(
  nativeName: string,
  annotations?: McpToolAnnotations,
): McpDiscoveredTool {
  return {
    nativeName,
    inputSchema: { type: "object" },
    annotations,
    schemaHash: `hash-${nativeName}`,
  }
}

function storedTool(
  nativeName: string,
  overrides: Partial<McpToolRow> = {},
): McpToolRow {
  return {
    server_id: "github",
    native_name: nativeName,
    llm_name: `github__${nativeName}`,
    title: null,
    description: null,
    input_schema: JSON.stringify({ type: "object" }),
    output_schema: null,
    annotations: JSON.stringify({ readOnlyHint: true }),
    enabled: 0,
    approval_mode: "confirm",
    schema_hash: `old-hash-${nativeName}`,
    discovered_at: "2026-01-01T00:00:00.000Z",
    ...overrides,
  }
}

function agentTool(
  index: number,
  inputSchema: Record<string, unknown> = {},
): McpAgentTool {
  return {
    serverId: "github",
    serverName: "GitHub",
    nativeName: `tool-${index}`,
    llmName: `github__tool-${index}`,
    inputSchema,
    approvalMode: "confirm",
    kind: "generic",
  }
}

describe("alias des outils MCP", () => {
  it("préfixe le nom natif avec l'identifiant du serveur", () => {
    expect(makeLlmToolName("github", "search", new Set())).toBe("github__search")
  })

  it("limite un alias long à 64 caractères avec un suffixe déterministe", () => {
    const used = new Set<string>()

    const first = makeLlmToolName("github", "search-".repeat(20), used)
    const second = makeLlmToolName("github", "search-".repeat(20), new Set())

    expect(first).toHaveLength(64)
    expect(first).toMatch(/__[a-z0-9]{7}$/)
    expect(second).toBe(first)
  })

  it("résout chaque collision normalisée, même si le premier suffixe est occupé", () => {
    const used = new Set<string>()

    const normalized = makeLlmToolName("github", "pull request", used)
    const firstCollision = makeLlmToolName("github", "pull@request", used)
    const secondCollision = makeLlmToolName("github", "pull@request", used)

    expect(normalized).toBe("github__pull_request")
    expect(firstCollision).toMatch(/__[a-z0-9]{7}$/)
    expect(secondCollision).toMatch(/__[a-z0-9]{7}$/)
    expect(new Set([normalized, firstCollision, secondCollision]).size).toBe(3)
  })
})

describe("réconciliation des outils MCP découverts", () => {
  it("préserve l'alias et l'activation d'un outil connu par son nom natif", () => {
    const existing = [
      storedTool("search", {
        llm_name: "alias_historique",
        enabled: 1,
      }),
    ]

    const [reconciled] = reconcileDiscoveredTools(
      "github",
      [discoveredTool("search", { readOnlyHint: true })],
      existing,
      new Set(),
      DISCOVERED_AT,
    )

    expect(reconciled).toMatchObject({
      native_name: "search",
      llm_name: "alias_historique",
      enabled: 1,
    })
  })

  it.each(
    [
      ["l'annotation read-only disparaît", {}],
      ["l'outil devient destructif", { readOnlyHint: true, destructiveHint: true }],
    ] satisfies Array<[string, McpToolAnnotations]>,
  )(
    "rétrograde auto vers confirm lorsque %s",
    (_label, annotations) => {
      const existing = [storedTool("search", { approval_mode: "auto" })]

      const [reconciled] = reconcileDiscoveredTools(
        "github",
        [discoveredTool("search", annotations)],
        existing,
        new Set(),
        DISCOVERED_AT,
      )

      expect(reconciled.approval_mode).toBe("confirm")
    },
  )

  it("désactive un nouvel outil et exige une confirmation", () => {
    const [reconciled] = reconcileDiscoveredTools(
      "github",
      [discoveredTool("issues", { readOnlyHint: true })],
      [],
      new Set(),
      DISCOVERED_AT,
    )

    expect(reconciled).toMatchObject({
      native_name: "issues",
      enabled: 0,
      approval_mode: "confirm",
    })
  })

  it("retire du résultat un outil qui n'est plus découvert", () => {
    const reconciled = reconcileDiscoveredTools(
      "github",
      [discoveredTool("search")],
      [storedTool("search"), storedTool("removed")],
      new Set(),
      DISCOVERED_AT,
    )

    expect(reconciled.map((tool) => tool.native_name)).toEqual(["search"])
  })

  it("évite un alias réservé par un autre serveur", () => {
    const reservedAliases = new Set(["a___b"])

    const [reconciled] = reconcileDiscoveredTools(
      "a__",
      [discoveredTool("b")],
      [],
      reservedAliases,
      DISCOVERED_AT,
    )
    const [repeated] = reconcileDiscoveredTools(
      "a__",
      [discoveredTool("b")],
      [],
      new Set(["a___b"]),
      DISCOVERED_AT,
    )

    expect(reconciled.llm_name).not.toBe("a___b")
    expect(reconciled.llm_name.length).toBeLessThanOrEqual(64)
    expect(reconciled.llm_name).toMatch(/^a___b__[a-z0-9]{7}$/)
    expect(repeated.llm_name).toBe(reconciled.llm_name)
  })

  it("ne mute pas les alias réservés reçus", () => {
    const reservedAliases = new Set(["github__existing"])
    const before = new Set(reservedAliases)

    reconcileDiscoveredTools(
      "github",
      [discoveredTool("search")],
      [],
      reservedAliases,
      DISCOVERED_AT,
    )

    expect(reservedAliases).toEqual(before)
  })

  it("retourne le même résultat pour les mêmes entrées explicites", () => {
    const discovered = [
      discoveredTool("search", { readOnlyHint: true, destructiveHint: false }),
    ]
    const existing = [storedTool("search", { enabled: 1 })]
    const reservedAliases = new Set(["other__search"])

    const first = reconcileDiscoveredTools(
      "github",
      discovered,
      existing,
      reservedAliases,
      DISCOVERED_AT,
    )
    const second = reconcileDiscoveredTools(
      "github",
      discovered,
      existing,
      reservedAliases,
      DISCOVERED_AT,
    )

    expect(second).toEqual(first)
    expect(first[0].discovered_at).toBe(DISCOVERED_AT)
  })

  it("conserve auto pour un outil explicitement read-only et non destructif", () => {
    const [reconciled] = reconcileDiscoveredTools(
      "github",
      [discoveredTool("search", { readOnlyHint: true, destructiveHint: false })],
      [storedTool("search", { approval_mode: "auto" })],
      new Set(),
      DISCOVERED_AT,
    )

    expect(reconciled.approval_mode).toBe("auto")
  })
})

describe("plafonds du catalogue MCP actif", () => {
  it("refuse 65 outils actifs", () => {
    const tools = Array.from({ length: 65 }, (_, index) => agentTool(index))

    expect(() => buildActiveToolCatalog(tools)).toThrow(
      "Maximum de 64 outils MCP actifs",
    )
  })

  it("refuse plus de 256 Kio de schémas cumulés", () => {
    const tools = [
      agentTool(0, { payload: "x".repeat(MAX_ACTIVE_MCP_SCHEMA_BYTES) }),
    ]

    expect(() => buildActiveToolCatalog(tools)).toThrow(
      "Maximum de 256 Kio de schémas MCP actifs",
    )
  })

  it("accepte 64 outils à la limite de taille sans les muter", () => {
    const schemas: Record<string, unknown>[] = Array.from(
      { length: 64 },
      (_, index) => (index === 0 ? { payload: "" } : {}),
    )
    const emptyPayloadBytes = new TextEncoder().encode(JSON.stringify(schemas)).byteLength
    schemas[0] = {
      payload: "x".repeat(MAX_ACTIVE_MCP_SCHEMA_BYTES - emptyPayloadBytes),
    }
    const tools = schemas.map((schema, index) => agentTool(index, schema))
    const before = structuredClone(tools)

    for (const tool of tools) {
      Object.freeze(tool.inputSchema)
      Object.freeze(tool)
    }
    Object.freeze(tools)

    expect(
      new TextEncoder().encode(JSON.stringify(tools.map((tool) => tool.inputSchema)))
        .byteLength,
    ).toBe(MAX_ACTIVE_MCP_SCHEMA_BYTES)
    expect(buildActiveToolCatalog(tools)).toBe(tools)
    expect(tools).toEqual(before)
  })
})
