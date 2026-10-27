import { describe, it, expect, vi, beforeEach } from "vitest"

const mockExecute = vi.fn()
const mockSelect = vi.fn()
vi.mock("@/lib/db/database", () => ({
  execute: (...a: unknown[]) => mockExecute(...a),
  select: (...a: unknown[]) => mockSelect(...a),
}))

import { messages } from "@/lib/db/messages"

beforeEach(() => {
  vi.clearAllMocks()
})

describe("messages.listByConversation", () => {
  it("trie par rowid ASC et bind l'id de conversation", async () => {
    mockSelect.mockResolvedValueOnce([
      { id: "m1", conversation_id: "c1", role: "user", content: "a", attachments: "[]", model_label: null, latency_ms: null, error: null },
    ])
    const rows = await messages.listByConversation("c1")
    const [sql, bind] = mockSelect.mock.calls[0]
    expect(sql).toContain("ORDER BY rowid ASC")
    expect(bind).toEqual(["c1"])
    expect(rows[0].id).toBe("m1")
  })
})

describe("messages.insert", () => {
  it("insère 8 colonnes avec un uuid et bind model_label/latency_ms", async () => {
    mockExecute.mockResolvedValueOnce({ rowsAffected: 1 })
    const id = await messages.insert({
      conversation_id: "c1", role: "assistant", content: "réponse",
      attachments: "[]", model_label: "OpenRouter › gpt-4o", latency_ms: 420, error: null,
    })
    expect(id).toMatch(/^[0-9a-f-]{36}$/)
    const [sql, bind] = mockExecute.mock.calls[0]
    expect(sql).toContain("INSERT INTO messages")
    expect(bind).toHaveLength(8)
    expect(bind[0]).toBe(id)
    expect(bind[1]).toBe("c1")
    expect(bind[2]).toBe("assistant")
    expect(bind[5]).toBe("OpenRouter › gpt-4o")
    expect(bind[6]).toBe(420)
  })
})

describe("messages.updateError / removeByConversation", () => {
  it("émet les SQL ciblés attendus", async () => {
    mockExecute.mockResolvedValue({ rowsAffected: 1 })
    await messages.updateError("m1", '{"kind":"auth","message":"Clé API invalide"}')
    const [updateSql, updateBind] = mockExecute.mock.calls[0]
    expect(updateSql).toContain("UPDATE messages SET error")
    expect(updateBind).toEqual(['{"kind":"auth","message":"Clé API invalide"}', "m1"])
    await messages.removeByConversation("c1")
    const [deleteSql, deleteBind] = mockExecute.mock.calls[1]
    expect(deleteSql).toContain("DELETE FROM messages WHERE conversation_id = ?")
    expect(deleteBind).toEqual(["c1"])
  })
})
