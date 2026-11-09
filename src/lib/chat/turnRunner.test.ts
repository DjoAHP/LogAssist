import { describe, expect, it, vi } from "vitest"
import type { IProvider } from "@/lib/ai/openai-compat"
import type { ChatRequest, TurnCallbacks } from "@/lib/ai/types"
import type { WebAgentInput } from "@/lib/mcp/webAgent"
import type { ToolAgentInput } from "@/lib/mcp/toolAgent"
import { runAssistantTurn } from "./turnRunner"

type WebTurnOptions = Omit<
  WebAgentInput,
  "provider" | "request" | "apiKey" | "modelId" | "callbacks" | "signal"
>

type ToolTurnOptions = Omit<
  ToolAgentInput,
  "provider" | "request" | "apiKey" | "modelId" | "callbacks" | "signal"
>

const request: ChatRequest = {
  messages: [{ role: "user", content: "Question" }],
}
const signal = new AbortController().signal
const callbacks: TurnCallbacks = {}

function providerWithRunTurn(runTurn: ReturnType<typeof vi.fn>): IProvider {
  return { runTurn } as unknown as IProvider
}

function createWebOptions(): WebTurnOptions {
  return {
    webClient: {
      call: vi.fn().mockResolvedValue({ content: "Résultat", sources: [] }),
    },
    toolChoice: "auto",
    requestId: "assistant-1",
    compatibilityKey: "provider/model",
    unsupportedTools: new Set<string>(),
  }
}

function createToolOptions(): ToolTurnOptions {
  return {
    toolClient: {
      call: vi.fn().mockResolvedValue({ content: "Résultat", sources: [], isError: false, structuredContent: undefined, resourceLinks: [] }),
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
      request,
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

    await runAssistantTurn({ provider, request, apiKey: "secret", modelId: "model", callbacks, signal, tools, runTools })

    expect(runTools).toHaveBeenCalledWith({ ...tools, provider, request, apiKey: "secret", modelId: "model", callbacks, signal })
  })

  it("utilise un tour direct sans catalogue", async () => {
    const runTurn = vi.fn().mockResolvedValue({
      text: "Réponse directe",
      toolCalls: [],
      firstTokenMs: 12,
      totalMs: 40,
    })
    const provider = providerWithRunTurn(runTurn)

    await runAssistantTurn({ provider, request, apiKey: "secret", modelId: "model", callbacks, signal })

    expect(runTurn).toHaveBeenCalledWith(request, "secret", "model", {}, callbacks, signal)
  })

  it("reconstruit l'entrée Web avec les champs communs de la racine", async () => {
    const runWeb = vi.fn().mockResolvedValue({
      text: "Réponse Web",
      sources: [{ url: "https://example.com", origin: "search" }],
      firstTokenMs: 15,
      totalMs: 90,
    })
    const provider = providerWithRunTurn(vi.fn())
    const web = createWebOptions()

    const result = await runAssistantTurn({
      provider,
      request,
      apiKey: "secret",
      modelId: "model",
      callbacks,
      signal,
      web,
      runWeb,
    })

    expect(runWeb).toHaveBeenCalledWith({
      ...web,
      provider,
      request,
      apiKey: "secret",
      modelId: "model",
      callbacks,
      signal,
    })
    expect(result.text).toBe("Réponse Web")
  })

  it("écrase défensivement les champs communs étrangers présents à l'exécution", async () => {
    const runWeb = vi.fn().mockResolvedValue({
      text: "Réponse Web",
      sources: [],
      firstTokenMs: 15,
      totalMs: 90,
    })
    const provider = providerWithRunTurn(vi.fn())
    const foreignSignal = new AbortController().signal
    const web = {
      ...createWebOptions(),
      modelId: "modèle étranger",
      signal: foreignSignal,
    } as unknown as WebTurnOptions

    await runAssistantTurn({
      provider,
      request,
      apiKey: "secret",
      modelId: "model",
      callbacks,
      signal,
      web,
      runWeb,
    })

    expect(runWeb).toHaveBeenCalledWith(expect.objectContaining({
      modelId: "model",
      signal,
    }))
    expect(runWeb.mock.calls[0]?.[0].signal).not.toBe(foreignSignal)
  })

  it("propage le warning, l'usage et les sources du résultat Web", async () => {
    const sources = [{ url: "https://example.com", origin: "search" as const }]
    const runWeb = vi.fn().mockResolvedValue({
      text: "Réponse Web dégradée",
      sources,
      firstTokenMs: 15,
      totalMs: 90,
      warning: "Accès Web indisponible",
      usage: { inputTokens: 20, outputTokens: 8 },
    })

    const result = await runAssistantTurn({
      provider: providerWithRunTurn(vi.fn()),
      request,
      apiKey: "secret",
      modelId: "model",
      callbacks,
      signal,
      web: createWebOptions(),
      runWeb,
    })

    expect(result).toMatchObject({
      warning: "Accès Web indisponible",
      usage: { inputTokens: 20, outputTokens: 8 },
      sources,
    })
  })

  it("laisse remonter une erreur directe par identité", async () => {
    const error = new Error("Échec direct")
    const provider = providerWithRunTurn(vi.fn().mockRejectedValue(error))

    await expect(runAssistantTurn({
      provider,
      request,
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
      request,
      apiKey: "secret",
      modelId: "model",
      callbacks,
      signal,
    })).rejects.toBe(abort)
  })

  it("laisse remonter une erreur Web par identité", async () => {
    const error = new Error("Échec Web")
    const runWeb = vi.fn().mockRejectedValue(error)

    await expect(runAssistantTurn({
      provider: providerWithRunTurn(vi.fn()),
      request,
      apiKey: "secret",
      modelId: "model",
      callbacks,
      signal,
      web: createWebOptions(),
      runWeb,
    })).rejects.toBe(error)
  })

  it("laisse remonter un AbortError Web par identité", async () => {
    const abort = new DOMException("aborted", "AbortError")
    const runWeb = vi.fn().mockRejectedValue(abort)

    await expect(runAssistantTurn({
      provider: providerWithRunTurn(vi.fn()),
      request,
      apiKey: "secret",
      modelId: "model",
      callbacks,
      signal,
      web: createWebOptions(),
      runWeb,
    })).rejects.toBe(abort)
  })
})
