import { beforeEach, describe, expect, it, vi } from "vitest"

const mockExecute = vi.hoisted(() => vi.fn())
const mockSelect = vi.hoisted(() => vi.fn())

vi.mock("@/lib/db/database", () => ({
  execute: (...args: unknown[]) => mockExecute(...args),
  select: (...args: unknown[]) => mockSelect(...args),
}))

import { conversationConnectors } from "@/lib/db/conversationConnectors"

beforeEach(() => {
  vi.clearAllMocks()
})

describe("conversationConnectors", () => {
  const sqliteRow = {
    connector_id: "github",
    resource_owner: "DjoAHP",
    resource_name: "LogAssist",
    resource_ref: "main",
    created_at: "2026-11-15T10:00:00Z",
  }

  it("mappe explicitement la ligne SQLite et paramètre la lecture", async () => {
    mockSelect.mockResolvedValueOnce([sqliteRow])

    await expect(conversationConnectors.get("conv-1", "github")).resolves.toEqual({
      connectorId: "github",
      resourceOwner: "DjoAHP",
      resourceName: "LogAssist",
      resourceRef: "main",
      createdAt: "2026-11-15T10:00:00Z",
    })
    expect(mockSelect).toHaveBeenCalledWith(expect.stringContaining("WHERE conversation_id = ? AND connector_id = ?"), ["conv-1", "github"])
  })

  it("renvoie null quand aucune liaison n’existe", async () => {
    mockSelect.mockResolvedValueOnce([])

    await expect(conversationConnectors.get("conv-1", "github")).resolves.toBeNull()
  })

  it("persiste une liaison avec une requête entièrement paramétrée", async () => {
    mockExecute.mockResolvedValueOnce(undefined)

    await conversationConnectors.set("conv-1", "github", {
      resourceOwner: "DjoAHP",
      resourceName: "LogAssist",
      resourceRef: "feature/github",
    })

    const [sql, binds] = mockExecute.mock.calls[0]
    expect(sql).toContain("INSERT OR REPLACE INTO conversation_connectors")
    expect(sql).toContain("VALUES (?, ?, ?, ?, ?, datetime('now'))")
    expect(binds).toEqual(["conv-1", "github", "DjoAHP", "LogAssist", "feature/github"])
  })

  it.each([
    [{ resourceOwner: "-owner", resourceName: "repo", resourceRef: "main" }, "owner"],
    [{ resourceOwner: "owner", resourceName: "../repo", resourceRef: "main" }, "nom"],
    [{ resourceOwner: "owner", resourceName: "repo", resourceRef: "../main" }, "ref"],
  ])("rejette une liaison invalide avant tout accès SQL (%s)", async (binding, message) => {
    await expect(conversationConnectors.set("conv-1", "github", binding)).rejects.toThrow(message)
    expect(mockExecute).not.toHaveBeenCalled()
  })

  it("accepte une ref nullable et mappe la liste", async () => {
    mockExecute.mockResolvedValueOnce(undefined)
    mockSelect.mockResolvedValueOnce([{ ...sqliteRow, resource_ref: null }])

    await conversationConnectors.set("conv-1", "github", {
      resourceOwner: "DjoAHP",
      resourceName: "LogAssist",
      resourceRef: null,
    })
    await expect(conversationConnectors.listAll("conv-1")).resolves.toEqual([
      expect.objectContaining({ connectorId: "github", resourceRef: null }),
    ])
  })

  it("supprime uniquement la liaison ciblée", async () => {
    mockExecute.mockResolvedValueOnce(undefined)

    await conversationConnectors.remove("conv-1", "github")

    expect(mockExecute).toHaveBeenCalledWith(
      "DELETE FROM conversation_connectors WHERE conversation_id = ? AND connector_id = ?",
      ["conv-1", "github"],
    )
  })
})
