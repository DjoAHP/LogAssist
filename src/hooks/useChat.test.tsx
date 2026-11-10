// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { renderHook, act, cleanup, waitFor } from "@testing-library/react"
import { useChat, type Attachment } from "@/hooks/useChat"
import type { MessageRow } from "@/lib/db/messages"
import type { ProviderConfig } from "@/lib/ai/types"
import type { McpRuntimeSnapshot } from "@/lib/mcp/runtime"
import type { AssistantTurnResult } from "@/lib/chat/turnRunner"
import { snapshot, genericTool, tinyfishTool } from "@/test/mcpFixtures"

const runTurnMock = vi.hoisted(() => vi.fn())
const systemPromptMock = vi.hoisted(() => vi.fn())
const tinyfishCallMock = vi.hoisted(() => vi.fn())
const tinyfishCancelMock = vi.hoisted(() => vi.fn())
const loggerErrorMock = vi.hoisted(() => vi.fn())
const resolvePricingProviderMock = vi.hoisted(() => vi.fn())
const estimateTurnMetricsMock = vi.hoisted(() => vi.fn(() => ({
  inputTokens: 7,
  outputTokens: 3,
  usageSource: "estimated" as const,
  costMicrousd: null,
})))
const metricsFromProviderUsageMock = vi.hoisted(() => vi.fn<
  (...args: unknown[]) => {
    inputTokens: number
    outputTokens: number
    usageSource: "provider"
    costMicrousd: number
  } | null
>(() => ({
  inputTokens: 40,
  outputTokens: 10,
  usageSource: "provider",
  costMicrousd: 12,
})))
const runAssistantTurnMock = vi.hoisted(() => vi.fn(async (input: any) => {
  if (input.tools) {
    // Tool agent path
    return runTurnMock(input.request, input.apiKey, input.modelId, { tools: [], toolChoice: "auto" }, input.callbacks, input.signal)
  }
  // Direct provider path
  return runTurnMock(input.request, input.apiKey, input.modelId, {}, input.callbacks, input.signal)
}))
const mcpCallToolMock = vi.hoisted(() => vi.fn())
const mcpCancelTurnMock = vi.hoisted(() => vi.fn())
const resolveWebIntentMock = vi.hoisted(() => vi.fn(() => "auto"))

const runtimeWithTools = (): McpRuntimeSnapshot => snapshot({
  activeTools: [genericTool("db", "delete", "db__delete", "confirm")],
})

const runtimeWithWeb = (): McpRuntimeSnapshot => snapshot({
  activeTools: [tinyfishTool("search"), tinyfishTool("fetch_content")],
  webAccess: { enabled: true, configured: true },
})

const assistantResult = (text: string): AssistantTurnResult => ({
  text, sources: [], media: [], firstTokenMs: 5, totalMs: 20,
})

function actSend(current: ReturnType<typeof useChat>): Promise<boolean> {
  let sending!: Promise<boolean>
  act(() => { sending = current.send("conv-1", "Question", [], {}) })
  return sending
}

vi.mock("@/lib/db/messages", () => ({
  messages: {
    insert: vi.fn(),
    updateAssistant: vi.fn(),
    listByConversation: vi.fn(),
    updateError: vi.fn(),
    removeByConversation: vi.fn(),
    setMediaRefs: vi.fn(),
  },
}))
vi.mock("@/lib/db/messageMedia", () => ({
  messageMedia: { insertRows: vi.fn(), listByMessageIds: vi.fn(), removeByMessageIds: vi.fn() },
}))
vi.mock("@/lib/db/images", () => ({ images: { create: vi.fn(), get: vi.fn(), remove: vi.fn() } }))
vi.mock("@/lib/db/conversations", () => ({ conversations: { touch: vi.fn(), create: vi.fn(), rename: vi.fn(), remove: vi.fn() } }))
vi.mock("@/lib/secrets/service", () => ({ secrets: { set: vi.fn(), get: vi.fn(), remove: vi.fn() } }))
vi.mock("@/lib/prompts/compose", () => ({ buildSystemPrompt: systemPromptMock }))
vi.mock("@/lib/prompts/store", () => ({
  loadPromptSettings: vi.fn().mockResolvedValue({ general: "GEN", profile: "PROF" }),
}))
vi.mock("@/lib/db/knowledge", () => ({ knowledge: { listEnabled: vi.fn().mockResolvedValue([]), list: vi.fn().mockResolvedValue([]) } }))
vi.mock("@/lib/db/conversationKnowledge", () => ({ conversationKnowledge: { listOn: vi.fn().mockResolvedValue([]) } }))
vi.mock("@/lib/ai/factory", () => ({
  buildPreview: (p: string, m: string) => `${p} › ${m}`,
  createProvider: () => ({
    runTurn: runTurnMock,
    stream: vi.fn(),
    complete: vi.fn(),
    testConnection: vi.fn(),
  }),
}))
vi.mock("@/lib/token", () => ({
  estimateTurnMetrics: estimateTurnMetricsMock,
  metricsFromProviderUsage: metricsFromProviderUsageMock,
  resolvePricingProvider: resolvePricingProviderMock,
}))
vi.mock("@/lib/mcp/webIntent", () => ({ resolveWebIntent: resolveWebIntentMock }))
vi.mock("@/lib/mcp/client", () => ({
  mcp: { callTool: mcpCallToolMock, cancelTurn: mcpCancelTurnMock },
}))
vi.mock("@/lib/logger", () => ({
  logger: { debug: vi.fn(), error: loggerErrorMock },
}))
vi.mock("@/lib/chat/turnRunner", () => ({ runAssistantTurn: runAssistantTurnMock }))

import { messages as messagesDb } from "@/lib/db/messages"
import { messageMedia as messageMediaDb } from "@/lib/db/messageMedia"
import { conversations } from "@/lib/db/conversations"
import { secrets } from "@/lib/secrets/service"
import { knowledge } from "@/lib/db/knowledge"
import { conversationKnowledge } from "@/lib/db/conversationKnowledge"
import { loadPromptSettings } from "@/lib/prompts/store"

const provider = {
  id: "p1",
  name: "Test",
  apiFamily: "openai",
  baseUrl: "https://api.test/v1",
  secretRef: "ref",
} as unknown as ProviderConfig
const modelSelection = { provider, modelId: "m1", supportsImages: false }

