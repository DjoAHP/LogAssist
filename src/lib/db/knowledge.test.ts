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
  it("add insère une connaissance activée par défaut avec sort_order = max + 1", async () => {
    mockSelect.mockResolvedValueOnce([{ max: -1 }]) // COALESCE(MAX, -1)
    mockExecute.mockResolvedValue(undefined)
    const row = await knowledge.add("HISE", "## Instructions HISE")
    expect(row.name).toBe("HISE")
    expect(row.enabled).toBe(1)
    expect(row.sort_order).toBe(0)
    const [sql, bind] = mockExecute.mock.calls[0]
    expect(sql).toContain("INSERT INTO knowledge")
    expect(bind[1]).toBe("HISE")
    expect(bind[2]).toBe("## Instructions HISE")
    expect(bind[3]).toBe(1)
    expect(bind[4]).toBe(0)
  })

  it("add rejette un nom vide sans toucher la base", async () => {
    await expect(knowledge.add("   ", "contenu")).rejects.toThrow("obligatoire")
    expect(mockExecute).not.toHaveBeenCalled()
  })

  it("list renvoie toutes les connaissances triées par sort_order puis création", async () => {
    const rows = [{ id: "k1", name: "HISE", content: "md", enabled: 1, sort_order: 0, created_at: "2026-01-01" }]
    mockSelect.mockResolvedValueOnce(rows)
    const list = await knowledge.list()
    expect(list).toEqual(rows)
    const [sql] = mockSelect.mock.calls[0]
    expect(sql).toContain("ORDER BY sort_order ASC, created_at ASC")
  })

  it("listEnabled ne renvoie que les connaissances actives triées par sort_order", async () => {
    mockSelect.mockResolvedValueOnce([])
    await knowledge.listEnabled()
    const [sql, bind] = mockSelect.mock.calls[0]
    expect(sql).toContain("WHERE enabled = ?")
    expect(sql).toContain("ORDER BY sort_order ASC, created_at ASC")
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

describe("knowledge — réordonner (sort_order)", () => {
  it("add initialise sort_order = max + 1", async () => {
    mockSelect.mockResolvedValueOnce([{ max: 2 }])
    mockExecute.mockResolvedValue(undefined)
    await knowledge.add("New", "content")
    const [sql, bind] = mockExecute.mock.calls[0]
    expect(sql).toContain("INSERT INTO knowledge")
    expect(bind[4]).toBe(3) // sort_order = max + 1
  })

  it("list trie par sort_order ASC puis created_at ASC", async () => {
    mockSelect.mockResolvedValueOnce([])
    await knowledge.list()
    const [sql] = mockSelect.mock.calls[0]
    expect(sql).toContain("ORDER BY sort_order ASC, created_at ASC")
  })

  it("listEnabled trie aussi par sort_order", async () => {
    mockSelect.mockResolvedValueOnce([])
    await knowledge.listEnabled()
    const [sql] = mockSelect.mock.calls[0]
    expect(sql).toContain("ORDER BY sort_order ASC, created_at ASC")
  })

  it("move -1 : swap avec le voisin précédent (sort_order plus petit)", async () => {
    // const rows = [  // unused: just for documentation
    //   { id: "k1", sort_order: 0 },
    //   { id: "k2", sort_order: 1 },
    //   { id: "k3", sort_order: 2 },
    // ]
    // SELECT sort_order WHERE id = 'k2' → 1
    // SELECT id FROM knowledge WHERE sort_order < 1 ORDER BY sort_order DESC LIMIT 1 → k1
    // UPDATE knowledge SET sort_order = 1 WHERE id = 'k1'
    // UPDATE knowledge SET sort_order = 0 WHERE id = 'k2'
    mockSelect
      .mockResolvedValueOnce([{ sort_order: 1 }]) // current
      .mockResolvedValueOnce([{ id: "k1" }]) // neighbor
    mockExecute.mockResolvedValue(undefined)
    await knowledge.move("k2", -1)
    expect(mockExecute).toHaveBeenCalledTimes(2)
    const [sql1, bind1] = mockExecute.mock.calls[0]
    const [sql2, bind2] = mockExecute.mock.calls[1]
    expect(sql1).toContain("UPDATE knowledge SET sort_order = ? WHERE id = ?")
    expect(bind1).toEqual([1, "k1"])
    expect(sql2).toContain("UPDATE knowledge SET sort_order = ? WHERE id = ?")
    expect(bind2).toEqual([0, "k2"])
  })

  it("move +1 : swap avec le voisin suivant (sort_order plus grand)", async () => {
    mockSelect
      .mockResolvedValueOnce([{ sort_order: 1 }])
      .mockResolvedValueOnce([{ id: "k3" }])
    mockExecute.mockResolvedValue(undefined)
    await knowledge.move("k2", 1)
    expect(mockExecute).toHaveBeenCalledTimes(2)
    const [sql1, bind1] = mockExecute.mock.calls[0]
    const [sql2, bind2] = mockExecute.mock.calls[1]
    expect(sql1).toContain("UPDATE knowledge SET sort_order = ? WHERE id = ?")
    expect(bind1).toEqual([1, "k3"]) // voisin d'abord avec l'ancien sort_order du courant
    expect(sql2).toContain("UPDATE knowledge SET sort_order = ? WHERE id = ?")
    expect(bind2).toEqual([2, "k2"]) // puis courant avec le nouveau sort_order
  })

  it("move -1 sur le premier ne fait rien (pas de voisin)", async () => {
    mockSelect.mockResolvedValueOnce([{ sort_order: 0 }])
    mockSelect.mockResolvedValueOnce([])
    mockExecute.mockResolvedValue(undefined)
    await knowledge.move("k1", -1)
    expect(mockExecute).not.toHaveBeenCalled()
  })
})
