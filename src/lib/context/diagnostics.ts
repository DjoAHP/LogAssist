import type { ContextDiagnosticSource, SafeContextDiagnostic } from "./types"

export function toSafeContextDiagnostic(
  input: ContextDiagnosticSource,
): SafeContextDiagnostic {
  return {
    modelId: input.modelId,
    contextWindowTokens: input.profile.contextWindowTokens,
    contextWindowSource: input.profile.source,
    tokenizer: input.profile.tokenizer,
    tokens: {
      system: input.categories.system,
      knowledge: input.categories.knowledge,
      history: input.categories.history,
      currentUser: input.categories.currentUser,
      images: input.categories.images,
      tools: input.categories.tools,
      mcpResults: input.categories.mcpResults,
      outputReserve: input.categories.outputReserve,
      safetyMargin: input.categories.safetyMargin,
      input: input.inputTokens,
      totalWithReserve: input.totalWithReserve,
    },
    selected: {
      knowledge: input.selectedKnowledge.map((chunk) => ({
        documentId: chunk.documentId,
        fingerprint: chunk.fingerprint,
        chunkIndex: chunk.chunkIndex,
      })),
      historyMessages: input.historyMessages,
      historyTurns: input.historyTurns,
    },
    omitted: {
      knowledgeChunks: input.omitted.knowledgeChunks,
      historyTurns: input.omitted.historyTurns,
      mcpSegments: input.omitted.mcpSegments,
      reasons: [...input.omitted.reasons],
    },
  }
}
