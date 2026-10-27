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
    const [sql, bind] = mockDb.execute.mock.calls[0]
    expect(sql).toContain("INSERT INTO conversations")
    expect(bind[0]).toBe(row.id)
  })
})

describe("conversations.list", () => {
  it("exclut les archivées par défaut et mappe archived en booléen-friendly numérique", async () => {
    mockDb.select.mockResolvedValueOnce([{ id: "a", project_id: null, title: "T", archived: 0, created_at: "x", updated_at: "y" }])
    const rows = await conversations.list()
    const [sql] = mockDb.select.mock.calls[0]
    expect(sql).toContain("archived = 0")
    expect(rows[0].id).toBe("a")
  })
  it("includeArchived=true ne filtre pas", async () => {
    mockDb.select.mockResolvedValueOnce([])
    await conversations.list(true)
    expect(mockDb.select.mock.calls[0][0]).not.toContain("archived = 0")
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
