import { describe, expect, it } from "vitest"
import type { ContextOmissionReason } from "./types"
import { toSafeContextDiagnostic } from "./diagnostics"

describe("toSafeContextDiagnostic", () => {
  it("n’expose aucun contenu privé dans le diagnostic", () => {
    const sensitive = "PRIVATE_SENTINEL_9f3c"
    const safe = toSafeContextDiagnostic({
      modelId: "qwen",
      profile: {
        contextWindowTokens: 8192,
        maxOutputTokens: 1024,
        source: "provider_loaded",
        tokenizer: "conservative",
      },
      categories: {
        system: 10,
        knowledge: 20,
        history: 30,
        currentUser: 40,
        images: 50,
        tools: 60,
        mcpResults: 70,
        outputReserve: 1024,
        safetyMargin: 256,
      },
      inputTokens: 280,
      totalWithReserve: 1560,
      selectedKnowledge: [{
        documentId: "k1",
        documentName: sensitive,
        fingerprint: "abcd1234",
        chunkIndex: 2,
        headingPath: [sensitive],
        content: sensitive,
        tokenEstimate: 20,
      }],
      historyMessages: 4,
      historyTurns: 2,
      omitted: {
        knowledgeChunks: 3,
        historyTurns: 5,
        mcpSegments: 7,
        reasons: ["budget_history"],
      },
    })

    expect(JSON.stringify(safe)).not.toContain(sensitive)
    expect(safe.selected.knowledge).toEqual([{
      documentId: "k1",
      fingerprint: "abcd1234",
      chunkIndex: 2,
    }])
    expect(safe.tokens).toMatchObject({ input: 280, totalWithReserve: 1560 })
  })

  it("reconstruit des tableaux indépendants de la source", () => {
    const reasons: ContextOmissionReason[] = ["budget_knowledge"]
    const source = {
      modelId: "m",
      profile: {
        contextWindowTokens: 4096,
        maxOutputTokens: 1024,
        source: "fallback" as const,
        tokenizer: "conservative" as const,
      },
      categories: {
        system: 1,
        knowledge: 2,
        history: 3,
        currentUser: 4,
        images: 0,
        tools: 0,
        mcpResults: 0,
        outputReserve: 1024,
        safetyMargin: 128,
      },
      inputTokens: 10,
      totalWithReserve: 1162,
      selectedKnowledge: [],
      historyMessages: 0,
      historyTurns: 0,
      omitted: { knowledgeChunks: 1, historyTurns: 0, mcpSegments: 0, reasons: [...reasons] },
    }
    const safe = toSafeContextDiagnostic(source)

    source.omitted.reasons.push("budget_history")
    expect(safe.omitted.reasons).toEqual(["budget_knowledge"])
  })
})