function messageRow(overrides: Partial<MessageRow>): MessageRow {
  return {
    id: "row",
    conversation_id: "conv-1",
    role: "assistant",
    content: "Réponse",
    attachments: "[]",
    model_label: null,
    latency_ms: null,
    error: null,
    sources: "[]",
    media: "[]",
    first_token_ms: null,
    input_tokens: null,
    output_tokens: null,
    usage_source: null,
    cost_microusd: null,
    ...overrides,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  systemPromptMock.mockReset()
  runTurnMock.mockReset()
  estimateTurnMetricsMock.mockReset()
  metricsFromProviderUsageMock.mockReset()
  tinyfishCallMock.mockReset()
  tinyfishCancelMock.mockReset()
  loggerErrorMock.mockReset()
  resolvePricingProviderMock.mockReset().mockReturnValue(null)
  runAssistantTurnMock.mockReset()
  mcpCallToolMock.mockReset()
  mcpCancelTurnMock.mockReset()
  resolveWebIntentMock.mockReset()
  systemPromptMock.mockReturnValue("")
  resolveWebIntentMock.mockReturnValue("auto")
  vi.mocked(messagesDb.insert).mockReset().mockResolvedValue("row-1")
  vi.mocked(messagesDb.updateAssistant).mockReset().mockResolvedValue(undefined)
  vi.mocked(messagesDb.listByConversation).mockReset().mockResolvedValue([])
  vi.mocked(conversations.touch).mockReset().mockResolvedValue(undefined)
  vi.mocked(secrets.get).mockReset().mockResolvedValue("sk-test")
  vi.mocked(loadPromptSettings).mockReset().mockResolvedValue({ general: "GEN", profile: "PROF" })
  vi.mocked(knowledge.listEnabled).mockReset().mockResolvedValue([])
  vi.mocked(knowledge.list).mockReset().mockResolvedValue([])
  vi.mocked(conversationKnowledge.listOn).mockReset().mockResolvedValue([])
  runTurnMock.mockResolvedValue({
    text: "Réponse",
    toolCalls: [],
    firstTokenMs: 25,
    totalMs: 100,
    usage: { inputTokens: 40, outputTokens: 10 },
  })
  runAssistantTurnMock.mockImplementation(async (input: any) => {
    if (input.tools) {
      // Tool agent path - use runTurnMock with tools config
      return runTurnMock(input.request, input.apiKey, input.modelId, { tools: [], toolChoice: "auto" }, input.callbacks, input.signal)
    }
    return runTurnMock(input.request, input.apiKey, input.modelId, {}, input.callbacks, input.signal)
  })
  estimateTurnMetricsMock.mockReturnValue({
    inputTokens: 7,
    outputTokens: 3,
    usageSource: "estimated",
    costMicrousd: null,
  })
  metricsFromProviderUsageMock.mockReturnValue({
    inputTokens: 40,
    outputTokens: 10,
    usageSource: "provider",
    costMicrousd: 12,
  })
  tinyfishCancelMock.mockResolvedValue(undefined)
  mcpCancelTurnMock.mockResolvedValue(undefined)
  // messageMedia mocks (added for multimodal media persistence)
  vi.mocked(messageMediaDb.insertRows).mockReset().mockResolvedValue(undefined)
  vi.mocked(messageMediaDb.listByMessageIds).mockReset().mockResolvedValue([])
  vi.mocked(messageMediaDb.removeByMessageIds).mockReset().mockResolvedValue(undefined)
})

afterEach(cleanup)

