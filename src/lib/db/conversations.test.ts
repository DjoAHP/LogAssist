import { describe, it, expect, vi, beforeEach } from "vitest"

const mockDb = vi.hoisted(() => ({ execute: vi.fn(), select: vi.fn() }))
vi.mock("@tauri-apps/plugin-sql", () => ({ default: { load: vi.fn().mockResolvedValue(mockDb) } }))

import { conversations } from "@/lib/db/conversations"

beforeEach(() => {
  vi.clearAllMocks()
  // base déjà migrée : init ne doit pas émettre les CREATE TABLE avant l'INSERT testé
  mockDb.select.mockResolvedValue([{ user_version: 1 }])
})

describe("conversations.create", () => {
  it("insère avec un id uuid v4 et retourne la row", async () => {
    mockDb.execute.mockResolvedValueOnce({ rowsAffected: 1 })
    const row = await conversations.create("Apprendre HISE")
    expect(row.title).toBe("Apprendre HISE")
    expect(row.id).toMatch(/^[0-9a-f-]{36}$/)
    const [sql, bind] = mockDb.execute.mock.calls.find(([s]) => (s as string).includes("INSERT INTO conversations"))!
    expect(sql).toContain("INSERT INTO conversations")
    expect(bind[0]).toBe(row.id)
  })
})

describe("conversations.list", () => {
  it("exclude les archivées par défaut, épinglées d'abord (ORDER BY pinned DESC, updated_at DESC)", async () => {
    mockDb.select.mockResolvedValueOnce([{ id: "a", project_id: null, title: "T", archived: 0, pinned: 1, created_at: "x", updated_at: "y" }])
    const rows = await conversations.list()
    const [sql] = mockDb.select.mock.calls[0]
    expect(sql).toContain("archived = 0")
    expect(sql).toContain("ORDER BY pinned DESC, updated_at DESC")
    expect(rows[0].id).toBe("a")
  })
  it("includeArchived=true ne filtre pas (mais garde le tri épinglées d'abord)", async () => {
    mockDb.select.mockResolvedValueOnce([])
    await conversations.list(true)
    const sql = mockDb.select.mock.calls[0][0] as string
    expect(sql).not.toContain("archived = 0")
    expect(sql).toContain("ORDER BY pinned DESC, updated_at DESC")
  })
})

describe("conversations.setPinned", () => {
  it("émet UPDATE conversations SET pinned (sans toucher updated_at)", async () => {
    mockDb.execute.mockResolvedValue({ rowsAffected: 1 })
    await conversations.setPinned("id1", true)
    const [sql, bind] = mockDb.execute.mock.calls[0]
    expect(String(sql)).toContain("UPDATE conversations SET pinned = ?")
    expect(String(sql)).not.toContain("updated_at")
    expect(bind[0]).toBe(1)
    expect(bind[1]).toBe("id1")
  })
})

describe("conversations.rename / setArchived / remove / setProject", () => {
  it("émet les UPDATE/DELETE attendus", async () => {
    mockDb.execute.mockResolvedValue({ rowsAffected: 1 })
    await conversations.rename("id1", "Nouveau titre")
    expect(mockDb.execute.mock.calls[0][0]).toContain("UPDATE conversations SET title")
    await conversations.setArchived("id1", true)
    expect(mockDb.execute.mock.calls[1][0]).toContain("UPDATE conversations SET archived")
    await conversations.setProject("id1", "p1")
    expect(mockDb.execute.mock.calls[2][0]).toContain("UPDATE conversations SET project_id")
    await conversations.remove("id1")
    expect(mockDb.execute.mock.calls[3][0]).toContain("DELETE FROM conversations WHERE id =")
  })
})
