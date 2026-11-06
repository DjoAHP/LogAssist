// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { renderHook, act, cleanup } from "@testing-library/react"
import { useChat, type Attachment } from "@/hooks/useChat"
import type { MessageRow } from "@/lib/db/messages"
import type { ProviderConfig } from "@/lib/ai/types"

const runTurnMock = vi.hoisted(() => vi.fn())
const systemPromptMock = vi.hoisted(() => vi.fn())
const runWebAgentMock = vi.hoisted(() => vi.fn())
const resolveWebChoiceMock = vi.hoisted(() => vi.fn(() => "auto"))
const tinyfishCallMock = vi.hoisted(() => vi.fn())
const tinyfishCancelMock = vi.hoisted(() => vi.fn())
const loggerErrorMock = vi.hoisted(() => vi.fn())
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

vi.mock("@/lib/db/messages", () => ({
  messages: { insert: vi.fn(), listByConversation: vi.fn(), updateError: vi.fn(), removeByConversation: vi.fn() },
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
}))
vi.mock("@/lib/mcp/webAgent", () => ({ runWebAgent: runWebAgentMock }))
vi.mock("@/lib/mcp/webIntent", () => ({ resolveWebChoice: resolveWebChoiceMock }))
vi.mock("@/lib/mcp/client", () => ({
  tinyfish: { call: tinyfishCallMock, cancel: tinyfishCancelMock },
}))
vi.mock("@/lib/logger", () => ({
  logger: { debug: vi.fn(), error: loggerErrorMock },
}))

