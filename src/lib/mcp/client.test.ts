import { beforeEach, describe, expect, it, vi } from "vitest"

const mockInvoke = vi.hoisted(() => vi.fn())

vi.mock("@tauri-apps/api/core", () => ({
  invoke: mockInvoke,
}))

import { McpClientError, mcp, tinyfish } from "@/lib/mcp/client"

beforeEach(() => {
  vi.clearAllMocks()
})

describe("client MCP", () => {
  it("utilise les noms et arguments IPC génériques exacts", async () => {
    mockInvoke
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce({ content: "résultat", sources: [] })
      .mockResolvedValueOnce(undefined)

    await mcp.hasSecret("tinyfish")
    await mcp.configure("tinyfish", "clé-candidate")
    await mcp.removeSecret("tinyfish")
    await mcp.call("tinyfish", "req-1", {
      tool: "search",
      arguments: { query: "Tauri MCP", purpose: "Documentation" },
    })
    await mcp.cancel("req-1")

    expect(mockInvoke.mock.calls).toEqual([
      ["mcp_has_secret", { serverId: "tinyfish" }],
      ["mcp_configure", { serverId: "tinyfish", apiKey: "clé-candidate" }],
      ["mcp_delete_secret", { serverId: "tinyfish" }],
      [
        "mcp_call",
        {
          serverId: "tinyfish",
          requestId: "req-1",
          request: {
            tool: "search",
            arguments: { query: "Tauri MCP", purpose: "Documentation" },
          },
        },
      ],
      ["mcp_cancel", { requestId: "req-1" }],
    ])
  })

  it("normalise les erreurs Rust en McpClientError", async () => {
    mockInvoke.mockRejectedValueOnce({ kind: "auth", message: "Clé refusée" })

    const error = await mcp.hasSecret("tinyfish").catch((caught: unknown) => caught)

    expect(error).toBeInstanceOf(McpClientError)
    expect(error).toMatchObject({ kind: "auth", message: "Clé refusée" })
  })

  it("normalise une erreur inconnue sans faire confiance à sa forme", async () => {
    mockInvoke.mockRejectedValueOnce("échec brut")

    const error = await mcp.hasSecret("tinyfish").catch((caught: unknown) => caught)

    expect(error).toMatchObject({ kind: "unknown", message: "Erreur MCP inconnue" })
  })

  it("l'adaptateur TinyFish fixe le serverId", async () => {
    mockInvoke.mockResolvedValueOnce(true)

    await tinyfish.hasSecret()

    expect(mockInvoke).toHaveBeenCalledWith("mcp_has_secret", { serverId: "tinyfish" })
  })
})
