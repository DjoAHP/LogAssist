import { describe, expect, it, vi } from "vitest"
import type { ChatMessage, ToolDefinition } from "@/lib/ai/types"
import type { ContextTokenEstimator, ModelContextProfile } from "./types"
import { ContextLengthDiagnosticError } from "./diagnostics"
import { createContextSession } from "./contextPlanner"

const fallbackProfile: ModelContextProfile = {
  contextWindowTokens: 4096,
  maxOutputTokens: 1024,
  source: "fallback",
  tokenizer: "conservative",
}

function createEstimator(): ContextTokenEstimator {
  const countText = (text: string) => Math.max(0, Math.ceil(text.length / 4))
  const countImage = () => 512
  const countMessage = (message: ChatMessage) =>
    4 + countText(message.role) + countText(message.content) +
    (message.images ?? []).reduce((total) => total + countImage(), 0) +
    (message.toolCalls?.length ? countText(JSON.stringify(message.toolCalls)) : 0)
  return {
    kind: "conservative",
    countText,
    countMessage,
    countMessages: (messages) => 2 + messages.reduce((sum, message) => sum + countMessage(message), 0),
    countTools: (tools: readonly ToolDefinition[]) => Math.ceil(JSON.stringify(tools).length / 4),
    countImage,
    dispose: vi.fn(),
  }
}

