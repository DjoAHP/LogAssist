import { describe, expect, it, vi } from "vitest"
import type { ChatMessage, ToolDefinition } from "@/lib/ai/types"
import type { ContextTokenEstimator, ModelContextProfile } from "./types"
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