describe("useChat.send — contract anti-perte", () => {
  it("persiste les métriques fournisseur et résout true après le tour", async () => {
    const { result } = renderHook(() => useChat(modelSelection))
    await act(async () => {
      const ok = await result.current.send("conv-1", "Salut")
      expect(ok).toBe(true)
    })
    expect(messagesDb.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        role: "assistant",
        content: "Réponse",
        latency_ms: 100,
        first_token_ms: 25,
        input_tokens: 40,
        output_tokens: 10,
        usage_source: "provider",
        cost_microusd: 12,
      }),
    )
    expect(metricsFromProviderUsageMock).toHaveBeenCalledWith(
      { inputTokens: 40, outputTokens: 10 },
      "",
      "m1",
    )
    expect(estimateTurnMetricsMock).not.toHaveBeenCalled()
    expect(result.current.vm[result.current.vm.length - 1]).toMatchObject({
      firstTokenMs: 25,
      inputTokens: 40,
      outputTokens: 10,
      usageSource: "provider",
      costMicrousd: 12,
    })
    expect(vi.mocked(messagesDb.insert).mock.invocationCallOrder[0])
      .toBeLessThan(runTurnMock.mock.invocationCallOrder[0])
    expect(runTurnMock.mock.calls[0][5]).toBeInstanceOf(AbortSignal)
    expect(result.current.busy).toBe(false)
    expect(runAssistantTurnMock).toHaveBeenCalledTimes(1)
  })

  it("estime les métriques quand le fournisseur ne fournit pas d'usage", async () => {
    runTurnMock.mockResolvedValueOnce({
      text: "Sans usage",
      toolCalls: [],
      firstTokenMs: 8,
      totalMs: 30,
    })
    const { result } = renderHook(() => useChat(modelSelection))

    await act(async () => {
      await result.current.send("conv-1", "Salut")
    })

    expect(metricsFromProviderUsageMock).not.toHaveBeenCalled()
    expect(estimateTurnMetricsMock).toHaveBeenCalledWith(
      expect.any(Array),
      "Sans usage",
      "",
      "m1",
    )
    expect(messagesDb.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        input_tokens: 7,
        output_tokens: 3,
        usage_source: "estimated",
        cost_microusd: null,
      }),
    )
  })

  it("conserve la réponse quand l'estimation des métriques échoue", async () => {
    runTurnMock.mockResolvedValueOnce({
      text: "Réponse sans métriques",
      toolCalls: [],
      firstTokenMs: 18,
      totalMs: 42,
    })
    estimateTurnMetricsMock.mockImplementationOnce(() => {
      throw new Error("metric failed with Bearer sk-metric-secret")
    })
    const { result } = renderHook(() => useChat(modelSelection))

    await act(async () => {
      expect(await result.current.send("conv-1", "Salut")).toBe(true)
    })

    expect(messagesDb.insert).toHaveBeenLastCalledWith(expect.objectContaining({
      role: "assistant",
      content: "Réponse sans métriques",
      error: null,
      latency_ms: 42,
      first_token_ms: 18,
      input_tokens: null,
      output_tokens: null,
      usage_source: null,
      cost_microusd: null,
    }))
    expect(result.current.vm[result.current.vm.length - 1]).toMatchObject({
      content: "Réponse sans métriques",
      latencyMs: 42,
      firstTokenMs: 18,
    })
    expect(result.current.vm[result.current.vm.length - 1].apiError).toBeUndefined()
    expect(JSON.stringify(loggerErrorMock.mock.calls)).not.toContain("sk-metric-secret")
  })

  it("estime les métriques quand l'usage fournisseur est invalide", async () => {
    metricsFromProviderUsageMock.mockReturnValueOnce(null)
    const { result } = renderHook(() => useChat(modelSelection))

    await act(async () => {
      await result.current.send("conv-1", "Salut")
    })

    expect(metricsFromProviderUsageMock).toHaveBeenCalledTimes(1)
    expect(estimateTurnMetricsMock).toHaveBeenCalledTimes(1)
    expect(messagesDb.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        input_tokens: 7,
        output_tokens: 3,
        usage_source: "estimated",
        cost_microusd: null,
      }),
    )
  })

  it("n'accorde aucun tarif à un fournisseur affiché OpenAI sur un endpoint non officiel", async () => {
    metricsFromProviderUsageMock.mockReturnValueOnce(null)
    const displayedAsOpenAi = {
      ...provider,
      name: "OpenAI",
      baseUrl: "https://proxy.example.test/v1",
    } as ProviderConfig
    const { result } = renderHook(() => useChat({
      provider: displayedAsOpenAi,
      modelId: "gpt-4o-mini",
      supportsImages: false,
    }))

    await act(async () => {
      await result.current.send("conv-1", "Salut")
    })

    expect(resolvePricingProviderMock).toHaveBeenCalledWith("https://proxy.example.test/v1")
    expect(metricsFromProviderUsageMock).toHaveBeenCalledWith(
      { inputTokens: 40, outputTokens: 10 },
      "",
      "gpt-4o-mini",
    )
    expect(estimateTurnMetricsMock).toHaveBeenCalledWith(
      expect.any(Array),
      "Réponse",
      "",
      "gpt-4o-mini",
    )
  })

  it("utilise le Web après l'insert user et persiste uniquement les sources finales", async () => {
    const sources = [{ url: "https://example.com", title: "Doc", origin: "search" as const }]
    runAssistantTurnMock.mockResolvedValueOnce({
      text: "Réponse Web",
      firstTokenMs: 2,
      totalMs: 15,
      sources,
      warning: "Web partiel",
    })
    const { result } = renderHook(() =>
      useChat(modelSelection, runtimeWithWeb()),
    )

    let outcome: boolean | undefined
    await act(async () => {
      outcome = await result.current.send("conv-1", "Cherche ceci", [], { forceWeb: true })
    })

    expect(outcome).toBe(true)
    expect(runTurnMock).not.toHaveBeenCalled()
    expect(resolveWebIntentMock).toHaveBeenCalledWith("Cherche ceci", true)
    expect(runAssistantTurnMock).toHaveBeenCalledTimes(1)
    expect(messagesDb.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        role: "assistant",
        content: "Réponse Web",
        sources: JSON.stringify(sources),
        latency_ms: 15,
        first_token_ms: 2,
        input_tokens: null,
        output_tokens: null,
        usage_source: null,
        cost_microusd: null,
      }),
    )
    expect(estimateTurnMetricsMock).not.toHaveBeenCalled()
    expect(result.current.vm[result.current.vm.length - 1]).toMatchObject({
      content: "Réponse Web",
      sources,
      webWarning: "Web partiel",
      latencyMs: 15,
      firstTokenMs: 2,
    })
    expect(result.current.vm[result.current.vm.length - 1].inputTokens).toBeUndefined()
    const turnInput = runAssistantTurnMock.mock.calls[0][0]
    expect(turnInput.signal).toBeInstanceOf(AbortSignal)
    expect(turnInput.tools).toMatchObject({
      turnId: expect.any(String),
      compatibilityKey: "p1/m1",
      webIntent: "auto",
      tools: expect.arrayContaining([
        expect.objectContaining({ nativeName: "search", kind: "tinyfish_web" }),
        expect.objectContaining({ nativeName: "fetch_content", kind: "tinyfish_web" }),
      ]),
    })
  })

  it("persiste uniquement la réponse finale de l'assistant, sans contenu Web brut", async () => {
    const sources = [{ url: "https://example.com", title: "Doc", origin: "search" as const }]
    runAssistantTurnMock.mockResolvedValueOnce({
      text: "Réponse finale",
      firstTokenMs: 5,
      totalMs: 20,
      sources,
    })
    const { result } = renderHook(() => useChat(modelSelection, runtimeWithTools()))
    await act(async () => {
      await result.current.send("conv-1", "Question", [], {})
    })
    const assistantInsert = vi.mocked(messagesDb.insert).mock.calls
      .map(([row]) => row)
      .find((row) => row.role === "assistant")
    expect(assistantInsert).toBeDefined()
    expect(assistantInsert!.content).toBe("Réponse finale")
  })

  it("ne fabrique pas de métriques pour un usage Web invalide", async () => {
    metricsFromProviderUsageMock.mockReturnValueOnce(null)
    runAssistantTurnMock.mockResolvedValueOnce({
      text: "Réponse Web",
      firstTokenMs: 4,
      totalMs: 20,
      sources: [],
      usage: { inputTokens: -1, outputTokens: 2 },
    })
    const { result } = renderHook(() =>
      useChat(modelSelection, runtimeWithWeb()),
    )

    await act(async () => {
      expect(await result.current.send("conv-1", "Question Web")).toBe(true)
    })

    expect(metricsFromProviderUsageMock).toHaveBeenCalledTimes(1)
    expect(estimateTurnMetricsMock).not.toHaveBeenCalled()
    expect(messagesDb.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        role: "assistant",
        latency_ms: 20,
        first_token_ms: 4,
        input_tokens: null,
        output_tokens: null,
        usage_source: null,
        cost_microusd: null,
      }),
    )
  })

  it.each([
    ["NaN", Number.NaN],
    ["négatif", -1],
  ])("ignore un TTFT %s sans perdre la réponse", async (_label, firstTokenMs) => {
    runTurnMock.mockResolvedValueOnce({
      text: "Réponse valide",
      toolCalls: [],
      firstTokenMs,
      totalMs: 20,
      usage: { inputTokens: 1, outputTokens: 2 },
    })
    const { result } = renderHook(() => useChat(modelSelection))

    await act(async () => {
      expect(await result.current.send("conv-1", "Salut")).toBe(true)
    })

    expect(messagesDb.insert).toHaveBeenLastCalledWith(expect.objectContaining({
      role: "assistant",
      content: "Réponse valide",
      latency_ms: 20,
      first_token_ms: null,
      error: null,
    }))
    expect(result.current.vm[result.current.vm.length - 1].firstTokenMs).toBeUndefined()
  })

  it("ignore une latence totale infinie sans perdre la réponse", async () => {
    runTurnMock.mockResolvedValueOnce({
      text: "Réponse valide",
      toolCalls: [],
      firstTokenMs: 10,
      totalMs: Number.POSITIVE_INFINITY,
      usage: { inputTokens: 1, outputTokens: 2 },
    })
    const { result } = renderHook(() => useChat(modelSelection))

    await act(async () => {
      expect(await result.current.send("conv-1", "Salut")).toBe(true)
    })

    expect(messagesDb.insert).toHaveBeenLastCalledWith(expect.objectContaining({
      role: "assistant",
      latency_ms: null,
      first_token_ms: 10,
      error: null,
    }))
    expect(result.current.vm[result.current.vm.length - 1].latencyMs).toBeUndefined()
  })

  it("retourne true et matérialise l'erreur si l'orchestration échoue après l'insert user", async () => {
    runAssistantTurnMock.mockRejectedValueOnce(new Error("MCP inattendu"))
    const { result } = renderHook(() =>
      useChat(modelSelection, runtimeWithWeb()),
    )

    let outcome: boolean | undefined
    await act(async () => {
      outcome = await result.current.send("conv-1", "Question")
    })

    expect(outcome).toBe(true)
    expect(messagesDb.insert).toHaveBeenCalledWith(
      expect.objectContaining({ role: "assistant", error: expect.any(String) }),
    )
  })

  it("interrompt le LLM et l'appel MCP actif avec le même turnId", async () => {
    let activeTurnId = ""
    let rootSignal: AbortSignal | undefined
    let rejectMcp: ((reason: unknown) => void) | undefined
    runAssistantTurnMock.mockImplementationOnce(async (input) => {
      rootSignal = input.signal
      if (input.tools) {
        await input.tools.toolClient.call("tinyfish", input.tools.turnId, "call-1", "search", { query: "Tauri" })
      }
      return { text: "tardif", firstTokenMs: 0, totalMs: 1, sources: [] }
    })
    mcpCallToolMock.mockImplementationOnce((_serverId: string, turnId: string, _callId: string, _nativeName: string, _args: Record<string, unknown>) => {
      activeTurnId = turnId
      return new Promise((_resolve, reject) => {
        rejectMcp = reject
      })
    })
    mcpCancelTurnMock.mockImplementationOnce(async () => {
      rejectMcp?.(new DOMException("aborted", "AbortError"))
    })
    const { result } = renderHook(() =>
      useChat(modelSelection, runtimeWithWeb()),
    )
    let sendPromise: Promise<boolean>

    act(() => {
      sendPromise = result.current.send("conv-1", "Question")
    })
    await vi.waitFor(() => expect(activeTurnId).not.toBe(""))

    act(() => result.current.interrupt())
    await act(async () => {
      expect(await sendPromise!).toBe(true)
    })

    expect(mcpCancelTurnMock).toHaveBeenCalledWith(activeTurnId)
    expect(rootSignal?.aborted).toBe(true)
    expect(messagesDb.insert).toHaveBeenCalledWith(
      expect.objectContaining({ error: JSON.stringify({ interrupted: true }) }),
    )
    expect(result.current.busy).toBe(false)
  })

  it("expose les statuts searching et fetching pendant l'orchestration", async () => {
    let capturedOnWebStatus: ((status: "searching" | "fetching" | undefined) => void) | undefined
    let finish: ((value: unknown) => void) | undefined
    runAssistantTurnMock.mockImplementationOnce((input) => {
      capturedOnWebStatus = input.tools?.onWebStatus
      return new Promise((resolve) => {
        finish = resolve
      })
    })
    const { result } = renderHook(() =>
      useChat(modelSelection, runtimeWithWeb()),
    )
    let sendPromise: Promise<boolean>

    act(() => {
      sendPromise = result.current.send("conv-1", "Question")
    })
    await vi.waitFor(() => expect(capturedOnWebStatus).toBeDefined())

    act(() => capturedOnWebStatus?.("searching"))
    expect(result.current.vm[result.current.vm.length - 1].webStatus).toBe("searching")
    act(() => capturedOnWebStatus?.("fetching"))
    expect(result.current.vm[result.current.vm.length - 1].webStatus).toBe("fetching")

    finish?.({ text: "Réponse", firstTokenMs: 1, totalMs: 2, sources: [] })
    await act(async () => await sendPromise!)
  })

  it("persiste une interruption Web après l'insert utilisateur", async () => {
    runAssistantTurnMock.mockRejectedValueOnce(new DOMException("aborted", "AbortError"))
    const { result } = renderHook(() =>
      useChat(modelSelection, runtimeWithWeb()),
    )

    await act(async () => {
      expect(await result.current.send("conv-1", "Question")).toBe(true)
    })

    expect(messagesDb.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        role: "assistant",
        error: JSON.stringify({ interrupted: true }),
      }),
    )
  })

  it("traite l'annulation du plugin Windows comme une interruption", async () => {
    runAssistantTurnMock.mockRejectedValueOnce(new Error("Request cancelled"))
    const { result } = renderHook(() =>
      useChat(modelSelection, runtimeWithWeb()),
    )

    await act(async () => {
      expect(await result.current.send("conv-1", "Question")).toBe(true)
    })

    expect(messagesDb.insert).toHaveBeenCalledWith(
      expect.objectContaining({ error: JSON.stringify({ interrupted: true }) }),
    )
  })

  it("expose l'incompatibilité tools du modèle courant", async () => {
    runAssistantTurnMock.mockImplementationOnce(async (input) => {
      input.tools?.unsupportedTools.add(input.tools.compatibilityKey)
      return { text: "Sans Web", firstTokenMs: 1, totalMs: 2, sources: [] }
    })
    const { result } = renderHook(() =>
      useChat(modelSelection, runtimeWithWeb()),
    )

    await act(async () => {
      await result.current.send("conv-1", "Question")
    })

    expect(result.current.webToolsUnsupported).toBe(true)
  })

  it("mappe les sources historiques et ignore un JSON malformé", async () => {
    vi.mocked(messagesDb.listByConversation).mockResolvedValueOnce([
      {
        id: "a1", conversation_id: "conv-1", role: "assistant", content: "A",
        attachments: "[]", model_label: null, latency_ms: null, error: null,
        sources: JSON.stringify([{ url: "https://example.com", origin: "search" }]),
        media: "[]",
        first_token_ms: 18, input_tokens: 22, output_tokens: 9,
        usage_source: "provider", cost_microusd: 4,
      },
      {
        id: "a2", conversation_id: "conv-1", role: "assistant", content: "B",
        attachments: "[]", model_label: null, latency_ms: null, error: null,
        sources: "{cassé",
        media: "[]",
        first_token_ms: null, input_tokens: null, output_tokens: null,
        usage_source: null, cost_microusd: null,
      },
    ])
    const { result } = renderHook(() => useChat(modelSelection))

    await act(async () => result.current.load("conv-1"))

    expect(result.current.vm[0].sources).toEqual([
      { url: "https://example.com", origin: "search" },
    ])
    expect(result.current.vm[0]).toMatchObject({
      firstTokenMs: 18,
      inputTokens: 22,
      outputTokens: 9,
      usageSource: "provider",
      costMicrousd: 4,
    })
    expect(result.current.vm[1].sources).toEqual([])
  })

  it("n'expose pas de durées historiques invalides dans la VM", async () => {
    vi.mocked(messagesDb.listByConversation).mockResolvedValueOnce([
      messageRow({
        id: "invalid-durations",
        latency_ms: Number.NaN,
        first_token_ms: -5,
      }),
    ])
    const { result } = renderHook(() => useChat(modelSelection))

    await act(async () => result.current.load("conv-1"))

    expect(result.current.vm[0].latencyMs).toBeUndefined()
    expect(result.current.vm[0].firstTokenMs).toBeUndefined()
  })

  it("ne conserve que le kind des erreurs historiques non vérifiables", async () => {
    vi.mocked(messagesDb.listByConversation).mockResolvedValueOnce([
      messageRow({
        id: "assistant-history",
        error: JSON.stringify({
          kind: "auth",
          message: "Credential CUSTOM.key+42 was rejected",
          detail: "The supplied value CUSTOM.key+42 is invalid",
        }),
      }),
    ])
    const { result } = renderHook(() => useChat(modelSelection))

    await act(async () => result.current.load("conv-1"))

    expect(result.current.vm[0].apiError).toEqual({
      kind: "auth",
      message: "",
    })
    const serializedVm = JSON.stringify(result.current.vm)
    expect(serializedVm).not.toContain("CUSTOM")
    expect(serializedVm).not.toContain("detail")
  })

  it("conserve le kind persistence validé au rechargement", async () => {
    vi.mocked(messagesDb.listByConversation).mockResolvedValueOnce([
      messageRow({
        id: "assistant-persistence",
        error: JSON.stringify({
          kind: "persistence",
          message: "La réponse n'a pas pu être enregistrée.",
        }),
      }),
    ])
    const { result } = renderHook(() => useChat(modelSelection))

    await act(async () => result.current.load("conv-1"))

    expect(result.current.vm[0].apiError).toEqual({
      kind: "persistence",
      message: "",
    })
  })

  it("rabats un kind historique inconnu sans l'exposer dans la VM", async () => {
    const opaqueKind = "CUSTOM.key+42/="
    vi.mocked(messagesDb.listByConversation).mockResolvedValueOnce([
      messageRow({
        id: "assistant-history-unknown",
        error: JSON.stringify({ kind: opaqueKind, message: "legacy" }),
      }),
    ])
    const { result } = renderHook(() => useChat(modelSelection))

    await act(async () => result.current.load("conv-1"))

    expect(result.current.vm[0].apiError).toEqual({ kind: "unknown", message: "" })
    expect(JSON.stringify(result.current.vm)).not.toContain(opaqueKind)
  })

  it("restaure l'erreur générique V7 d'un assistant historique vide", async () => {
    vi.mocked(messagesDb.listByConversation).mockResolvedValueOnce([
      messageRow({
        id: "assistant-history-v7",
        content: "",
        error: JSON.stringify({ kind: "unknown", message: "" }),
      }),
    ])
    const { result } = renderHook(() => useChat(modelSelection))

    await act(async () => result.current.load("conv-1"))

    expect(result.current.vm[0].apiError).toEqual({ kind: "unknown", message: "" })
    expect(result.current.vm[0].interrupted).toBeUndefined()
  })

  it("préserve le warning Web au reload pour le même id seulement", async () => {
    vi.mocked(messagesDb.insert)
      .mockResolvedValueOnce("user-1")
      .mockResolvedValueOnce("assistant-1")
    runAssistantTurnMock.mockResolvedValueOnce({
      text: "Réponse Web",
      firstTokenMs: 2,
      totalMs: 15,
      sources: [],
      warning: "Web partiel",
    })
    const { result } = renderHook(() =>
      useChat(modelSelection, runtimeWithWeb()),
    )

    await act(async () => {
      await result.current.send("conv-1", "Question Web")
    })
    vi.mocked(messagesDb.listByConversation).mockResolvedValueOnce([
      messageRow({ id: "assistant-1", content: "Réponse Web" }),
      messageRow({ id: "assistant-2", content: "Autre réponse" }),
    ])

    await act(async () => result.current.load("conv-1"))

    expect(result.current.vm[0].webWarning).toBe("Web partiel")
    expect(result.current.vm[1].webWarning).toBeUndefined()
  })

  it("résout false SANS lever quand l'insert utilisateur échoue (message conservé côté input)", async () => {
    vi.mocked(messagesDb.insert).mockRejectedValueOnce(new Error("sqlite locked"))
    const { result } = renderHook(() => useChat(modelSelection))
    let outcome: boolean | undefined
    await act(async () => {
      outcome = await result.current.send("conv-1", "À sauver")
    })
    expect(outcome).toBe(false)
    // La bulle optimiste non-persistée est retirée : pas de doublon au renvoi
    expect(result.current.vm).toHaveLength(0)
    expect(result.current.busy).toBe(false)
  })

  it("continue le tour sans restaurer l'input quand touch échoue après l'insert user", async () => {
    vi.mocked(conversations.touch).mockRejectedValueOnce(new Error("touch failed"))
    const { result } = renderHook(() => useChat(modelSelection))
    let outcome: boolean | undefined

    await act(async () => {
      outcome = await result.current.send("conv-1", "Message persisté")
    })

    expect(outcome).toBe(true)
    expect(runTurnMock).toHaveBeenCalledTimes(1)
    const userInserts = vi.mocked(messagesDb.insert).mock.calls
      .filter(([row]) => row.role === "user")
    expect(userInserts).toHaveLength(1)
    expect(result.current.vm.filter((message) => message.role === "user")).toEqual([
      expect.objectContaining({ content: "Message persisté" }),
    ])
  })

  it("résout false sur les gardes (pas de modèle sélectionné / contenu vide)", async () => {
    const { result } = renderHook(() => useChat(null))
    let ok: boolean | undefined
    await act(async () => {
      ok = await result.current.send("conv-1", "Salut")
    })
    expect(ok).toBe(false)
    expect(runTurnMock).not.toHaveBeenCalled()
  })

  it("construit le prompt système depuis les réglages stockés et les connaissances activées", async () => {
    vi.mocked(conversationKnowledge.listOn).mockResolvedValueOnce([])
    vi.mocked(knowledge.listEnabled).mockResolvedValueOnce([
      { id: "k1", name: "HISE", content: "## HISE", enabled: 1, sort_order: 0, created_at: "x" },
    ])
    const { result } = renderHook(() => useChat(modelSelection))
    await act(async () => {
      await result.current.send("conv-1", "Salut")
    })
    const calls = systemPromptMock.mock.calls
    const arg = calls[calls.length - 1][0] as {
      general: string
      profile: string
      knowledge: { name: string; content: string }[]
    }
    expect(arg.general).toBe("GEN")
    expect(arg.profile).toBe("PROF")
    expect(arg.knowledge).toEqual([{ name: "HISE", content: "## HISE" }])
  })

  it("matérialise une erreur de chargement du prompt après l'insert user", async () => {
    vi.mocked(loadPromptSettings).mockRejectedValueOnce(new Error("prompt failed"))
    const { result } = renderHook(() => useChat(modelSelection))

    await act(async () => {
      expect(await result.current.send("conv-1", "Salut")).toBe(true)
    })

    expect(runTurnMock).not.toHaveBeenCalled()
    expect(messagesDb.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        role: "assistant",
        error: JSON.stringify({ kind: "unknown", message: "prompt failed" }),
      }),
    )
    expect(result.current.vm[result.current.vm.length - 1].apiError).toEqual({
      kind: "unknown",
      message: "prompt failed",
    })
  })

  it("matérialise une erreur de lecture du secret après l'insert user", async () => {
    vi.mocked(secrets.get).mockRejectedValueOnce(new Error("secret lookup failed"))
    const { result } = renderHook(() => useChat(modelSelection))

    await act(async () => {
      expect(await result.current.send("conv-1", "Salut")).toBe(true)
    })

    expect(runTurnMock).not.toHaveBeenCalled()
    expect(messagesDb.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        role: "assistant",
        error: JSON.stringify({ kind: "unknown", message: "secret lookup failed" }),
      }),
    )
    expect(result.current.vm[result.current.vm.length - 1].apiError).toEqual({
      kind: "unknown",
      message: "secret lookup failed",
    })
  })

  it("maintient busy jusqu'à la persistance assistant", async () => {
    let resolveAssistantInsert: ((id: string) => void) | undefined
    vi.mocked(messagesDb.insert)
      .mockResolvedValueOnce("user-1")
      .mockImplementationOnce(() => new Promise((resolve) => {
        resolveAssistantInsert = resolve
      }))
    const { result } = renderHook(() => useChat(modelSelection))
    let sendPromise: Promise<boolean>

    act(() => {
      sendPromise = result.current.send("conv-1", "Salut")
    })
    await vi.waitFor(() => expect(resolveAssistantInsert).toBeDefined())
    expect(result.current.busy).toBe(true)

    await act(async () => {
      resolveAssistantInsert?.("assistant-1")
      await sendPromise!
    })
    expect(result.current.busy).toBe(false)
  })

  it("refuse synchroniquement un second send puis libère le verrou", async () => {
    let resolveFirstTurn: ((value: {
      text: string
      toolCalls: never[]
      firstTokenMs: number
      totalMs: number
      usage: { inputTokens: number; outputTokens: number }
    }) => void) | undefined
    runTurnMock.mockImplementationOnce(() => new Promise((resolve) => {
      resolveFirstTurn = resolve
    }))
    const { result } = renderHook(() => useChat(modelSelection))
    let firstSend: Promise<boolean>
    let secondSend: Promise<boolean>

    act(() => {
      firstSend = result.current.send("conv-1", "Premier")
      secondSend = result.current.send("conv-1", "Second")
    })

    await expect(secondSend!).resolves.toBe(false)
    await vi.waitFor(() => expect(resolveFirstTurn).toBeDefined())
    expect(vi.mocked(messagesDb.insert).mock.calls.filter(([row]) => row.role === "user"))
      .toHaveLength(1)
    expect(runTurnMock).toHaveBeenCalledTimes(1)

    await act(async () => {
      resolveFirstTurn?.({
        text: "Première réponse",
        toolCalls: [],
        firstTokenMs: 5,
        totalMs: 10,
        usage: { inputTokens: 1, outputTokens: 1 },
      })
      expect(await firstSend!).toBe(true)
    })

    await act(async () => {
      expect(await result.current.send("conv-1", "Troisième")).toBe(true)
    })
    expect(runTurnMock).toHaveBeenCalledTimes(2)
    expect(vi.mocked(messagesDb.insert).mock.calls.filter(([row]) => row.role === "user"))
      .toHaveLength(2)
  })

  it("résout true et persiste l'erreur quand runTurn rejette après l'insert user", async () => {
    runTurnMock.mockRejectedValueOnce({ kind: "network", message: "fail" })
    const { result } = renderHook(() => useChat(modelSelection))

    await act(async () => {
      expect(await result.current.send("conv-1", "Salut")).toBe(true)
    })

    expect(messagesDb.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        role: "assistant",
        content: "",
        error: JSON.stringify({ kind: "network", message: "fail" }),
      }),
    )
  })

  it("rabats un kind runtime inconnu avant la VM et la persistance", async () => {
    const opaqueKind = "CUSTOM.key+42/="
    runTurnMock.mockRejectedValueOnce({ kind: opaqueKind, message: "provider failure" })
    const { result } = renderHook(() => useChat(modelSelection))

    await act(async () => {
      expect(await result.current.send("conv-1", "Salut")).toBe(true)
    })

    const serializedVm = JSON.stringify(result.current.vm)
    const serializedInserts = JSON.stringify(vi.mocked(messagesDb.insert).mock.calls)
    expect(serializedVm).not.toContain(opaqueKind)
    expect(serializedInserts).not.toContain(opaqueKind)
    expect(result.current.vm[result.current.vm.length - 1]?.apiError)
      .toMatchObject({ kind: "unknown" })
    expect(messagesDb.insert).toHaveBeenCalledWith(expect.objectContaining({
      role: "assistant",
      error: JSON.stringify({ kind: "unknown", message: "provider failure" }),
    }))
  })

  it("redacte message et détail fournisseur avant VM et persistance", async () => {
    runTurnMock.mockRejectedValueOnce({
      kind: "auth",
      message: "Bearer sk-secret-value",
      detail: "Authorization: abc123",
    })
    const { result } = renderHook(() => useChat(modelSelection))

    await act(async () => {
      expect(await result.current.send("conv-1", "Salut")).toBe(true)
    })

    const errorInsert = vi.mocked(messagesDb.insert).mock.calls
      .map(([row]) => row)
      .find((row) => row.role === "assistant" && row.error !== null)
    expect(errorInsert?.error).toBe(JSON.stringify({
      kind: "auth",
      message: "Bearer [REDACTED]",
      detail: "Authorization: [REDACTED]",
    }))
    expect(JSON.stringify(result.current.vm)).not.toContain("sk-secret-value")
    expect(JSON.stringify(result.current.vm)).not.toContain("abc123")
  })

  it("redacte exactement la clé active dans la VM, SQLite et les logs", async () => {
    const opaqueKey = "CUSTOM.key+42/="
    vi.mocked(secrets.get).mockResolvedValueOnce(opaqueKey)
    runTurnMock.mockRejectedValueOnce({
      kind: "auth",
      message: `Credential ${opaqueKey} was rejected`,
      detail: `The supplied value ${opaqueKey} is invalid`,
    })
    vi.mocked(messagesDb.insert)
      .mockResolvedValueOnce("user-1")
      .mockRejectedValueOnce(new Error(`Persistence rejected credential ${opaqueKey}`))
    const { result } = renderHook(() => useChat(modelSelection))

    await act(async () => {
      expect(await result.current.send("conv-1", "Salut")).toBe(true)
    })

    const serializedVm = JSON.stringify(result.current.vm)
    const serializedInserts = JSON.stringify(vi.mocked(messagesDb.insert).mock.calls)
    const serializedLogs = JSON.stringify(loggerErrorMock.mock.calls)
    for (const sink of [serializedVm, serializedInserts, serializedLogs]) {
      expect(sink).not.toContain(opaqueKey)
    }
    expect(serializedInserts).toContain("[REDACTED]")
    expect(serializedLogs).toContain("[REDACTED]")
  })

  it("persiste une erreur si l'insert de la réponse finale échoue", async () => {
    const opaqueKey = "CUSTOM.persistence-key+42/="
    vi.mocked(secrets.get).mockResolvedValueOnce(opaqueKey)
    vi.mocked(messagesDb.insert)
      .mockResolvedValueOnce("user-1")
      .mockRejectedValueOnce(new Error(
        `SQLITE_IOERR at C:\\private\\logassist.db with ${opaqueKey}`,
      ))
      .mockResolvedValueOnce("error-1")
    const { result } = renderHook(() => useChat(modelSelection))

    await act(async () => {
      expect(await result.current.send("conv-1", "Salut")).toBe(true)
    })

    expect(messagesDb.insert).toHaveBeenCalledTimes(3)
    expect(messagesDb.insert).toHaveBeenLastCalledWith(
      expect.objectContaining({
        role: "assistant",
        error: JSON.stringify({
          kind: "persistence",
          message: "La réponse n'a pas pu être enregistrée.",
        }),
      }),
    )
    expect(result.current.vm[result.current.vm.length - 1].apiError).toEqual({
      kind: "persistence",
      message: "La réponse n'a pas pu être enregistrée.",
    })
    const serializedInserts = JSON.stringify(vi.mocked(messagesDb.insert).mock.calls)
    expect(serializedInserts).not.toContain("SQLITE_IOERR")
    expect(serializedInserts).not.toContain("logassist.db")
    expect(serializedInserts).not.toContain(opaqueKey)
    const serializedLogs = JSON.stringify(loggerErrorMock.mock.calls)
    expect(serializedLogs).toContain("[REDACTED]")
    expect(serializedLogs).not.toContain(opaqueKey)
    expect(result.current.busy).toBe(false)
  })

  it("conserve une erreur VM non sensible si les deux inserts assistant échouent", async () => {
    vi.mocked(messagesDb.insert)
      .mockResolvedValueOnce("user-1")
      .mockRejectedValueOnce(new Error("Bearer sk-final-secret"))
      .mockRejectedValueOnce(new Error("Authorization: second-secret"))
    const { result } = renderHook(() => useChat(modelSelection))

    await act(async () => {
      expect(await result.current.send("conv-1", "Salut")).toBe(true)
    })

    expect(messagesDb.insert).toHaveBeenCalledTimes(3)
    expect(result.current.vm[result.current.vm.length - 1].apiError?.message)
      .toContain("pas pu être enregistrée")
    expect(result.current.vm[result.current.vm.length - 1].apiError?.kind)
      .toBe("persistence")
    expect(result.current.busy).toBe(false)
    const logged = JSON.stringify(loggerErrorMock.mock.calls)
    expect(logged).toContain("[REDACTED]")
    expect(logged).not.toContain("sk-final-secret")
    expect(logged).not.toContain("second-secret")

    const transient = result.current.vm[result.current.vm.length - 1]
    expect(transient).toMatchObject({
      conversationId: "conv-1",
      persistenceFailed: true,
      content: "Réponse",
    })
    vi.mocked(messagesDb.listByConversation).mockResolvedValueOnce([
      messageRow({ id: "user-1", role: "user", content: "Salut" }),
    ])

    await act(async () => result.current.load("conv-1"))

    expect(result.current.vm).toHaveLength(2)
    expect(result.current.vm[0]).toMatchObject({ id: "user-1", role: "user" })
    expect(result.current.vm[1]).toMatchObject({
      id: transient.id,
      role: "assistant",
      conversationId: "conv-1",
      persistenceFailed: true,
    })

    vi.mocked(messagesDb.listByConversation).mockResolvedValueOnce([
      messageRow({
        id: "user-2",
        conversation_id: "conv-2",
        role: "user",
        content: "Autre conversation",
      }),
    ])
    await act(async () => result.current.load("conv-2"))

    expect(result.current.vm).toHaveLength(1)
    expect(result.current.vm[0].id).toBe("user-2")
    expect(result.current.vm.some((message) => message.persistenceFailed)).toBe(false)
  })

  it("ne duplique pas un transient dont l'id existe au reload", async () => {
    vi.mocked(messagesDb.insert)
      .mockResolvedValueOnce("user-1")
      .mockRejectedValueOnce(new Error("assistant insert failed"))
      .mockRejectedValueOnce(new Error("error insert failed"))
    const { result } = renderHook(() => useChat(modelSelection))

    await act(async () => {
      await result.current.send("conv-1", "Salut")
    })
    const transient = result.current.vm[result.current.vm.length - 1]
    expect(transient.persistenceFailed).toBe(true)
    const transientId = transient.id
    vi.mocked(messagesDb.listByConversation).mockResolvedValueOnce([
      messageRow({ id: transientId, content: "Ligne désormais persistée" }),
    ])

    await act(async () => result.current.load("conv-1"))

    expect(result.current.vm.filter((message) => message.id === transientId)).toHaveLength(1)
    expect(result.current.vm[0].persistenceFailed).toBeUndefined()
  })

  it("persiste l'accumulé comme interruption quand le tour direct lève AbortError", async () => {
    runTurnMock.mockImplementationOnce(async (_request, _apiKey, _modelId, _options, callbacks) => {
      callbacks.onDelta?.("Début de réponse")
      throw new DOMException("aborted", "AbortError")
    })
    const { result } = renderHook(() => useChat(modelSelection))

    await act(async () => {
      expect(await result.current.send("conv-1", "Salut")).toBe(true)
    })

    expect(messagesDb.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        role: "assistant",
        content: "Début de réponse",
        error: JSON.stringify({ interrupted: true }),
      }),
    )
    expect(result.current.vm[result.current.vm.length - 1]).toMatchObject({
      content: "Début de réponse",
      interrupted: true,
    })
  })

  it("injecte les pièces jointes texte dans le contenu user (persisté + API)", async () => {
    // L'API reçoit l'historique RECHARGÉ depuis la DB (pas un objet local) :
    // le mock de listByConversation renvoie donc ce qui vient d'être inséré.
    let insertedUser: Record<string, unknown> | null = null
    vi.mocked(messagesDb.insert).mockImplementation(async (row) => {
      if ((row as { role: string }).role === "user") insertedUser = { ...row, id: "u1" }
      return insertedUser ? "row-1" : "row-1"
    })
    vi.mocked(messagesDb.listByConversation).mockImplementation(async () =>
      insertedUser ? [insertedUser as unknown as MessageRow] : [],
    )
    const file: Attachment = {
      id: "t1", kind: "text", base64: "", mimeType: "text/markdown", name: "HISE.md", text: "## Mode d'emploi",
    }
    const { result } = renderHook(() => useChat(modelSelection))
    await act(async () => {
      await result.current.send("conv-1", "Aide-moi", [file])
    })
    const persisted = (insertedUser as unknown as { content: string }).content
    expect(persisted).toContain("Aide-moi")
    expect(persisted).toContain("[Fichier joint : HISE.md]")
    expect(persisted).toContain("```")
    expect(persisted).toContain("## Mode d'emploi")
    // Même contenu de l'autre côté du stable : le modèle reçoit le fichier
    const apiReq = runTurnMock.mock.calls[0][0] as { messages: { role: string; content: string }[] }
    expect(apiReq.messages[apiReq.messages.length - 1].content).toBe(persisted)
  })

  it("une pièce jointe image part en images API sans bloc texte dans le contenu", async () => {
    let insertedUser: Record<string, unknown> | null = null
    vi.mocked(messagesDb.insert).mockImplementation(async (row) => {
      if ((row as { role: string }).role === "user") insertedUser = { ...row, id: "u1" }
      return "row-1"
    })
    vi.mocked(messagesDb.listByConversation).mockImplementation(async () =>
      insertedUser ? [insertedUser as unknown as MessageRow] : [],
    )
    const img: Attachment = { id: "i1", kind: "image", base64: "AAAA", mimeType: "image/png", name: "shot.png" }
    const { result } = renderHook(() => useChat(modelSelection))
    await act(async () => {
      await result.current.send("conv-1", "Voilà l'écran", [img])
    })
    const persisted = (insertedUser as unknown as { content: string }).content
    expect(persisted).not.toContain("[Fichier")
    const apiReq = runTurnMock.mock.calls[0][0] as { messages: { role: string; content: string; images?: unknown[] }[] }
    const lastMsg = apiReq.messages[apiReq.messages.length - 1]
    expect(lastMsg.images).toEqual([{ base64: "AAAA", mimeType: "image/png" }])
  })
})

