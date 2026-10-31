import { describe, it, expect, vi, beforeEach } from "vitest"

// Même motif que providers.test.ts : mocks DB (vi.hoisted requis car vi.mock
// est hoisté).
const mockExecute = vi.hoisted(() => vi.fn())
const mockSelect = vi.hoisted(() => vi.fn())
vi.mock("@/lib/db/database", () => ({
  execute: (...a: unknown[]) => mockExecute(...a),
  select: (...a: unknown[]) => mockSelect(...a),
}))

import { knowledge } from "@/lib/db/knowledge"

beforeEach(() => {
  vi.clearAllMocks()
})

describe("knowledge", () => {
  it("add insère une connaissance activée par défaut", async () => {
    mockExecute.mockResolvedValue(undefined)
    const row = await knowledge.add("HISE", "## Instructions HISE")
    expect(row.name).toBe("HISE")
    expect(row.enabled).toBe(1)
    const [sql, bind] = mockExecute.mock.calls[0]
    expect(sql).toContain("INSERT INTO knowledge")
    expect(bind[1]).toBe("HISE")
    expect(bind[2]).toBe("## Instructions HISE")
    expect(bind[3]).toBe(1)
  })

  it("add rejette un nom vide sans toucher la base", async () => {
    await expect(knowledge.add("   ", "contenu")).rejects.toThrow("obligatoire")
    expect(mockExecute).not.toHaveBeenCalled()
  })

  it("list renvoie toutes les connaissances triées par création", async () => {
    const rows = [{ id: "k1", name: "HISE", content: "md", enabled: 1, created_at: "2026-01-01" }]
    mockSelect.mockResolvedValueOnce(rows)
    const list = await knowledge.list()
    expect(list).toEqual(rows)
    const [sql] = mockSelect.mock.calls[0]
    expect(sql).toContain("FROM knowledge ORDER BY created_at")
  })

  it("listEnabled ne renvoie que les connaissances actives", async () => {
    mockSelect.mockResolvedValueOnce([])
    await knowledge.listEnabled()
    const [sql, bind] = mockSelect.mock.calls[0]
    expect(sql).toContain("WHERE enabled = ?")
    expect(bind).toEqual([1])
  })

  it("setEnabled met à jour le flag (0/1, SQL paramétré)", async () => {
    await knowledge.setEnabled("k1", false)
    const [sql, bind] = mockExecute.mock.calls[0]
    expect(sql).toContain("UPDATE knowledge SET enabled = ?")
    expect(bind).toEqual([0, "k1"])
  })

  it("update renomme et/ou remplace le contenu", async () => {
    await knowledge.update("k1", { content: "nouveau md" })
    const [sql, bind] = mockExecute.mock.calls[0]
    expect(sql).toContain("UPDATE knowledge SET")
    expect(bind).toContain("nouveau md")
    expect(bind).toContain("k1")
  })

  it("update sans champ ne touche pas la base", async () => {
    await knowledge.update("k1", {})
    expect(mockExecute).not.toHaveBeenCalled()
  })

  it("remove supprime par id", async () => {
    await knowledge.remove("k1")
    const [sql, bind] = mockExecute.mock.calls[0]
    expect(sql).toContain("DELETE FROM knowledge")
    expect(bind).toEqual(["k1"])
  })
})
