import { describe, expect, it } from "vitest"
import { selectHistory } from "./historySelector"

const messages = [
  { id: "u1", role: "user" as const, content: "Erreur export vidéo H264" },
  { id: "a1", role: "assistant" as const, content: "Vérifier le codec H264." },
  { id: "u2", role: "user" as const, content: "Comment ouvrir les scopes ?" },
  { id: "a2", role: "assistant" as const, content: "Ouvrir le panneau scopes." },
  { id: "u3", role: "user" as const, content: "Je règle maintenant les couleurs." },
  { id: "a3", role: "assistant" as const, content: "Commencer par les roues primaires." },
]

describe("selectHistory", () => {
  it("conserve des tours complets et rétablit l’ordre chronologique", () => {
    const selected = selectHistory({
      messages,
      query: "Mon export H264 échoue encore",
      tokenBudget: 32,
      countText: (text) => Math.ceil(text.length / 4),
      recentTurns: 1,
    })

    expect(selected.messages.map((message) => message.id)).toEqual(["u1", "a1", "u3", "a3"])
    expect(selected.tokens).toBeLessThanOrEqual(32)
    expect(selected.selectedTurns).toBe(2)
    expect(selected.omittedTurns).toBe(1)
  })

  it("écarte un tour entier s’il ne tient pas", () => {
    const selected = selectHistory({
      messages: [
        { id: "u", role: "user", content: "x".repeat(1000) },
        { id: "a", role: "assistant", content: "y".repeat(1000) },
      ],
      query: "x",
      tokenBudget: 10,
      countText: (text) => Math.ceil(text.length / 4),
      recentTurns: 1,
    })

    expect(selected.messages).toEqual([])
    expect(selected.omittedTurns).toBe(1)
  })

  it("conserve les deux derniers tours par défaut quand ils tiennent", () => {
    const selected = selectHistory({
      messages,
      query: "question sans correspondance",
      tokenBudget: 100,
      countText: (text) => Math.ceil(text.length / 4),
    })

    expect(selected.messages.map((message) => message.id)).toEqual(["u2", "a2", "u3", "a3"])
  })

  it("tolère un assistant orphelin sans l’attacher à une mauvaise question", () => {
    const selected = selectHistory({
      messages: [
        { id: "orphan", role: "assistant", content: "Ancien diagnostic GPU" },
        { id: "u", role: "user", content: "Question récente" },
        { id: "a", role: "assistant", content: "Réponse récente" },
      ],
      query: "diagnostic GPU",
      tokenBudget: 100,
      countText: (text) => Math.ceil(text.length / 4),
      recentTurns: 1,
    })

    expect(selected.messages.map((message) => message.id)).toEqual(["orphan", "u", "a"])
  })

  it("ne mute pas les messages sources", () => {
    const original = structuredClone(messages)
    selectHistory({
      messages,
      query: "H264",
      tokenBudget: 32,
      countText: (text) => Math.ceil(text.length / 4),
    })
    expect(messages).toEqual(original)
  })
})