import { messages as messagesDb } from "@/lib/db/messages"
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
  resolveWebChoiceMock.mockReset()
  runWebAgentMock.mockReset()
  runTurnMock.mockReset()
  estimateTurnMetricsMock.mockReset()
  metricsFromProviderUsageMock.mockReset()
  tinyfishCallMock.mockReset()
  tinyfishCancelMock.mockReset()
  loggerErrorMock.mockReset()
  systemPromptMock.mockReturnValue("")
  resolveWebChoiceMock.mockReturnValue("auto")
  vi.mocked(messagesDb.insert).mockReset().mockResolvedValue("row-1")
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
      "Test",
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
    expect(runWebAgentMock).not.toHaveBeenCalled()
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
      "Test",
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

  it("utilise le Web après l'insert user et persiste uniquement les sources finales", async () => {
    const sources = [{ url: "https://example.com", title: "Doc", origin: "search" as const }]
    runWebAgentMock.mockResolvedValueOnce({
      text: "Réponse Web",
      firstTokenMs: 2,
      totalMs: 15,
      sources,
      warning: "Web partiel",
    })
    const { result } = renderHook(() =>
      useChat(modelSelection, { enabled: true, configured: true }),
    )

    let outcome: boolean | undefined
    await act(async () => {
      outcome = await result.current.send("conv-1", "Cherche ceci", [], { forceWeb: true })
    })

    expect(outcome).toBe(true)
    expect(runTurnMock).not.toHaveBeenCalled()
    expect(resolveWebChoiceMock).toHaveBeenCalledWith("Cherche ceci", true)
    expect(runWebAgentMock).toHaveBeenCalledTimes(1)
    expect(messagesDb.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        role: "assistant",
        content: "Réponse Web",
        sources: JSON.stringify(sources),
        first_token_ms: null,
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
    })
    expect(result.current.vm[result.current.vm.length - 1].firstTokenMs).toBeUndefined()
    expect(result.current.vm[result.current.vm.length - 1].inputTokens).toBeUndefined()
    const webInput = runWebAgentMock.mock.calls[0][0]
    expect(webInput.signal).toBeInstanceOf(AbortSignal)
    expect(webInput).toMatchObject({
      requestId: expect.any(String),
      compatibilityKey: "p1/m1",
      toolChoice: "auto",
    })
  })

  it("ne fabrique pas de métriques pour un usage Web invalide", async () => {
    metricsFromProviderUsageMock.mockReturnValueOnce(null)
    runWebAgentMock.mockResolvedValueOnce({
      text: "Réponse Web",
      firstTokenMs: 4,
      totalMs: 20,
      sources: [],
      usage: { inputTokens: -1, outputTokens: 2 },
    })
    const { result } = renderHook(() =>
      useChat(modelSelection, { enabled: true, configured: true }),
    )

    await act(async () => {
      expect(await result.current.send("conv-1", "Question Web")).toBe(true)
    })

    expect(metricsFromProviderUsageMock).toHaveBeenCalledTimes(1)
    expect(estimateTurnMetricsMock).not.toHaveBeenCalled()
    expect(messagesDb.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        role: "assistant",
        first_token_ms: null,
        input_tokens: null,
        output_tokens: null,
        usage_source: null,
        cost_microusd: null,
      }),
    )
  })

  it("retourne true et matérialise l'erreur si l'orchestration échoue après l'insert user", async () => {
    runWebAgentMock.mockRejectedValueOnce(new Error("MCP inattendu"))
    const { result } = renderHook(() =>
      useChat(modelSelection, { enabled: true, configured: true }),
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

  it("interrompt le LLM et l'appel MCP actif avec le même requestId", async () => {
    let activeRequestId = ""
    let rootSignal: AbortSignal | undefined
    let rejectMcp: ((reason: unknown) => void) | undefined
    runWebAgentMock.mockImplementationOnce(async (input) => {
      rootSignal = input.signal
      await input.webClient.call("mcp-active", {
        tool: "search",
        arguments: { query: "Tauri" },
      })
      return { text: "tardif", firstTokenMs: 0, totalMs: 1, sources: [] }
    })
    tinyfishCallMock.mockImplementationOnce((requestId: string, _request: unknown) => {
      activeRequestId = requestId
      return new Promise((_resolve, reject) => {
        rejectMcp = reject
      })
    })
    tinyfishCancelMock.mockImplementationOnce(async () => {
      rejectMcp?.(new DOMException("aborted", "AbortError"))
    })
    const { result } = renderHook(() =>
      useChat(modelSelection, { enabled: true, configured: true }),
    )
    let sendPromise: Promise<boolean>

    act(() => {
      sendPromise = result.current.send("conv-1", "Question")
    })
    await vi.waitFor(() => expect(activeRequestId).toBe("mcp-active"))

    act(() => result.current.interrupt())
    await act(async () => {
      expect(await sendPromise!).toBe(true)
    })

    expect(tinyfishCancelMock).toHaveBeenCalledWith("mcp-active")
    expect(rootSignal?.aborted).toBe(true)
    expect(messagesDb.insert).toHaveBeenCalledWith(
      expect.objectContaining({ error: JSON.stringify({ interrupted: true }) }),
    )
    expect(result.current.busy).toBe(false)
  })

  it("expose les statuts searching et fetching pendant l'orchestration", async () => {
    let capturedInput: { onStatus?: (status: "searching" | "fetching" | undefined) => void } | undefined
    let finish: ((value: unknown) => void) | undefined
    runWebAgentMock.mockImplementationOnce((input) => {
      capturedInput = input
      return new Promise((resolve) => {
        finish = resolve
      })
    })
    const { result } = renderHook(() =>
      useChat(modelSelection, { enabled: true, configured: true }),
    )
    let sendPromise: Promise<boolean>

    act(() => {
      sendPromise = result.current.send("conv-1", "Question")
    })
    await vi.waitFor(() => expect(capturedInput).toBeDefined())

    act(() => capturedInput?.onStatus?.("searching"))
    expect(result.current.vm[result.current.vm.length - 1].webStatus).toBe("searching")
    act(() => capturedInput?.onStatus?.("fetching"))
    expect(result.current.vm[result.current.vm.length - 1].webStatus).toBe("fetching")

    finish?.({ text: "Réponse", firstTokenMs: 1, totalMs: 2, sources: [] })
    await act(async () => await sendPromise!)
  })

  it("persiste une interruption Web après l'insert utilisateur", async () => {
    runWebAgentMock.mockRejectedValueOnce(new DOMException("aborted", "AbortError"))
    const { result } = renderHook(() =>
      useChat(modelSelection, { enabled: true, configured: true }),
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
    runWebAgentMock.mockRejectedValueOnce(new Error("Request cancelled"))
    const { result } = renderHook(() =>
      useChat(modelSelection, { enabled: true, configured: true }),
    )

    await act(async () => {
      expect(await result.current.send("conv-1", "Question")).toBe(true)
    })

    expect(messagesDb.insert).toHaveBeenCalledWith(
      expect.objectContaining({ error: JSON.stringify({ interrupted: true }) }),
    )
  })

  it("expose l'incompatibilité tools du modèle courant", async () => {
    runWebAgentMock.mockImplementationOnce(async (input) => {
      input.unsupportedTools.add(input.compatibilityKey)
      return { text: "Sans Web", firstTokenMs: 1, totalMs: 2, sources: [] }
    })
    const { result } = renderHook(() =>
      useChat(modelSelection, { enabled: true, configured: true }),
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
        first_token_ms: 18, input_tokens: 22, output_tokens: 9,
        usage_source: "provider", cost_microusd: 4,
      },
      {
        id: "a2", conversation_id: "conv-1", role: "assistant", content: "B",
        attachments: "[]", model_label: null, latency_ms: null, error: null,
        sources: "{cassé",
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

  it("redacte les erreurs historiques lors du chargement", async () => {
    vi.mocked(messagesDb.listByConversation).mockResolvedValueOnce([
      messageRow({
        id: "assistant-history",
        error: JSON.stringify({
          kind: "auth",
          message: "Authorization: old-secret",
          detail: "Bearer sk-history",
        }),
      }),
    ])
    const { result } = renderHook(() => useChat(modelSelection))

    await act(async () => result.current.load("conv-1"))

    expect(result.current.vm[0].apiError).toEqual({
      kind: "auth",
      message: "Authorization: [REDACTED]",
      detail: "Bearer [REDACTED]",
    })
    const serializedVm = JSON.stringify(result.current.vm)
    expect(serializedVm).not.toContain("old-secret")
    expect(serializedVm).not.toContain("sk-history")
  })

  it("préserve le warning Web au reload pour le même id seulement", async () => {
    vi.mocked(messagesDb.insert)
      .mockResolvedValueOnce("user-1")
      .mockResolvedValueOnce("assistant-1")
    runWebAgentMock.mockResolvedValueOnce({
      text: "Réponse Web",
      firstTokenMs: 2,
      totalMs: 15,
      sources: [],
      warning: "Web partiel",
    })
    const { result } = renderHook(() =>
      useChat(modelSelection, { enabled: true, configured: true }),
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

  it("persiste une erreur si l'insert de la réponse finale échoue", async () => {
    vi.mocked(messagesDb.insert)
      .mockResolvedValueOnce("user-1")
      .mockRejectedValueOnce(new Error("assistant insert failed"))
      .mockResolvedValueOnce("error-1")
    const { result } = renderHook(() => useChat(modelSelection))

    await act(async () => {
      expect(await result.current.send("conv-1", "Salut")).toBe(true)
    })

    expect(messagesDb.insert).toHaveBeenCalledTimes(3)
    expect(messagesDb.insert).toHaveBeenLastCalledWith(
      expect.objectContaining({
        role: "assistant",
        error: JSON.stringify({ kind: "unknown", message: "assistant insert failed" }),
      }),
    )
    expect(result.current.vm[result.current.vm.length - 1].apiError).toEqual({
      kind: "unknown",
      message: "assistant insert failed",
    })
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
