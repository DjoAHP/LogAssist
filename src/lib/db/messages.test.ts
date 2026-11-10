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
      {
        id: "m1", conversation_id: "c1", role: "user", content: "a", attachments: "[]",
        model_label: null, latency_ms: null, error: null, first_token_ms: null,
        input_tokens: null, output_tokens: null, usage_source: null, cost_microusd: null,
      },
    ])
    const rows = await messages.listByConversation("c1")
    const [sql, bind] = mockSelect.mock.calls[0]
    expect(sql).toContain("ORDER BY rowid ASC")
    expect(bind).toEqual(["c1"])
    expect(rows[0].id).toBe("m1")
    expect(rows[0].sources).toBe("[]")
    expect(rows[0].media).toBe("[]")
  })

  it("normalise les colonnes absentes d'un message historique", async () => {
    mockSelect.mockResolvedValueOnce([
      {
        id: "m1", conversation_id: "c1", role: "user", content: "a", attachments: "[]",
        model_label: null, latency_ms: null, error: null,
      },
    ])

    const rows = await messages.listByConversation("c1")

    expect(rows[0]).toMatchObject({
      sources: "[]",
      first_token_ms: null,
      input_tokens: null,
      output_tokens: null,
      usage_source: null,
      cost_microusd: null,
    })
  })
})

describe("messages.insert", () => {
  it("insère les colonnes avec un uuid et bind les métadonnées de réponse", async () => {
    mockExecute.mockResolvedValueOnce({ rowsAffected: 1 })
    const id = await messages.insert({
      conversation_id: "c1", role: "assistant", content: "réponse",
      attachments: "[]", model_label: "OpenRouter › gpt-4o", latency_ms: 420, error: null,
      sources: '[{"url":"https://example.com","title":"Exemple","origin":"search"}]',
      first_token_ms: 180,
      input_tokens: 240,
      output_tokens: 80,
      usage_source: "provider",
      cost_microusd: 420,
    })
    expect(id).toMatch(/^[0-9a-f-]{36}$/)
    const [sql, bind] = mockExecute.mock.calls[0]
    expect(sql).toContain("INSERT INTO messages")
    expect(bind).toHaveLength(14)
    expect(bind[0]).toBe(id)
    expect(bind[1]).toBe("c1")
    expect(bind[2]).toBe("assistant")
    expect(bind[5]).toBe("OpenRouter › gpt-4o")
    expect(bind[6]).toBe(420)
    expect(bind[8]).toBe('[{"url":"https://example.com","title":"Exemple","origin":"search"}]')
    expect(bind.slice(9)).toEqual([180, 240, 80, "provider", 420])
  })

  it("insère NULL pour les métriques absentes", async () => {
    mockExecute.mockResolvedValueOnce({ rowsAffected: 1 })
    await messages.insert({
      conversation_id: "c1",
      role: "user",
      content: "question",
      attachments: "[]",
      model_label: null,
      latency_ms: null,
      error: null,
    })
    const bind = mockExecute.mock.calls[0][1]
    expect(bind.slice(9)).toEqual([null, null, null, null, null])
  })
})

describe("messages.updateAssistant", () => {
  it("remplace atomiquement le contenu et les métriques d'une réponse assistant", async () => {
    mockExecute.mockResolvedValueOnce({ rowsAffected: 1 })

    await messages.updateAssistant("assistant-1", {
      content: "Nouvelle réponse",
      model_label: "OpenAI › modèle",
      latency_ms: 200,
      error: null,
      sources: "[]",
      first_token_ms: 20,
      input_tokens: 100,
      output_tokens: 30,
      usage_source: "provider",
      cost_microusd: 12,
    })

    const [sql, bind] = mockExecute.mock.calls[0]
    expect(sql).toBe(
      "UPDATE messages SET content = ?, model_label = ?, latency_ms = ?, error = ?, sources = ?, first_token_ms = ?, input_tokens = ?, output_tokens = ?, usage_source = ?, cost_microusd = ? WHERE id = ? AND role = 'assistant'",
    )
    expect(bind).toEqual([
      "Nouvelle réponse",
      "OpenAI › modèle",
      200,
      null,
      "[]",
      20,
      100,
      30,
      "provider",
      12,
      "assistant-1",
    ])
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

describe("messages.setMediaRefs", () => {
  it("écrit les refs médiam en SQL paramétré ciblé", async () => {
    mockExecute.mockResolvedValueOnce({ rowsAffected: 1 })

    await messages.setMediaRefs("assistant-1", '["media-1","media-2"]')

    const [sql, bind] = mockExecute.mock.calls[0]
    expect(sql).toBe("UPDATE messages SET media = ? WHERE id = ?")
    expect(bind).toEqual(['["media-1","media-2"]', "assistant-1"])
  })
})
