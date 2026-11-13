import { describe, expect, it, vi } from "vitest"
import type { ContextOmissionReason } from "./types"
import { toSafeContextDiagnostic } from "./diagnostics"

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
