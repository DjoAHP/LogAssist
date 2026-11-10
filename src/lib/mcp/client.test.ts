// Contrat IPC du client MCP : noms de commandes et formes d'arguments exacts
// attendus par le backend Rust (src-tauri/src/commands/mcp.rs).
import { beforeEach, describe, expect, it, vi } from "vitest"

const mockInvoke = vi.hoisted(() => vi.fn())

vi.mock("@tauri-apps/api/core", () => ({
  invoke: mockInvoke,
}))

import { McpClientError, mcp, tinyfish } from "@/lib/mcp/client"
import { result, runtimeServer } from "@/test/mcpFixtures"

beforeEach(() => {
  vi.clearAllMocks()
})

describe("client MCP", () => {
  it("mappe le registre, la découverte, les appels et l'annulation", async () => {
    mockInvoke.mockResolvedValue(undefined)
    const servers = [runtimeServer()]
    await mcp.validateConfigs(servers)
    await mcp.syncRegistry(servers)
    await mcp.authStatus("docs")
    await mcp.configureAuth("docs", "candidate")
    await mcp.connectAndListTools("docs")
    await mcp.callTool("docs", "turn-1", "call-1", "echo", { text: "bonjour" })
    await mcp.testTool("docs", "manual-1", "echo", {})
    await mcp.cancelTurn("turn-1")
    await mcp.disconnect("docs")
    await mcp.removeSecret("docs")
    expect(mockInvoke.mock.calls).toEqual([
      ["mcp_validate_configs", { servers }],
      ["mcp_sync_registry", { servers }],
      ["mcp_auth_status", { serverId: "docs" }],
      ["mcp_configure_auth", { serverId: "docs", secret: "candidate" }],
      ["mcp_connect_and_list_tools", { serverId: "docs" }],
      ["mcp_call_tool", { serverId: "docs", turnId: "turn-1", callId: "call-1", nativeName: "echo", arguments: { text: "bonjour" } }],
      ["mcp_test_tool", { serverId: "docs", callId: "manual-1", nativeName: "echo", arguments: {} }],
      ["mcp_cancel_turn", { turnId: "turn-1" }],
      ["mcp_disconnect", { serverId: "docs" }],
      ["mcp_delete_secret", { serverId: "docs" }],
    ])
  })

  it("expose le contrat anti-perte finishTurn", async () => {
    mockInvoke.mockResolvedValue(undefined)

    await mcp.finishTurn("turn-1")

    expect(mockInvoke).toHaveBeenCalledWith("mcp_finish_turn", { turnId: "turn-1" })
  })

  it("normalise les quatorze causes d'erreur Rust en McpClientError", async () => {
    const kinds = [
      "not_configured", "invalid_config", "auth", "offline", "timeout", "rate_limit",
      "tool_not_found", "tool_denied", "invalid_arguments", "protocol",
      "invalid_response", "cancelled", "unknown",
    ] as const
    for (const kind of kinds) {
      mockInvoke.mockRejectedValueOnce({ kind, message: `échec ${kind}` })

      const error = await mcp.authStatus("docs").catch((caught: unknown) => caught)

      expect(error).toBeInstanceOf(McpClientError)
      expect(error).toMatchObject({ kind, message: `échec ${kind}` })
    }
  })

  it("normalise une valeur de kind inconnue en unknown", async () => {
    mockInvoke.mockRejectedValueOnce({ kind: "mystere_futur", message: "?" })

    const error = await mcp.authStatus("docs").catch((caught: unknown) => caught)

    expect(error).toMatchObject({ kind: "unknown", message: "Erreur MCP inconnue" })
  })

  it("normalise une erreur brute sans forme Rust", async () => {
    mockInvoke.mockRejectedValueOnce("échec brut")

    const error = await mcp.authStatus("docs").catch((caught: unknown) => caught)

    expect(error).toMatchObject({ kind: "unknown", message: "Erreur MCP inconnue" })
  })

  it("retourne la charge utile typée de l'appel d'outil", async () => {
    mockInvoke.mockResolvedValueOnce(result("bonjour"))

    await expect(mcp.callTool("docs", "turn-1", "call-1", "echo", {}))
      .resolves.toEqual(result("bonjour"))
  })
})

describe("adaptateur TinyFish", () => {
  it("fixe le serverId tinyfish sur chaque commande", async () => {
    mockInvoke.mockResolvedValue("configured")
    await tinyfish.hasSecret()
    await tinyfish.configure("clé-candidate")
    mockInvoke.mockResolvedValueOnce(result("contenu"))
    await tinyfish.call("req-1", {
      tool: "search",
      arguments: { query: "Tauri MCP", purpose: "Documentation" },
    })
    await tinyfish.cancel("req-1")

    expect(mockInvoke.mock.calls).toEqual([
      ["mcp_auth_status", { serverId: "tinyfish" }],
      ["mcp_configure_auth", { serverId: "tinyfish", secret: "clé-candidate" }],
      ["mcp_call_tool", {
        serverId: "tinyfish",
        turnId: "req-1",
        callId: "req-1",
        nativeName: "search",
        arguments: { query: "Tauri MCP", purpose: "Documentation" },
      }],
      ["mcp_cancel_turn", { turnId: "req-1" }],
    ])
  })

  it("hasSecret est true uniquement pour configured", async () => {
    mockInvoke.mockResolvedValueOnce("configured")
    mockInvoke.mockResolvedValueOnce("missing")

    await expect(tinyfish.hasSecret()).resolves.toBe(true)
    await expect(tinyfish.hasSecret()).resolves.toBe(false)
  })

  it("removeSecret supprime via le serveur intégré", async () => {
    mockInvoke.mockResolvedValue(undefined)

    await tinyfish.removeSecret()

    expect(mockInvoke).toHaveBeenCalledWith("mcp_delete_secret", { serverId: "tinyfish" })
  })
})