describe("useChat — récupération de la dernière réponse", () => {
  const userRow = messageRow({
    id: "user-1",
    role: "user",
    content: "Question d'origine",
  })
  const failedRow = messageRow({
    id: "assistant-error",
    role: "assistant",
    content: "",
    error: JSON.stringify({ kind: "network", message: "Échec" }),
  })
  const answeredRow = messageRow({
    id: "assistant-ok",
    role: "assistant",
    content: "Ancienne réponse",
  })

  it("retente la dernière erreur sans insérer un nouveau message utilisateur", async () => {
    vi.mocked(messagesDb.listByConversation).mockResolvedValue([userRow, failedRow])
    const { result } = renderHook(() => useChat(modelSelection))
    await act(async () => result.current.load("conv-1"))

    await act(async () => {
      expect(await result.current.retryLast("conv-1", failedRow.id)).toBe(true)
    })

    expect(messagesDb.insert).not.toHaveBeenCalled()
    expect(messagesDb.updateAssistant).toHaveBeenCalledWith(
      failedRow.id,
      expect.objectContaining({ content: "Réponse", error: null }),
    )
    expect(result.current.vm.find((message) => message.id === failedRow.id)).toMatchObject({
      content: "Réponse",
      apiError: undefined,
      recoveryMode: undefined,
      recoveryFailed: undefined,
    })
  })

  it("conserve l'ancienne réponse pendant la régénération puis la remplace", async () => {
    vi.mocked(messagesDb.listByConversation).mockResolvedValue([userRow, answeredRow])
    let finish: ((value: {
      text: string
      toolCalls: never[]
      firstTokenMs: number
      totalMs: number
      usage: { inputTokens: number; outputTokens: number }
    }) => void) | undefined
    runTurnMock.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve }))
    const { result } = renderHook(() => useChat(modelSelection))
    await act(async () => result.current.load("conv-1"))

    let recovery: Promise<boolean>
    act(() => {
      recovery = result.current.regenerateLast("conv-1", answeredRow.id)
    })
    await vi.waitFor(() => expect(finish).toBeDefined())
    expect(result.current.vm.find((message) => message.id === answeredRow.id)).toMatchObject({
      content: "Ancienne réponse",
      recoveryMode: "regenerate",
    })

    await act(async () => {
      finish?.({
        text: "Nouvelle réponse",
        toolCalls: [],
        firstTokenMs: 10,
        totalMs: 50,
        usage: { inputTokens: 20, outputTokens: 5 },
      })
      expect(await recovery!).toBe(true)
    })
    expect(result.current.vm.find((message) => message.id === answeredRow.id)).toMatchObject({
      content: "Nouvelle réponse",
      recoveryMode: undefined,
      recoveryFailed: undefined,
    })
  })

  it("conserve l'ancienne réponse si la régénération échoue", async () => {
    vi.mocked(messagesDb.listByConversation).mockResolvedValue([userRow, answeredRow])
    runTurnMock.mockRejectedValueOnce(new Error("provider down"))
    const { result } = renderHook(() => useChat(modelSelection))
    await act(async () => result.current.load("conv-1"))

    await act(async () => {
      expect(await result.current.regenerateLast("conv-1", answeredRow.id)).toBe(false)
    })

    expect(messagesDb.updateAssistant).not.toHaveBeenCalled()
    expect(result.current.vm.find((message) => message.id === answeredRow.id)).toMatchObject({
      content: "Ancienne réponse",
      recoveryMode: undefined,
      recoveryFailed: true,
    })

    await act(async () => result.current.load("conv-1"))
    expect(result.current.vm.find((message) => message.id === answeredRow.id)).toMatchObject({
      content: "Ancienne réponse",
      recoveryFailed: true,
    })
  })

  it("ne remplace pas l'ancienne réponse par un résultat vide", async () => {
    vi.mocked(messagesDb.listByConversation).mockResolvedValue([userRow, answeredRow])
    runTurnMock.mockResolvedValueOnce({
      text: "",
      toolCalls: [],
      firstTokenMs: 10,
      totalMs: 20,
    })
    const { result } = renderHook(() => useChat(modelSelection))
    await act(async () => result.current.load("conv-1"))

    await act(async () => {
      expect(await result.current.regenerateLast("conv-1", answeredRow.id)).toBe(false)
    })

    expect(messagesDb.updateAssistant).not.toHaveBeenCalled()
    expect(result.current.vm.find((message) => message.id === answeredRow.id)).toMatchObject({
      content: "Ancienne réponse",
      recoveryFailed: true,
    })
  })

  it("conserve l'ancienne réponse si sa mise à jour SQLite échoue", async () => {
    vi.mocked(messagesDb.listByConversation).mockResolvedValue([userRow, answeredRow])
    vi.mocked(messagesDb.updateAssistant).mockRejectedValueOnce(new Error("sqlite locked"))
    const { result } = renderHook(() => useChat(modelSelection))
    await act(async () => result.current.load("conv-1"))

    await act(async () => {
      expect(await result.current.regenerateLast("conv-1", answeredRow.id)).toBe(false)
    })

    expect(result.current.vm.find((message) => message.id === answeredRow.id)).toMatchObject({
      content: "Ancienne réponse",
      recoveryFailed: true,
    })
  })

  it("refuse une cible non finale sans appeler le fournisseur", async () => {
    const trailingUser = messageRow({ id: "user-2", role: "user", content: "Suite" })
    vi.mocked(messagesDb.listByConversation).mockResolvedValue([userRow, answeredRow, trailingUser])
    const { result } = renderHook(() => useChat(modelSelection))

    await act(async () => {
      expect(await result.current.regenerateLast("conv-1", answeredRow.id)).toBe(false)
    })

    expect(runTurnMock).not.toHaveBeenCalled()
    expect(messagesDb.updateAssistant).not.toHaveBeenCalled()
  })

  it("partage le verrou avec send pendant une régénération", async () => {
    vi.mocked(messagesDb.listByConversation).mockResolvedValue([userRow, answeredRow])
    let finish: ((value: {
      text: string
      toolCalls: never[]
      firstTokenMs: number
      totalMs: number
      usage: { inputTokens: number; outputTokens: number }
    }) => void) | undefined
    runTurnMock.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve }))
    const { result } = renderHook(() => useChat(modelSelection))

    let recovery: Promise<boolean>
    let concurrentSend: Promise<boolean>
    act(() => {
      recovery = result.current.regenerateLast("conv-1", answeredRow.id)
      concurrentSend = result.current.send("conv-1", "Nouveau message")
    })

    await expect(concurrentSend!).resolves.toBe(false)
    await vi.waitFor(() => expect(finish).toBeDefined())
    expect(messagesDb.insert).not.toHaveBeenCalled()

    await act(async () => {
      finish?.({
        text: "Nouvelle réponse",
        toolCalls: [],
        firstTokenMs: 10,
        totalMs: 50,
        usage: { inputTokens: 20, outputTokens: 5 },
      })
      expect(await recovery!).toBe(true)
    })
  })

  it("interrompt une régénération sans remplacer l'ancienne réponse", async () => {
    vi.mocked(messagesDb.listByConversation).mockResolvedValue([userRow, answeredRow])
    runTurnMock.mockImplementationOnce(async (_request, _key, _model, _options, _callbacks, signal) =>
      new Promise((_resolve, reject) => {
        signal.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")))
      }))
    const { result } = renderHook(() => useChat(modelSelection))
    await act(async () => result.current.load("conv-1"))

    let recovery: Promise<boolean>
    act(() => {
      recovery = result.current.regenerateLast("conv-1", answeredRow.id)
    })
    await vi.waitFor(() => expect(runTurnMock).toHaveBeenCalled())
    act(() => result.current.interrupt())

    await act(async () => expect(await recovery!).toBe(false))
    expect(messagesDb.updateAssistant).not.toHaveBeenCalled()
    expect(result.current.vm.find((message) => message.id === answeredRow.id)).toMatchObject({
      content: "Ancienne réponse",
      recoveryFailed: true,
    })
  })

  it("réutilise le Web automatique et remplace les sources après un retry", async () => {
    const sources = [{ url: "https://example.com", title: "Source", origin: "search" as const }]
    vi.mocked(messagesDb.listByConversation).mockResolvedValue([userRow, failedRow])
    runAssistantTurnMock.mockResolvedValueOnce({
      text: "Réponse Web",
      firstTokenMs: 12,
      totalMs: 80,
      sources,
    })
    const { result } = renderHook(() =>
      useChat(modelSelection, runtimeWithWeb()),
    )
    await act(async () => result.current.load("conv-1"))

    await act(async () => {
      expect(await result.current.retryLast("conv-1", failedRow.id)).toBe(true)
    })

    expect(resolveWebIntentMock).toHaveBeenCalledWith("Question d'origine", false)
    expect(runTurnMock).not.toHaveBeenCalled()
    expect(messagesDb.updateAssistant).toHaveBeenCalledWith(
      failedRow.id,
      expect.objectContaining({ content: "Réponse Web", sources: JSON.stringify(sources) }),
    )
  })
})