describe("createContextSession", () => {
  it("préserve intégralement le système et le message courant", () => {
    const session = createContextSession({
      modelId: "qwen",
      profile: fallbackProfile,
      estimator: createEstimator(),
      baseSystem: "INSTRUCTIONS",
      documents: [],
      history: [],
      currentUser: { content: "QUESTION COURANTE", images: [] },
      retrievalQuery: "QUESTION COURANTE",
    })

    const round = session.prepareRound({ additionalMessages: [], tools: [] })
    expect(round.request.messages[0]).toEqual({ role: "system", content: "INSTRUCTIONS" })
    expect(round.request.messages[round.request.messages.length - 1]).toEqual({
      role: "user",
      content: "QUESTION COURANTE",
    })
    expect(round.request.maxOutputTokens).toBe(1024)
    expect(round.stats.totalWithReserve).toBeLessThanOrEqual(4096)
  })

  it("bloque avant réseau si les éléments obligatoires dépassent la fenêtre", () => {
    const session = createContextSession({
      modelId: "qwen",
      profile: fallbackProfile,
      estimator: createEstimator(),
      baseSystem: "S".repeat(20_000),
      documents: [],
      history: [],
      currentUser: { content: "QUESTION", images: [] },
      retrievalQuery: "QUESTION",
    })
    let caught: unknown

    try {
      session.prepareRound({ additionalMessages: [], tools: [] })
    } catch (error) {
      caught = error
    }
    expect(caught).toMatchObject({ kind: "context_length" })
  })

  it("attache un diagnostic de compteurs sûr à l’échec obligatoire", () => {
    const tools: ToolDefinition[] = [{
      type: "function",
      function: {
        name: "big_tool",
        description: "DETAIL_SCHEMA",
        parameters: { type: "object", properties: {} },
      },
    }]
    const session = createContextSession({
      modelId: "qwen",
      profile: fallbackProfile,
      estimator: createEstimator(),
      baseSystem: "S".repeat(20_000),
      documents: [],
      history: [],
      currentUser: { content: "QUESTION", images: [] },
      retrievalQuery: "QUESTION",
    })
    let caught: unknown
    try {
      session.prepareRound({ additionalMessages: [], tools })
    } catch (error) {
      caught = error
    }

    expect(caught).toBeInstanceOf(ContextLengthDiagnosticError)
    const diagnostic = (caught as ContextLengthDiagnosticError).diagnostic
    const toolsTokens = Math.ceil(JSON.stringify(tools).length / 4)
    expect(diagnostic.modelId).toBe("qwen")
    expect(diagnostic.contextWindowTokens).toBe(4_096)
    expect(diagnostic.contextWindowSource).toBe("fallback")
    expect(diagnostic.tokens.tools).toBe(toolsTokens)
    // countMessage = 4 (en-tête) + rôle + contenu.
    expect(diagnostic.tokens.system).toBe(4 + Math.ceil("system".length / 4) + Math.ceil(20_000 / 4))
    expect(diagnostic.tokens.currentUser).toBe(4 + Math.ceil("user".length / 4) + Math.ceil("QUESTION".length / 4))
    expect(diagnostic.tokens.images).toBe(0)
    expect(diagnostic.tokens.outputReserve).toBe(1_024)
    expect(diagnostic.tokens.totalWithReserve).toBe(
      diagnostic.tokens.input + diagnostic.tokens.outputReserve + diagnostic.tokens.safetyMargin,
    )
    // Aucun contenu du schéma d’outils dans le diagnostic : uniquement des compteurs.
    expect(JSON.stringify(diagnostic)).not.toContain("DETAIL_SCHEMA")
  })

  it("réduit connaissances et historique sans muter les sources", () => {
    const documents = [{
      id: "k1",
      name: "HISE",
      content: `# ScriptNode\n${"gain ".repeat(2000)}`,
      sortOrder: 0,
    }]
    const history = Array.from({ length: 40 }, (_, index) => ({
      id: `m${index}`,
      role: index % 2 === 0 ? "user" as const : "assistant" as const,
      content: `tour ${index} ${"ancien ".repeat(100)}`,
    }))
    const original = JSON.stringify({ documents, history })
    const session = createContextSession({
      modelId: "qwen",
      profile: fallbackProfile,
      estimator: createEstimator(),
      baseSystem: "SYSTEM",
      documents,
      history,
      currentUser: { content: "Comment régler le gain ScriptNode ?", images: [] },
      retrievalQuery: "Comment régler le gain ScriptNode ?",
    })

    const round = session.prepareRound({ additionalMessages: [], tools: [] })
    expect(round.stats.totalWithReserve).toBeLessThanOrEqual(4096)
    expect(round.stats.omitted.historyTurns + round.stats.omitted.knowledgeChunks).toBeGreaterThan(0)
    expect(round.stats.selectedKnowledge.length).toBeGreaterThan(0)
    expect(JSON.stringify({ documents, history })).toBe(original)
  })

  it("retrouve une ancienne erreur pertinente dans une conversation de 500 messages", () => {
    const profile = fallbackProfile
    const cudaUser = "TOUR_CUDA_USER_ASSOCIE : analyse l’incident historique numéro dix-sept."
    const cudaAssistant = "TOUR_CUDA_ASSISTANT : CUDA out of memory pendant le rendu."
    const penultimateUser = "TOUR_RECENT_248_USER : avant-dernière question distincte."
    const penultimateAssistant = "TOUR_RECENT_248_ASSISTANT : avant-dernière réponse distincte."
    const latestUser = "TOUR_RECENT_249_USER : dernière question historique distincte."
    const latestAssistant = "TOUR_RECENT_249_ASSISTANT : dernière réponse historique distincte."
    const distinctiveTurns = new Map<number, { user: string; assistant: string }>([
      [17, { user: cudaUser, assistant: cudaAssistant }],
      [248, { user: penultimateUser, assistant: penultimateAssistant }],
      [249, { user: latestUser, assistant: latestAssistant }],
    ])
    const history = Array.from({ length: 250 }, (_, turnIndex) => {
      const distinctive = distinctiveTurns.get(turnIndex)
      return [
        {
          id: `user-${turnIndex}`,
          role: "user" as const,
          content: distinctive?.user ??
            `Question historique ${turnIndex} sur un calcul graphique sans rapport.`,
        },
        {
          id: `assistant-${turnIndex}`,
          role: "assistant" as const,
          content: distinctive?.assistant ??
            `Réponse historique ${turnIndex} avec plusieurs détails de diagnostic.`,
        },
      ]
    }).flat()
    const session = createContextSession({
      modelId: "qwen",
      profile,
      estimator: createEstimator(),
      baseSystem: "SYSTEM",
      documents: [],
      history,
      currentUser: {
        content: "Pourquoi CUDA échoue-t-il encore sur ce rendu ?",
        images: [],
      },
      retrievalQuery: "Pourquoi CUDA échoue-t-il encore sur ce rendu ?",
    })

    const round = session.prepareRound({ additionalMessages: [], tools: [] })
    const lastMessage = round.request.messages[round.request.messages.length - 1]
    const selectedMessages = round.request.messages.map((message) => ({
      role: message.role,
      content: message.content,
    }))

    expect(history).toHaveLength(500)
    expect(lastMessage?.content).toContain("CUDA")
    expect(selectedMessages).toEqual(expect.arrayContaining([
      { role: "user", content: penultimateUser },
      { role: "assistant", content: penultimateAssistant },
      { role: "user", content: latestUser },
      { role: "assistant", content: latestAssistant },
    ]))
    expect(selectedMessages).toEqual(expect.arrayContaining([
      { role: "user", content: cudaUser },
      { role: "assistant", content: cudaAssistant },
    ]))
    expect(round.request.messages.some((message) =>
      message.content.includes("CUDA out of memory"),
    )).toBe(true)
    expect(round.stats.omitted.historyTurns).toBeGreaterThan(0)
    expect(round.stats.totalWithReserve).toBeLessThanOrEqual(profile.contextWindowTokens)
  })

  it("tronque un résultat MCP par segments et garde son enveloppe", () => {
    const session = createContextSession({
      modelId: "qwen",
      profile: fallbackProfile,
      estimator: createEstimator(),
      baseSystem: "SYSTEM",
      documents: [],
      history: [],
      currentUser: { content: "Question", images: [] },
      retrievalQuery: "Question",
    })
    const round = session.prepareRound({
      tools: [],
      additionalMessages: [{
        kind: "external_tool",
        toolCallId: "call-1",
        prefix: "<external_mcp_result>",
        segments: Array.from({ length: 500 }, (_, index) => `segment ${index} ${"x".repeat(100)}`),
        suffix: "</external_mcp_result>",
      }],
    })

    const tool = round.request.messages.find((message) => message.role === "tool")
    expect(tool?.content).toContain("<external_mcp_result>")
    expect(tool?.content).toContain("Résultat tronqué pour respecter la fenêtre de contexte")
    expect(tool?.content).toContain("</external_mcp_result>")
    expect(round.stats.omitted.mcpSegments).toBeGreaterThan(0)
    expect(round.stats.totalWithReserve).toBeLessThanOrEqual(4096)
  })

  it("compte séparément les images et les définitions d’outils", () => {
    const session = createContextSession({
      modelId: "vision",
      profile: fallbackProfile,
      estimator: createEstimator(),
      baseSystem: "SYSTEM",
      documents: [],
      history: [],
      currentUser: {
        content: "Décris",
        images: [{ base64: "PRIVATE_BASE64", mimeType: "image/png", width: 800, height: 600 }],
      },
      retrievalQuery: "Décris",
    })
    const tools: ToolDefinition[] = [{
      type: "function",
      function: {
        name: "search",
        description: "Recherche",
        parameters: { type: "object", properties: { query: { type: "string" } } },
      },
    }]

    const round = session.prepareRound({ additionalMessages: [], tools })
    expect(round.stats.categories.images).toBe(512)
    expect(round.stats.categories.tools).toBeGreaterThan(0)
    expect(round.stats.categories.currentUser).toBeLessThan(round.stats.inputTokens)
  })

  it("bloque si le catalogue d’outils obligatoire dépasse à lui seul le budget", () => {
    const session = createContextSession({
      modelId: "qwen",
      profile: { ...fallbackProfile, contextWindowTokens: 2048 },
      estimator: createEstimator(),
      baseSystem: "SYSTEM",
      documents: [],
      history: [],
      currentUser: { content: "Question", images: [] },
      retrievalQuery: "Question",
    })
    const tools: ToolDefinition[] = [{
      type: "function",
      function: { name: "huge", description: "x".repeat(10_000), parameters: { type: "object" } },
    }]

    let caught: unknown
    try {
      session.prepareRound({ additionalMessages: [], tools })
    } catch (error) {
      caught = error
    }
    expect(caught).toMatchObject({ kind: "context_length" })
  })

  it("émet seulement le diagnostic sûr et libère l’estimateur une fois", () => {
    const estimator = createEstimator()
    const onDiagnostic = vi.fn()
    const session = createContextSession({
      modelId: "qwen",
      profile: fallbackProfile,
      estimator,
      baseSystem: "PRIVATE_SYSTEM",
      documents: [{ id: "k", name: "PRIVATE_DOC", content: "# Secret\nPRIVATE_CONTENT", sortOrder: 0 }],
      history: [],
      currentUser: { content: "PRIVATE_QUESTION", images: [] },
      retrievalQuery: "PRIVATE_CONTENT",
      onDiagnostic,
    })

    session.prepareRound({ additionalMessages: [], tools: [] })
    expect(session.estimateOutput("xxxx")).toBe(1)
    const serialized = JSON.stringify(onDiagnostic.mock.calls)
    expect(serialized).not.toContain("PRIVATE_SYSTEM")
    expect(serialized).not.toContain("PRIVATE_DOC")
    expect(serialized).not.toContain("PRIVATE_CONTENT")
    expect(serialized).not.toContain("PRIVATE_QUESTION")
    session.dispose()
    session.dispose()
    expect(estimator.dispose).toHaveBeenCalledTimes(1)
  })
})
