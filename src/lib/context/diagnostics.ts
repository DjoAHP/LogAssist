import { ApiError } from "@/lib/ai/errors"
import { t } from "@/i18n/fr"
import type {
  ContextDiagnosticSource,
  ContextOmittedStats,
  ContextTokenCategories,
  ModelContextProfile,
  SafeContextDiagnostic,
} from "./types"

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

export interface FailedRoundDiagnosticInput {
  modelId: string
  profile: ModelContextProfile
  categories: ContextTokenCategories
  inputTokens: number
  totalWithReserve: number
  selectedKnowledge?: Array<{ documentId: string; fingerprint: string; chunkIndex: number }>
  historyMessages?: number
  historyTurns?: number
  omitted?: ContextOmittedStats
}

// Diagnostic d'un tour qui a échoué au contrôle de fenêtre : même forme sûre que
// le diagnostic de succès, réduite aux compteurs (aucun contenu, aucun secret).
export function toFailedRoundDiagnostic(
  input: FailedRoundDiagnosticInput,
): SafeContextDiagnostic {
  return {
    modelId: input.modelId,
    contextWindowTokens: input.profile.contextWindowTokens,
    contextWindowSource: input.profile.source,
    tokenizer: input.profile.tokenizer,
    tokens: {
      ...input.categories,
      input: input.inputTokens,
      totalWithReserve: input.totalWithReserve,
    },
    selected: {
      knowledge: input.selectedKnowledge
        ? input.selectedKnowledge.map((chunk) => ({ ...chunk }))
        : [],
      historyMessages: input.historyMessages ?? 0,
      historyTurns: input.historyTurns ?? 0,
    },
    omitted: input.omitted
      ? { ...input.omitted, reasons: [...input.omitted.reasons] }
      : { knowledgeChunks: 0, historyTurns: 0, mcpSegments: 0, reasons: ["mandatory_overflow"] },
  }
}

/** ApiError context_length enrichie d'un diagnostic sûr (compteurs uniquement). */
export class ContextLengthDiagnosticError extends ApiError {
  readonly diagnostic: SafeContextDiagnostic

  constructor(diagnostic: SafeContextDiagnostic, message = t.errors.contextLength) {
    super("context_length", message)
    this.diagnostic = diagnostic
  }
}
