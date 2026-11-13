import { describe, expect, it, vi } from "vitest"
import type { IProvider } from "@/lib/ai/openai-compat"
import type { ChatRequest, TurnCallbacks } from "@/lib/ai/types"
import type { ToolAgentInput } from "@/lib/mcp/toolAgent"
import type { ContextSession } from "@/lib/context"
import { runAssistantTurn } from "./turnRunner"

type AssistantTurnInput = Parameters<typeof runAssistantTurn>[0]
type IsRequiredKey<T, K extends keyof T> = {} extends Pick<T, K> ? false : true
type HasNoRequest<T> = "request" extends keyof T ? false : true
type HasStrictContextContract = IsRequiredKey<AssistantTurnInput, "context"> extends true
  ? HasNoRequest<AssistantTurnInput>
  : false

const HAS_STRICT_CONTEXT_CONTRACT: HasStrictContextContract = true

type ToolTurnOptions = Omit<
  ToolAgentInput,
  "provider" | "context" | "apiKey" | "modelId" | "callbacks" | "signal"
>

const request: ChatRequest = {
  messages: [{ role: "user", content: "Question" }],
}
const signal = new AbortController().signal
const callbacks: TurnCallbacks = {}

function providerWithRunTurn(runTurn: ReturnType<typeof vi.fn>): IProvider {
  return { runTurn } as unknown as IProvider
}

function preparedContext(preparedRequest: ChatRequest): ContextSession {
  return {
    prepareRound: vi.fn().mockReturnValue({
      request: preparedRequest,
      stats: { inputTokens: 37, totalWithReserve: 1061 },
    }),
    estimateOutput: vi.fn().mockReturnValue(12),
    dispose: vi.fn(),
  } as unknown as ContextSession
}

function createToolOptions(): ToolTurnOptions {
  return {
    toolClient: {
      call: vi.fn().mockResolvedValue({ content: "Résultat", media: [], sources: [], isError: false, structuredContent: undefined, resourceLinks: [] }),
    },
    tools: [],
    webIntent: "auto",
    turnId: "turn-1",
    compatibilityKey: "provider/model",
    unsupportedTools: new Set<string>(),
    approve: vi.fn().mockResolvedValue("allow"),
  }
}

