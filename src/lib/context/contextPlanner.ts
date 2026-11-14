import type { ChatMessage } from "@/lib/ai/types"
import { buildKnowledgePrompt } from "@/lib/prompts/compose"
import { allocateCandidates } from "./allocator"
import {
  ContextLengthDiagnosticError,
  toFailedRoundDiagnostic,
  toSafeContextDiagnostic,
} from "./diagnostics"
import { selectHistory } from "./historySelector"
import { createKnowledgeRetriever } from "./knowledgeRetriever"
import type {
  ContextAdditionalMessage,
  ContextHistoryMessage,
  ContextOmissionReason,
  ContextOmittedStats,
  ContextSession,
  ContextStats,
  ContextTokenEstimator,
  KnowledgeChunk,
  KnowledgeDocument,
  ModelContextProfile,
  SafeContextDiagnostic,
} from "./types"

const MCP_TRUNCATED = "[Résultat tronqué pour respecter la fenêtre de contexte.]"

export interface CreateContextSessionInput {
  modelId: string
  profile: ModelContextProfile
  estimator: ContextTokenEstimator
  baseSystem: string
  documents: readonly KnowledgeDocument[]
  history: readonly ContextHistoryMessage[]
  currentUser: {
    content: string
    images: NonNullable<ChatMessage["images"]>
  }
  retrievalQuery: string
  onDiagnostic?(diagnostic: SafeContextDiagnostic): void
}

function cloneMessage(message: ChatMessage): ChatMessage {
  return {
    ...message,
    ...(message.images ? { images: message.images.map((image) => ({ ...image })) } : {}),
    ...(message.toolCalls
      ? {
          toolCalls: message.toolCalls.map((call) => ({
            ...call,
            arguments: { ...call.arguments },
          })),
        }
      : {}),
  }
}

function externalContent(
  message: Extract<ContextAdditionalMessage, { kind: "external_tool" }>,
  selectedSegments: number,
): string {
  const omitted = selectedSegments < message.segments.length
  return [
    message.prefix,
    ...message.segments.slice(0, selectedSegments),
    ...(omitted ? [MCP_TRUNCATED] : []),
    message.suffix,
  ].filter((part) => part.length > 0).join("\n\n")
}

function materializeAdditional(
  messages: readonly ContextAdditionalMessage[],
  selectedSegments: readonly number[],
): ChatMessage[] {
  let externalIndex = 0
  return messages.map((entry) => {
    if (entry.kind === "message") return cloneMessage(entry.message)
    const selected = selectedSegments[externalIndex++] ?? 0
    return {
      role: "tool",
      toolCallId: entry.toolCallId,
      content: externalContent(entry, selected),
    }
  })
}

function messageTokens(estimator: ContextTokenEstimator, messages: readonly ChatMessage[]): number {
  return messages.reduce((total, message) => total + estimator.countMessage(message), 0)
}

// Diagnostic d'échec partagé par les deux sites de rejet : compteurs uniquement
// (invariant 13 d'AGENTS.md — jamais de contenu, de secret ni de Base64).
function failureError(input: {
  modelId: string
  profile: ModelContextProfile
  estimator: ContextTokenEstimator
  baseSystem: string
  current: ChatMessage
  toolsTokens: number
  outputReserve: number
  safetyMargin: number
  knowledgeChunks: KnowledgeChunk[]
  historyMessages: ChatMessage[]
  additional: ChatMessage[]
  inputTokens: number
  totalWithReserve: number
  omitted: ContextOmittedStats
}): ContextLengthDiagnosticError {
  const baseSystemTokens = messageTokens(input.estimator, systemMessage(input.baseSystem))
  const systemWithKnowledgeTokens = messageTokens(
    input.estimator,
    systemMessage(composeSystem(input.baseSystem, input.knowledgeChunks)),
  )
  const currentWithoutImages: ChatMessage = { role: "user", content: input.current.content }
  const imageTokens = (input.current.images ?? []).reduce(
    (total, image) => total + input.estimator.countImage(image),
    0,
  )
  return new ContextLengthDiagnosticError(toFailedRoundDiagnostic({
    modelId: input.modelId,
    profile: input.profile,
    categories: {
      system: baseSystemTokens,
      knowledge: Math.max(0, systemWithKnowledgeTokens - baseSystemTokens),
      history: messageTokens(input.estimator, input.historyMessages),
      currentUser: input.estimator.countMessage(currentWithoutImages),
      images: imageTokens,
      tools: input.toolsTokens,
      mcpResults: messageTokens(input.estimator, input.additional),
      outputReserve: input.outputReserve,
      safetyMargin: input.safetyMargin,
    },
    inputTokens: input.inputTokens,
    totalWithReserve: input.totalWithReserve,
    selectedKnowledge: input.knowledgeChunks.map((chunk) => ({
      documentId: chunk.documentId,
      fingerprint: chunk.fingerprint,
      chunkIndex: chunk.chunkIndex,
    })),
    historyMessages: input.historyMessages.length,
    historyTurns: Math.floor(input.historyMessages.length / 2),
    omitted: input.omitted,
  }))
}

