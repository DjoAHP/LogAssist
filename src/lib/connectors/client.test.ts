import { beforeEach, describe, expect, it, vi } from "vitest"

const mockInvoke = vi.hoisted(() => vi.fn())

vi.mock("@tauri-apps/api/core", () => ({ invoke: mockInvoke }))

import { connectorGithub } from "@/lib/connectors/client"

beforeEach(() => {
  vi.clearAllMocks()
})

describe("client connecteur GitHub", () => {
  it("normalise la liste Rust snake_case vers le contrat React", async () => {
    mockInvoke.mockResolvedValueOnce({
      repos: [{
        full_name: "DjoAHP/LogAssist",
        private: true,
        default_branch: "main",
        updated_at: "2026-11-15T10:00:00Z",
      }],
      page: 2,
      has_more: true,
    })

    await expect(connectorGithub.listRepos(2)).resolves.toEqual({
      repos: [{
        fullName: "DjoAHP/LogAssist",
        isPrivate: true,
        defaultBranch: "main",
        updatedAt: "2026-11-15T10:00:00Z",
      }],
      page: 2,
      hasMore: true,
    })
    expect(mockInvoke).toHaveBeenCalledWith("connector_github_list_repos", { page: 2 })
  })

  it("imbrique CallToolArgs avec les noms exacts attendus par serde", async () => {
    mockInvoke.mockResolvedValueOnce({ text: "README", truncated: false })
    const binding = { owner: "DjoAHP", name: "LogAssist", ref: "main" }

    await connectorGithub.callTool(binding, "read_file", { path: "README.md" }, "turn-1")

    expect(mockInvoke).toHaveBeenCalledWith("connector_github_call_tool", {
      args: {
        owner: "DjoAHP",
        name: "LogAssist",
        ref_: "main",
        tool: "read_file",
        args: { path: "README.md" },
        turn_id: "turn-1",
      },
    })
  })

  it("transmet l’annulation avec le nom camelCase du paramètre Tauri", async () => {
    mockInvoke.mockResolvedValueOnce(undefined)

    await connectorGithub.cancelTurn("turn-1")

    expect(mockInvoke).toHaveBeenCalledWith("connector_github_cancel_turn", { turnId: "turn-1" })
  })
})
