import { describe, it, expect, vi, beforeEach } from "vitest"
import { exportConversation } from "@/lib/export"

const mockExecute = vi.hoisted(() => vi.fn())
const mockSelect = vi.hoisted(() => vi.fn())

vi.mock("@/lib/db/database", () => ({
  execute: mockExecute,
  select: mockSelect,
}))

beforeEach(() => {
  vi.clearAllMocks()
})

describe("conversationToMarkdown (exportConversation)", () => {
  it("formate role:content sans markdown fence, saute le système", async () => {
    mockSelect.mockResolvedValueOnce([
      { role: "system", content: "You are helpful" },
      { role: "user", content: "Bonjour" },
      { role: "assistant", content: "Salut !" },
    ])
    const md = await exportConversation("conv-1")
    expect(md).toContain("user: Bonjour")
    expect(md).toContain("assistant: Salut !")
    expect(md).not.toContain("system:")
    expect(md).not.toContain("```")
    expect(md).not.toContain("<")
  })

  it("conversation vide → chaîne vide", async () => {
    mockSelect.mockResolvedValueOnce([])
    const md = await exportConversation("empty")
    expect(md).toBe("")
  })
})