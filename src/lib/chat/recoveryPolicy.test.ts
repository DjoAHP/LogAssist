import { describe, expect, it } from "vitest"
import type { MessageRow } from "@/lib/db/messages"
import { createRecoveryPlan } from "./recoveryPolicy"

const metrics = {
  first_token_ms: null,
  input_tokens: null,
  output_tokens: null,
  usage_source: null,
  cost_microusd: null,
} as const

function row(overrides: Partial<MessageRow> & Pick<MessageRow, "id" | "role" | "content">): MessageRow {
  return {
    conversation_id: "conv-1",
    attachments: "[]",
    model_label: null,
    latency_ms: null,
    error: null,
    sources: "[]",
    ...metrics,
    ...overrides,
  }
}

const user = row({ id: "user-1", role: "user", content: "Question" })
const failed = row({
  id: "assistant-error",
  role: "assistant",
  content: "",
  error: JSON.stringify({ kind: "network", message: "Erreur" }),
})
const answered = row({ id: "assistant-ok", role: "assistant", content: "Réponse" })

describe("createRecoveryPlan", () => {
  it("prépare le retry de la dernière réponse en erreur sans inclure la cible", () => {
    expect(createRecoveryPlan([user, failed], failed.id, "retry")).toEqual({
      targetId: failed.id,
      triggerUserContent: "Question",
      history: [user],
    })
  })

  it("prépare la régénération de la dernière réponse réussie", () => {
    expect(createRecoveryPlan([user, answered], answered.id, "regenerate")).toEqual({
      targetId: answered.id,
      triggerUserContent: "Question",
      history: [user],
    })
  })

  it("refuse une cible absente ou utilisateur", () => {
    expect(createRecoveryPlan([user, answered], "absent", "regenerate")).toBeNull()
    expect(createRecoveryPlan([user, answered], user.id, "regenerate")).toBeNull()
  })

  it("refuse un assistant qui n'est pas la dernière ligne", () => {
    const trailingUser = row({ id: "user-2", role: "user", content: "Suite" })
    expect(createRecoveryPlan([user, answered, trailingUser], answered.id, "regenerate")).toBeNull()
  })

  it("refuse un ancien assistant même si la conversation finit par un assistant", () => {
    const user2 = row({ id: "user-2", role: "user", content: "Autre" })
    const answer2 = row({ id: "assistant-2", role: "assistant", content: "Autre réponse" })
    expect(createRecoveryPlan([user, answered, user2, answer2], answered.id, "regenerate")).toBeNull()
  })

  it("refuse retry sans erreur, erreur locale ou interruption", () => {
    const persistence = row({
      id: "persistence",
      role: "assistant",
      content: "",
      error: JSON.stringify({ kind: "persistence", message: "Non enregistré" }),
    })
    const interrupted = row({
      id: "interrupted",
      role: "assistant",
      content: "Partiel",
      error: JSON.stringify({ interrupted: true }),
    })
    expect(createRecoveryPlan([user, answered], answered.id, "retry")).toBeNull()
    expect(createRecoveryPlan([user, persistence], persistence.id, "retry")).toBeNull()
    expect(createRecoveryPlan([user, interrupted], interrupted.id, "retry")).toBeNull()
  })

  it("refuse regenerate avec erreur, interruption ou contenu vide", () => {
    const empty = row({ id: "empty", role: "assistant", content: "   " })
    const interrupted = row({
      id: "interrupted",
      role: "assistant",
      content: "Partiel",
      error: JSON.stringify({ interrupted: true }),
    })
    expect(createRecoveryPlan([user, failed], failed.id, "regenerate")).toBeNull()
    expect(createRecoveryPlan([user, interrupted], interrupted.id, "regenerate")).toBeNull()
    expect(createRecoveryPlan([user, empty], empty.id, "regenerate")).toBeNull()
  })

  it("refuse une cible sans question utilisateur précédente", () => {
    expect(createRecoveryPlan([answered], answered.id, "regenerate")).toBeNull()
  })
})
