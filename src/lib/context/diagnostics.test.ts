import { describe, expect, it, vi } from "vitest"
import { ApiError } from "@/lib/ai/errors"
import type { ContextOmissionReason } from "./types"
import { ContextLengthDiagnosticError, toFailedRoundDiagnostic, toSafeContextDiagnostic } from "./diagnostics"

describe("toSafeContextDiagnostic", () => {
  it("n’expose aucun contenu privé dans le diagnostic", () => {
    const privateValues = {
      llmKey: "LLM_KEY_PRIVATE_9f3c",
      base64: "BASE64_PRIVATE_4a7d",
      markdown: "MARKDOWN_PRIVATE_2b8e",
      mcpResult: "MCP_RESULT_PRIVATE_6c1f",
    }
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
        documentName: privateValues.markdown,
        fingerprint: "abcd1234",
        chunkIndex: 2,
        headingPath: [privateValues.base64],
        content: `${privateValues.llmKey}\n${privateValues.mcpResult}`,
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
    const loggerDebug = vi.fn()
    loggerDebug({ context: "context.plan", ...safe })
    const serializedLogs = JSON.stringify(loggerDebug.mock.calls)
    const leakedLabels = Object.entries(privateValues)
      .filter(([, privateValue]) => serializedLogs.includes(privateValue))
      .map(([label]) => label)
    const observedSafeLabels = Object.entries({
      context: serializedLogs.includes("context.plan"),
      documentId: serializedLogs.includes("k1"),
      omissionReason: serializedLogs.includes("budget_history"),
    })
      .filter(([, observed]) => observed)
      .map(([label]) => label)
    const diagnosticFacts = {
      selectedKnowledgeMatches: safe.selected.knowledge.length === 1 &&
        safe.selected.knowledge[0]?.documentId === "k1" &&
        safe.selected.knowledge[0]?.fingerprint === "abcd1234" &&
        safe.selected.knowledge[0]?.chunkIndex === 2,
      inputTokens: safe.tokens.input,
      totalWithReserve: safe.tokens.totalWithReserve,
      omittedKnowledgeChunks: safe.omitted.knowledgeChunks,
      omittedHistoryTurns: safe.omitted.historyTurns,
      omittedMcpSegments: safe.omitted.mcpSegments,
    }

    expect(leakedLabels).toEqual([])
    expect(observedSafeLabels).toEqual(["context", "documentId", "omissionReason"])
    expect(diagnosticFacts).toEqual({
      selectedKnowledgeMatches: true,
      inputTokens: 280,
      totalWithReserve: 1560,
      omittedKnowledgeChunks: 3,
      omittedHistoryTurns: 5,
      omittedMcpSegments: 7,
    })
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

describe("diagnostic d’échec de contexte", () => {
  const failureCategories = {
    system: 1_383,
    knowledge: 0,
    history: 0,
    currentUser: 120,
    images: 0,
    tools: 24_189,
    mcpResults: 0,
    outputReserve: 4_096,
    safetyMargin: 1_310,
  }

  it("fabrique un diagnostic sûr réduit aux compteurs", () => {
    const safe = toFailedRoundDiagnostic({
      modelId: "qwen",
      profile: {
        contextWindowTokens: 16_384,
        maxOutputTokens: 4_096,
        source: "manual",
        tokenizer: "conservative",
      },
      categories: failureCategories,
      inputTokens: 25_692,
      totalWithReserve: 31_102,
    })

    expect(safe.modelId).toBe("qwen")
    expect(safe.contextWindowTokens).toBe(16_384)
    expect(safe.contextWindowSource).toBe("manual")
    expect(safe.tokens.tools).toBe(24_189)
    expect(safe.tokens.input).toBe(25_692)
    expect(safe.tokens.totalWithReserve).toBe(31_102)
    expect(safe.selected).toEqual({ knowledge: [], historyMessages: 0, historyTurns: 0 })
    expect(safe.omitted).toEqual({
      knowledgeChunks: 0,
      historyTurns: 0,
      mcpSegments: 0,
      reasons: ["mandatory_overflow"],
    })
  })

  it("accepte une raison d’omission fournie par le planificateur", () => {
    const safe = toFailedRoundDiagnostic({
      modelId: "qwen",
      profile: {
        contextWindowTokens: 4_096,
        maxOutputTokens: 1_024,
        source: "fallback",
        tokenizer: "conservative",
      },
      categories: failureCategories,
      inputTokens: 25_692,
      totalWithReserve: 31_102,
      omitted: {
        knowledgeChunks: 2,
        historyTurns: 4,
        mcpSegments: 1,
        reasons: ["final_recheck", "mandatory_overflow"],
      },
    })

    expect(safe.omitted).toEqual({
      knowledgeChunks: 2,
      historyTurns: 4,
      mcpSegments: 1,
      reasons: ["final_recheck", "mandatory_overflow"],
    })
  })

  it("porte le diagnostic sur une ApiError context_length", () => {
    const safe = toFailedRoundDiagnostic({
      modelId: "qwen",
      profile: {
        contextWindowTokens: 16_384,
        maxOutputTokens: 4_096,
        source: "manual",
        tokenizer: "conservative",
      },
      categories: failureCategories,
      inputTokens: 25_692,
      totalWithReserve: 31_102,
    })
    const error = new ContextLengthDiagnosticError(safe)

    expect(error).toBeInstanceOf(ApiError)
    expect(error.kind).toBe("context_length")
    expect(error.message).toContain("contexte")
    expect(error.diagnostic.tokens.tools).toBe(24_189)
    expect(error.diagnostic.tokens.totalWithReserve).toBe(31_102)
  })
})
