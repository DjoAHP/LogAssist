import { describe, it, expect, vi, beforeEach } from "vitest"

const mockExecute = vi.hoisted(() => vi.fn())
const mockSelect = vi.hoisted(() => vi.fn())

vi.mock("@/lib/db/database", () => ({
  execute: (...a: unknown[]) => mockExecute(...a),
  select: (...a: unknown[]) => mockSelect(...a),
}))

import { conversationKnowledge } from "@/lib/db/conversationKnowledge"

beforeEach(() => {
  vi.clearAllMocks()
})

describe("conversationKnowledge", () => {
  it("listOn renvoie les knowledge_id de la conversation", async () => {
    mockSelect.mockResolvedValueOnce([{ knowledge_id: "k1" }, { knowledge_id: "k2" }])
    const ids = await conversationKnowledge.listOn("conv-1")
    expect(ids).toEqual(["k1", "k2"])
    const [sql, bind] = mockSelect.mock.calls[0]
    expect(sql).toContain("FROM conversation_knowledge")
    expect(bind).toEqual(["conv-1"])
  })

  it("listOn sur conversation sans overrides renvoie tableau vide", async () => {
    mockSelect.mockResolvedValueOnce([])
    const ids = await conversationKnowledge.listOn("conv-empty")
    expect(ids).toEqual([])
  })

  it("setOn remplace la liste (DELETE + INSERT multi)", async () => {
    mockExecute.mockResolvedValue(undefined)
    await conversationKnowledge.setOn("conv-1", ["k2", "k3"])
    expect(mockExecute).toHaveBeenCalledTimes(2)
    const [sql1, bind1] = mockExecute.mock.calls[0]
    const [sql2, bind2] = mockExecute.mock.calls[1]
    expect(sql1).toContain("DELETE FROM conversation_knowledge")
    expect(bind1).toEqual(["conv-1"])
    expect(sql2).toContain("INSERT INTO conversation_knowledge")
    expect(bind2).toEqual(["conv-1", "k2", "conv-1", "k3"])
  })

  it("setOn avec tableau vide ne fait que DELETE", async () => {
    mockExecute.mockResolvedValue(undefined)
    await conversationKnowledge.setOn("conv-1", [])
    expect(mockExecute).toHaveBeenCalledTimes(1)
    const [sql] = mockExecute.mock.calls[0]
    expect(sql).toContain("DELETE FROM conversation_knowledge")
  })
})