describe("useChat — outils MCP, approbation et annulation", () => {
  it("route un outil actif et expose l'approbation dans la bulle assistant", async () => {
    runAssistantTurnMock.mockImplementation(async (input) => {
      const decision = await input.tools.approve({ id: "c1", serverId: "db", serverName: "Database", toolName: "delete", arguments: { id: 7 } })
      expect(decision).toBe("allow")
      return assistantResult("Terminé")
    })
    const { result } = renderHook(() => useChat(modelSelection, runtimeWithTools()))
    let sending!: Promise<boolean>
    act(() => { sending = result.current.send("conv", "supprime", [], {}) })
    await waitFor(() => expect(result.current.vm[result.current.vm.length - 1]?.toolApproval?.toolName).toBe("delete"))
    act(() => result.current.allowTool())
    await expect(sending).resolves.toBe(true)
    expect(result.current.vm[result.current.vm.length - 1]?.toolApproval).toBeUndefined()
  })

  it("un refus poursuit le tour sans casser le contrat anti-perte", async () => {
    runAssistantTurnMock.mockImplementation(async (input) => {
      expect(await input.tools.approve({ id: "c1", serverId: "db", serverName: "Database", toolName: "delete", arguments: { id: 7 } })).toBe("deny")
      return assistantResult("Action refusée")
    })
    const { result } = renderHook(() => useChat(modelSelection, runtimeWithTools()))
    const sending = actSend(result.current)
    await waitFor(() => expect(result.current.pendingToolApproval).toBeTruthy())
    act(() => result.current.denyTool())
    await expect(sending).resolves.toBe(true)
  })

  it("interrupt résout l'attente et annule tout le turnId", async () => {
    runAssistantTurnMock.mockImplementation(async (input) => { await input.tools.approve({ id: "c1", serverId: "db", serverName: "Database", toolName: "delete", arguments: { id: 7 } }); throw new DOMException("aborted", "AbortError") })
    const { result } = renderHook(() => useChat(modelSelection, runtimeWithTools()))
    const sending = actSend(result.current)
    await waitFor(() => expect(result.current.pendingToolApproval).toBeTruthy())
    act(() => result.current.interrupt())
    await sending
    expect(mcpCancelTurnMock).toHaveBeenCalledWith(expect.any(String))
  })

  it("redemande l'approbation à chaque régénération", async () => {
    const answeredRow = messageRow({
      id: "assistant-ok",
      role: "assistant",
      content: "Ancienne réponse",
    })
    vi.mocked(messagesDb.listByConversation).mockResolvedValue([
      messageRow({ id: "user-1", role: "user", content: "Question d'origine" }),
      answeredRow,
    ])
    runAssistantTurnMock.mockImplementation(async (input) => {
      expect(await input.tools.approve({ id: "c1", serverId: "db", serverName: "Database", toolName: "delete", arguments: { id: 7 } })).toBe("allow")
      return assistantResult("Régénérée")
    })
    const { result } = renderHook(() => useChat(modelSelection, runtimeWithTools()))
    await act(async () => result.current.load("conv-1"))
    let first!: Promise<boolean>
    act(() => { first = result.current.regenerateLast("conv-1", answeredRow.id) })
    await waitFor(() => expect(result.current.pendingToolApproval).toBeTruthy())
    act(() => result.current.allowTool())
    await first
    let second!: Promise<boolean>
    act(() => { second = result.current.regenerateLast("conv-1", answeredRow.id) })
    await waitFor(() => expect(result.current.pendingToolApproval).toBeTruthy())
    expect(runAssistantTurnMock).toHaveBeenCalledTimes(2)
    act(() => result.current.allowTool())
    await second
  })
})