function currentMessage(input: CreateContextSessionInput): ChatMessage {
  return {
    role: "user",
    content: input.currentUser.content,
    ...(input.currentUser.images.length > 0
      ? { images: input.currentUser.images.map((image) => ({ ...image })) }
      : {}),
  }
}

function composeSystem(baseSystem: string, chunks: readonly KnowledgeChunk[]): string {
  const knowledge = buildKnowledgePrompt(chunks.map((chunk, index) => ({
    label: `K${index + 1}`,
    documentName: chunk.documentName,
    headingPath: chunk.headingPath,
    content: chunk.content,
  })))
  return [baseSystem.trim(), knowledge].filter(Boolean).join("\n\n")
}

function systemMessage(content: string): ChatMessage[] {
  return content ? [{ role: "system", content }] : []
}

function uniqueReasons(reasons: readonly ContextOmissionReason[]): ContextOmissionReason[] {
  return [...new Set(reasons)]
}

function lastPositiveIndex(values: readonly number[]): number {
  for (let index = values.length - 1; index >= 0; index--) {
    if (values[index] > 0) return index
  }
  return -1
}

export function createContextSession(input: CreateContextSessionInput): ContextSession {
  const estimator = input.estimator
  const retriever = createKnowledgeRetriever({ countTokens: estimator.countText })
  const rankedKnowledge = retriever.search(input.retrievalQuery, input.documents)
  const baseSystem = input.baseSystem.trim()
  let disposed = false

  const selectKnowledge = (budget: number): { chunks: KnowledgeChunk[]; tokens: number } => {
    if (budget <= 0 || rankedKnowledge.length === 0) return { chunks: [], tokens: 0 }
    const emptySystemTokens = messageTokens(estimator, systemMessage(baseSystem))
    const headerTokens = Math.max(
      0,
      messageTokens(estimator, systemMessage(composeSystem(baseSystem, []))) - emptySystemTokens,
    )
    const candidates = rankedKnowledge.map((chunk, index) => ({
      id: `${chunk.documentId}:${chunk.chunkIndex}`,
      kind: "knowledge" as const,
      tokens: Math.max(1, estimator.countText(
        `[K${index + 1}] ${chunk.documentName} ${chunk.headingPath.join(" ")}\n${chunk.content}`,
      )),
      utility: (rankedKnowledge.length - index) * 1_000 + chunk.score,
      chunk,
      rank: index,
    }))
    const allocated = allocateCandidates(candidates, Math.max(0, budget - headerTokens))
      .sort((left, right) => left.rank - right.rank)
    const selected = allocated.map((candidate) => candidate.chunk)

    while (selected.length > 0) {
      const tokens = Math.max(
        0,
        messageTokens(estimator, systemMessage(composeSystem(baseSystem, selected))) - emptySystemTokens,
      )
      if (tokens <= budget) return { chunks: selected, tokens }
      selected.pop()
    }
    return { chunks: [], tokens: 0 }
  }

  const knowledgeTokensFor = (chunks: readonly KnowledgeChunk[]): number => {
    const emptySystemTokens = messageTokens(estimator, systemMessage(baseSystem))
    return Math.max(
      0,
      messageTokens(estimator, systemMessage(composeSystem(baseSystem, chunks))) - emptySystemTokens,
    )
  }

  return {
    prepareRound(roundInput) {
      const windowTokens = input.profile.contextWindowTokens
      const outputReserve = input.profile.maxOutputTokens
      const safetyMargin = Math.max(128, Math.ceil(windowTokens * 0.08))
      const toolsTokens = estimator.countTools(roundInput.tools)
      const current = currentMessage(input)
      const externalEntries = roundInput.additionalMessages.filter(
        (entry): entry is Extract<ContextAdditionalMessage, { kind: "external_tool" }> =>
          entry.kind === "external_tool",
      )
      const selectedSegments = externalEntries.map(() => 0)
      const baselineAdditional = materializeAdditional(roundInput.additionalMessages, selectedSegments)
      const mandatoryMessages = [
        ...systemMessage(baseSystem),
        current,
        ...baselineAdditional,
      ]
      const mandatoryInput = estimator.countMessages(mandatoryMessages) + toolsTokens
      if (mandatoryInput + outputReserve + safetyMargin > windowTokens) {
        throw failureError({
          modelId: input.modelId,
          profile: input.profile,
          estimator,
          baseSystem,
          current,
          toolsTokens,
          outputReserve,
          safetyMargin,
          knowledgeChunks: [],
          historyMessages: [],
          additional: baselineAdditional,
          inputTokens: mandatoryInput,
          totalWithReserve: mandatoryInput + outputReserve + safetyMargin,
          omitted: { knowledgeChunks: 0, historyTurns: 0, mcpSegments: 0, reasons: ["mandatory_overflow"] },
        })
      }

      const optionalBudget = windowTokens - mandatoryInput - outputReserve - safetyMargin
      let remainingSegmentBudget = optionalBudget
      let externalIndex = 0
      for (const entry of roundInput.additionalMessages) {
        if (entry.kind !== "external_tool") continue
        let selected = 0
        let consumed = 0
        for (const segment of entry.segments) {
          const segmentTokens = estimator.countText(`\n\n${segment}`)
          if (consumed + segmentTokens > remainingSegmentBudget) break
          consumed += segmentTokens
          selected++
        }
        selectedSegments[externalIndex++] = selected
        remainingSegmentBudget -= consumed
      }

      let additional = materializeAdditional(roundInput.additionalMessages, selectedSegments)
      const baselineAdditionalTokens = messageTokens(estimator, baselineAdditional)
      let additionalTokens = messageTokens(estimator, additional)
      while (additionalTokens - baselineAdditionalTokens > optionalBudget) {
        const last = lastPositiveIndex(selectedSegments)
        if (last < 0) break
        selectedSegments[last]--
        additional = materializeAdditional(roundInput.additionalMessages, selectedSegments)
        additionalTokens = messageTokens(estimator, additional)
      }
      const mcpExtraTokens = Math.max(0, additionalTokens - baselineAdditionalTokens)
      const remaining = Math.max(
        0,
        windowTokens - mandatoryInput - outputReserve - safetyMargin - mcpExtraTokens,
      )

      const historyCounter = (text: string) => estimator.countText(text) + 8
      const initialHistory = selectHistory({
        messages: input.history,
        query: input.retrievalQuery,
        tokenBudget: Math.floor(remaining * 0.5),
        countText: historyCounter,
      })
      const initialKnowledge = selectKnowledge(Math.floor(remaining * 0.35))
      const expandedHistory = selectHistory({
        messages: input.history,
        query: input.retrievalQuery,
        tokenBudget: Math.max(0, remaining - initialKnowledge.tokens),
        countText: historyCounter,
      })
      let selectedHistory = expandedHistory.tokens >= initialHistory.tokens
        ? expandedHistory
        : initialHistory
      let selectedKnowledge = selectKnowledge(Math.max(0, remaining - selectedHistory.tokens))
      if (selectedKnowledge.tokens < initialKnowledge.tokens) selectedKnowledge = initialKnowledge

      const reasons: ContextOmissionReason[] = []
      let finalMessages: ChatMessage[] = []
      let inputTokens = 0
      let totalWithReserve = 0
      const assemble = () => {
        const system = composeSystem(baseSystem, selectedKnowledge.chunks)
        finalMessages = [
          ...systemMessage(system),
          ...selectedHistory.messages.map((message) => ({
            role: message.role,
            content: message.content,
          })),
          current,
          ...additional,
        ]
        inputTokens = estimator.countMessages(finalMessages) + toolsTokens
        totalWithReserve = inputTokens + outputReserve + safetyMargin
      }
      assemble()

      while (totalWithReserve > windowTokens && selectedKnowledge.chunks.length > 0) {
        const chunks = selectedKnowledge.chunks.slice(0, -1)
        selectedKnowledge = { chunks, tokens: knowledgeTokensFor(chunks) }
        reasons.push("final_recheck")
        assemble()
      }
      while (totalWithReserve > windowTokens && selectedHistory.messages.length > 0) {
        const excess = totalWithReserve - windowTokens
        selectedHistory = selectHistory({
          messages: input.history,
          query: input.retrievalQuery,
          tokenBudget: Math.max(0, selectedHistory.tokens - excess - 16),
          countText: historyCounter,
        })
        reasons.push("final_recheck")
        assemble()
      }
      while (totalWithReserve > windowTokens && selectedSegments.some((count) => count > 0)) {
        const last = lastPositiveIndex(selectedSegments)
        if (last < 0) break
        selectedSegments[last]--
        additional = materializeAdditional(roundInput.additionalMessages, selectedSegments)
        reasons.push("final_recheck")
        assemble()
      }
      if (totalWithReserve > windowTokens) {
        throw failureError({
          modelId: input.modelId,
          profile: input.profile,
          estimator,
          baseSystem,
          current,
          toolsTokens,
          outputReserve,
          safetyMargin,
          knowledgeChunks: selectedKnowledge.chunks,
          historyMessages: selectedHistory.messages.map((message) => ({
            role: message.role,
            content: message.content,
          })),
          additional,
          inputTokens,
          totalWithReserve,
          omitted: {
            knowledgeChunks: 0,
            historyTurns: 0,
            mcpSegments: 0,
            reasons: uniqueReasons([...reasons, "mandatory_overflow"]),
          },
        })
      }

      const omittedMcpSegments = externalEntries.reduce(
        (total, entry, index) => total + entry.segments.length - (selectedSegments[index] ?? 0),
        0,
      )
      const omittedKnowledge = Math.max(0, rankedKnowledge.length - selectedKnowledge.chunks.length)
      if (selectedHistory.omittedTurns > 0) reasons.push("budget_history")
      if (omittedKnowledge > 0) reasons.push("budget_knowledge")
      if (omittedMcpSegments > 0) reasons.push("budget_mcp")

      const finalSystem = composeSystem(baseSystem, selectedKnowledge.chunks)
      const baseSystemTokens = messageTokens(estimator, systemMessage(baseSystem))
      const systemWithKnowledgeTokens = messageTokens(estimator, systemMessage(finalSystem))
      const currentWithoutImages: ChatMessage = { role: "user", content: current.content }
      const imageTokens = (current.images ?? []).reduce(
        (total, image) => total + estimator.countImage(image),
        0,
      )
      const stats: ContextStats = {
        categories: {
          system: baseSystemTokens,
          knowledge: Math.max(0, systemWithKnowledgeTokens - baseSystemTokens),
          history: messageTokens(estimator, selectedHistory.messages.map((message) => ({
            role: message.role,
            content: message.content,
          }))),
          currentUser: estimator.countMessage(currentWithoutImages),
          images: imageTokens,
          tools: toolsTokens,
          mcpResults: messageTokens(estimator, additional),
          outputReserve,
          safetyMargin,
        },
        inputTokens,
        totalWithReserve,
        selectedKnowledge: selectedKnowledge.chunks.map((chunk) => ({ ...chunk, headingPath: [...chunk.headingPath] })),
        historyMessages: selectedHistory.messages.length,
        historyTurns: selectedHistory.selectedTurns,
        omitted: {
          knowledgeChunks: omittedKnowledge,
          historyTurns: selectedHistory.omittedTurns,
          mcpSegments: omittedMcpSegments,
          reasons: uniqueReasons(reasons),
        },
      }
      input.onDiagnostic?.(toSafeContextDiagnostic({
        modelId: input.modelId,
        profile: input.profile,
        categories: stats.categories,
        inputTokens: stats.inputTokens,
        totalWithReserve: stats.totalWithReserve,
        selectedKnowledge: stats.selectedKnowledge,
        historyMessages: stats.historyMessages,
        historyTurns: stats.historyTurns,
        omitted: stats.omitted,
      }))

      return {
        request: {
          messages: finalMessages.map(cloneMessage),
          maxOutputTokens: outputReserve,
        },
        stats,
      }
    },
    estimateOutput(text) {
      return estimator.countText(text)
    },
    dispose() {
      if (disposed) return
      disposed = true
      retriever.clear()
      estimator.dispose()
    },
  }
}
