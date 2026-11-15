import { describe, expect, it, vi } from "vitest"

const mockConnectorCallTool = vi.hoisted(() => vi.fn())

vi.mock("@/lib/connectors/client", () => ({
  connectorGithub: { callTool: mockConnectorCallTool, cancelTurn: vi.fn() },
}))

import {
  cancelConnectorTurn,
  connectorToolLimits,
  createCompositeToolClient,
} from "@/lib/connectors/toolClient"

const binding = { owner: "DjoAHP", name: "LogAssist", ref: "main" }

describe("createCompositeToolClient", () => {
  it("route les outils GitHub natifs avec la liaison et le même turnId", async () => {
    const mcpCall = vi.fn()
    mockConnectorCallTool.mockResolvedValueOnce({ text: "src/App.tsx", truncated: false })
    const client = createCompositeToolClient({
      github: { binding, configured: true },
      mcpClient: { call: mcpCall },
    })

    await expect(client.call(
      "connector_github",
      "turn-1",
      "call-1",
      "repo_map",
      { path: "src", depth: 2 },
    )).resolves.toEqual({
      content: "src/App.tsx",
      media: [],
      resourceLinks: [],
      sources: [],
      isError: false,
    })
    expect(mockConnectorCallTool).toHaveBeenCalledWith(
      binding,
      "repo_map",
      { path: "src", depth: 2 },
      "turn-1",
    )
    expect(mcpCall).not.toHaveBeenCalled()
  })

  it("délègue les autres serveurs au client MCP sans mutation", async () => {
    const expected = {
      content: "pong",
      media: [],
      resourceLinks: [],
      sources: [],
      isError: false,
    }
    const mcpCall = vi.fn().mockResolvedValueOnce(expected)
    const client = createCompositeToolClient({
      github: { binding, configured: true },
      mcpClient: { call: mcpCall },
    })

    await expect(client.call("docs", "turn-1", "call-2", "echo", { value: 1 })).resolves.toBe(expected)
    expect(mcpCall).toHaveBeenCalledWith("docs", "turn-1", "call-2", "echo", { value: 1 })
    expect(mockConnectorCallTool).not.toHaveBeenCalled()
  })

  it("signale au modèle qu’un résultat GitHub est tronqué", async () => {
    mockConnectorCallTool.mockResolvedValueOnce({ text: "arbre partiel", truncated: true })
    const client = createCompositeToolClient({
      github: { binding, configured: true },
      mcpClient: { call: vi.fn() },
    })

    const result = await client.call("connector_github", "turn-1", "call-1", "repo_map", {})

    expect(result.content).toContain("arbre partiel")
    expect(result.content).toContain("Résultat GitHub tronqué")
  })

  it("refuse un appel connecteur si la liaison n’est plus disponible", async () => {
    const client = createCompositeToolClient({
      github: { binding: null, configured: false },
      mcpClient: { call: vi.fn() },
    })

    await expect(client.call("connector_github", "turn-1", "call-1", "read_file", { path: "README.md" }))
      .rejects.toThrow("liaison GitHub")
    expect(mockConnectorCallTool).not.toHaveBeenCalled()
  })
})

describe("connectorToolLimits", () => {
  it("conserve les limites MCP sans dépôt et les étend avec un dépôt attaché", () => {
    expect(connectorToolLimits({ binding: null, configured: false })).toBeUndefined()
    expect(connectorToolLimits({ binding, configured: true })).toEqual({
      toolRounds: 6,
      mcpCalls: 12,
    })
  })
})

describe("cancelConnectorTurn", () => {
  it("annule le turnId GitHub seulement quand la liaison est active", async () => {
    const mockCancelTurn = vi.mocked((await import("@/lib/connectors/client")).connectorGithub.cancelTurn)
    mockCancelTurn.mockResolvedValueOnce(undefined)

    await cancelConnectorTurn({ binding, configured: true }, "turn-1")
    await cancelConnectorTurn({ binding: null, configured: false }, "turn-2")

    expect(mockCancelTurn).toHaveBeenCalledTimes(1)
    expect(mockCancelTurn).toHaveBeenCalledWith("turn-1")
  })
})