describe("runAssistantTurn", () => {
  it("exige une ContextSession et n'expose plus de requête non préparée dans son type public", () => {
    expect(HAS_STRICT_CONTEXT_CONTRACT).toBe(true)
  })

  it("exécute le tour direct avec la requête préparée par la ContextSession", async () => {
    const preparedRequest: ChatRequest = {
      messages: [{ role: "user", content: "Question bornée" }],
      maxOutputTokens: 1024,
    }
    const context = preparedContext(preparedRequest)
    const runTurn = vi.fn().mockResolvedValue({
      text: "Réponse",
      toolCalls: [],
      firstTokenMs: 12,
      totalMs: 40,
    })
    const result = await runAssistantTurn({
      provider: providerWithRunTurn(runTurn),
      context,
      apiKey: "secret",
      modelId: "model",
      callbacks,
      signal,
    })

    expect(context.prepareRound).toHaveBeenCalledWith({ additionalMessages: [], tools: [] })
    expect(runTurn).toHaveBeenCalledWith(preparedRequest, "secret", "model", {}, callbacks, signal)
    expect(result).toMatchObject({ estimatedUsage: { inputTokens: 37, outputTokens: 12 } })
  })

  it("conserve une estimation de repli même si le fournisseur annonce un usage", async () => {
    const context = preparedContext(request)
    const runTurn = vi.fn().mockResolvedValue({
      text: "Réponse",
      toolCalls: [],
      firstTokenMs: 12,
      totalMs: 40,
      usage: { inputTokens: 40, outputTokens: 10 },
    })

    const result = await runAssistantTurn({
      provider: providerWithRunTurn(runTurn),
      context,
      apiKey: "secret",
      modelId: "model",
      callbacks,
      signal,
    })

    expect(result).toMatchObject({
      usage: { inputTokens: 40, outputTokens: 10 },
      estimatedUsage: { inputTokens: 37, outputTokens: 12 },
    })
  })

  it("retourne un résultat uniforme pour un tour direct", async () => {
    const runTurn = vi.fn().mockResolvedValue({
      text: "Réponse",
      toolCalls: [],
      firstTokenMs: 12,
      totalMs: 40,
      usage: { inputTokens: 10, outputTokens: 4 },
    })
    const provider = providerWithRunTurn(runTurn)

    const result = await runAssistantTurn({
      provider,
      context: preparedContext(request),
      apiKey: "secret",
      modelId: "model",
      callbacks,
      signal,
    })

    expect(result).toMatchObject({
      text: "Réponse",
      sources: [],
      firstTokenMs: 12,
      usage: { inputTokens: 10, outputTokens: 4 },
    })
    expect(runTurn).toHaveBeenCalledWith(
      request,
      "secret",
      "model",
      {},
      callbacks,
      signal,
    )
  })

  it("reconstruit l'entrée outils avec les champs communs autoritaires", async () => {
    const runTools = vi.fn().mockResolvedValue({ text: "Réponse", sources: [], firstTokenMs: 10, totalMs: 20 })
    const tools = createToolOptions()
    const provider = providerWithRunTurn(vi.fn())
    const context = preparedContext(request)

    await runAssistantTurn({ provider, context, apiKey: "secret", modelId: "model", callbacks, signal, tools, runTools })

    expect(runTools).toHaveBeenCalledWith({ ...tools, provider, context, apiKey: "secret", modelId: "model", callbacks, signal })
  })

  it("utilise un tour direct sans catalogue", async () => {
    const runTurn = vi.fn().mockResolvedValue({
      text: "Réponse directe",
      toolCalls: [],
      firstTokenMs: 12,
      totalMs: 40,
    })
    const provider = providerWithRunTurn(runTurn)

    await runAssistantTurn({
      provider,
      context: preparedContext(request),
      apiKey: "secret",
      modelId: "model",
      callbacks,
      signal,
    })

    expect(runTurn).toHaveBeenCalledWith(request, "secret", "model", {}, callbacks, signal)
  })

  it("écrase défensivement les champs communs étrangers présents à l'exécution (outils)", async () => {
    const runTools = vi.fn().mockResolvedValue({
      text: "Réponse outils",
      sources: [],
      firstTokenMs: 15,
      totalMs: 90,
    })
    const provider = providerWithRunTurn(vi.fn())
    const foreignSignal = new AbortController().signal
    const tools = {
      ...createToolOptions(),
      modelId: "modèle étranger",
      signal: foreignSignal,
    } as unknown as ToolTurnOptions

    await runAssistantTurn({
      provider,
      context: preparedContext(request),
      apiKey: "secret",
      modelId: "model",
      callbacks,
      signal,
      tools,
      runTools,
    })

    expect(runTools).toHaveBeenCalledWith(expect.objectContaining({
      modelId: "model",
      signal,
    }))
    expect(runTools.mock.calls[0]?.[0].signal).not.toBe(foreignSignal)
  })

  it("propage le warning, l'usage et les sources du résultat outils", async () => {
    const sources = [{ url: "https://example.com", origin: "search" as const }]
    const runTools = vi.fn().mockResolvedValue({
      text: "Réponse outils",
      sources,
      firstTokenMs: 15,
      totalMs: 90,
      warning: "Outil indisponible",
      usage: { inputTokens: 20, outputTokens: 8 },
    })

    const result = await runAssistantTurn({
      provider: providerWithRunTurn(vi.fn()),
      context: preparedContext(request),
      apiKey: "secret",
      modelId: "model",
      callbacks,
      signal,
      tools: createToolOptions(),
      runTools,
    })

    expect(result).toMatchObject({
      warning: "Outil indisponible",
      usage: { inputTokens: 20, outputTokens: 8 },
      sources,
    })
  })

  it("laisse remonter une erreur directe par identité", async () => {
    const error = new Error("Échec direct")
    const provider = providerWithRunTurn(vi.fn().mockRejectedValue(error))

    await expect(runAssistantTurn({
      provider,
      context: preparedContext(request),
      apiKey: "secret",
      modelId: "model",
      callbacks,
      signal,
    })).rejects.toBe(error)
  })

  it("laisse remonter un AbortError direct par identité", async () => {
    const abort = new DOMException("aborted", "AbortError")
    const provider = providerWithRunTurn(vi.fn().mockRejectedValue(abort))

    await expect(runAssistantTurn({
      provider,
      context: preparedContext(request),
      apiKey: "secret",
      modelId: "model",
      callbacks,
      signal,
    })).rejects.toBe(abort)
  })

  it("laisse remonter une erreur outils par identité", async () => {
    const error = new Error("Échec outils")
    const runTools = vi.fn().mockRejectedValue(error)

    await expect(runAssistantTurn({
      provider: providerWithRunTurn(vi.fn()),
      context: preparedContext(request),
      apiKey: "secret",
      modelId: "model",
      callbacks,
      signal,
      tools: createToolOptions(),
      runTools,
    })).rejects.toBe(error)
  })

  it("laisse remonter un AbortError outils par identité", async () => {
    const abort = new DOMException("aborted", "AbortError")
    const runTools = vi.fn().mockRejectedValue(abort)

    await expect(runAssistantTurn({
      provider: providerWithRunTurn(vi.fn()),
      context: preparedContext(request),
      apiKey: "secret",
      modelId: "model",
      callbacks,
      signal,
      tools: createToolOptions(),
      runTools,
    })).rejects.toBe(abort)
  })
})
