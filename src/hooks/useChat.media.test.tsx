// @vitest-environment jsdom
import { describe, expect, it, vi, beforeEach } from "vitest"
import type { AssistantTurnResult } from "@/lib/chat/turnRunner"
import type { MessageRow } from "@/lib/db/messages"

// --- mocks autonomes : chaque module lourd est factice ---
const mockMessagesDb = vi.hoisted(() => ({
  listByConversation: vi.fn(),
  insert: vi.fn(),
  updateAssistant: vi.fn(),
  updateError: vi.fn(),
  removeByConversation: vi.fn(),
  setMediaRefs: vi.fn(),
}))
const mockMessageMediaDb = vi.hoisted(() => ({
  insertRows: vi.fn(),
  listByMessageIds: vi.fn(),
  listByIds: vi.fn(),
  removeByMessageIds: vi.fn(),
}))
const mockRunAssistantTurn = vi.hoisted(() => vi.fn())

vi.mock("@/lib/db/messages", () => ({ messages: mockMessagesDb }))
vi.mock("@/lib/db/messageMedia", () => ({ messageMedia: mockMessageMediaDb }))
vi.mock("@/lib/db/images", () => ({ images: { create: vi.fn(), get: vi.fn(), remove: vi.fn() } }))
vi.mock("@/lib/db/conversations", () => ({ conversations: { touch: vi.fn(), create: vi.fn(), rename: vi.fn(), remove: vi.fn() } }))
vi.mock("@/lib/db/knowledge", () => ({ knowledge: { listEnabled: vi.fn(), list: vi.fn() } }))
vi.mock("@/lib/db/conversationKnowledge", () => ({ conversationKnowledge: { listOn: vi.fn() } }))
vi.mock("@/lib/secrets/service", () => ({ secrets: { set: vi.fn(), get: vi.fn(), remove: vi.fn() } }))
vi.mock("@/lib/prompts/compose", () => ({ buildSystemPrompt: vi.fn() }))
vi.mock("@/lib/prompts/store", () => ({ loadPromptSettings: vi.fn() }))
vi.mock("@/lib/ai/factory", () => ({
  buildPreview: (p: string, m: string) => `${p} › ${m}`,
  createProvider: vi.fn(() => ({ runTurn: vi.fn(), stream: vi.fn(), complete: vi.fn(), testConnection: vi.fn() })),
}))
vi.mock("@/lib/token", () => ({
  estimateTurnMetrics: vi.fn(() => null),
  metricsFromProviderUsage: vi.fn(() => null),
  resolvePricingProvider: vi.fn(() => ""),
}))
vi.mock("@/lib/mcp/webIntent", () => ({ resolveWebIntent: vi.fn(() => "auto") }))
vi.mock("@/lib/mcp/client", () => ({ mcp: { callTool: vi.fn(), cancelTurn: vi.fn() } }))
vi.mock("@/lib/logger", () => ({ logger: { debug: vi.fn(), error: vi.fn() } }))
vi.mock("@/lib/chat/turnRunner", () => ({ runAssistantTurn: mockRunAssistantTurn }))

import { useChat } from "@/hooks/useChat"
import { renderHook, act } from "@testing-library/react"
import { conversations } from "@/lib/db/conversations"
import { knowledge } from "@/lib/db/knowledge"
import { conversationKnowledge } from "@/lib/db/conversationKnowledge"
import { secrets } from "@/lib/secrets/service"
import { loadPromptSettings } from "@/lib/prompts/store"
import { buildSystemPrompt } from "@/lib/prompts/compose"

const MODEL = {
  provider: { id: "p1", name: "Provider", secretRef: "ref" } as never,
  modelId: "m",
  supportsImages: true,
}

const MEDIA = [
  { type: "image" as const, mimeType: "image/png", base64: "AAEB", toolLabel: "Cloudflare · generate_image" },
]

function mediaTurn(): AssistantTurnResult {
  return { text: "Voilà votre image.", firstTokenMs: 5, totalMs: 20, sources: [], media: MEDIA }
}

function blankRow(overrides: Partial<MessageRow>): MessageRow {
  return {
    id: "msg",
    conversation_id: "conv-1",
    role: "assistant",
    content: "",
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
  mockRunAssistantTurn.mockReset()
  mockMessagesDb.listByConversation.mockResolvedValue([])
  mockMessagesDb.insert.mockResolvedValue("msg-1")
  mockMessagesDb.setMediaRefs.mockResolvedValue(undefined)
  mockMessagesDb.updateAssistant.mockResolvedValue(undefined)
  mockMessageMediaDb.insertRows.mockResolvedValue(undefined)
  mockMessageMediaDb.listByMessageIds.mockResolvedValue([])
  mockMessageMediaDb.listByIds.mockResolvedValue([])
  mockMessageMediaDb.removeByMessageIds.mockResolvedValue(undefined)
  // Les modules annexes doivent retourner des promesses complètes (cf. le
  // pattern du test principal useChat.test.tsx : sans cela, undefined.catch /
  // undefined.length cassent le tour).
  vi.mocked(conversations.touch).mockResolvedValue(undefined)
  vi.mocked(knowledge.listEnabled).mockResolvedValue([])
  vi.mocked(knowledge.list).mockResolvedValue([])
  vi.mocked(conversationKnowledge.listOn).mockResolvedValue([])
  vi.mocked(secrets.get).mockResolvedValue("KEY")
  vi.mocked(loadPromptSettings).mockResolvedValue({ general: "", profile: "" })
  // Le contexte API (module réel) appelle system.trim() : le mock doit
  // retourner une chaîne, jamais undefined.
  vi.mocked(buildSystemPrompt).mockReturnValue("")
})

describe("useChat — persistance des médias MCP", () => {
  it("persiste les médias puis pose les refs sur le message assistant", async () => {
    mockRunAssistantTurn.mockResolvedValue(mediaTurn())
    const { result } = renderHook(() => useChat(MODEL))

    let outcome = false
    await act(async () => {
      outcome = await result.current.send("conv-1", "génère une image")
    })

    expect(outcome).toBe(true)
    expect(mockMessageMediaDb.insertRows).toHaveBeenCalledWith([
      expect.objectContaining({
        message_id: "msg-1",
        kind: "image",
        mime_type: "image/png",
        base64: "AAEB",
        tool_label: "Cloudflare · generate_image",
      }),
    ])
    const refsArg = mockMessagesDb.setMediaRefs.mock.calls[0]?.[1] as string | undefined
    expect(typeof refsArg).toBe("string")
    expect(typeof JSON.parse(refsArg as string)).toBe("object")
    expect(JSON.parse(refsArg as string)).toHaveLength(1)

    // VM : le média est porté par le champ typé, pas dans content.
    const last = result.current.vm[result.current.vm.length - 1]!
    expect(last.media).toHaveLength(1)
    expect(last.media![0]).toMatchObject({ type: "image", mimeType: "image/png", base64: "AAEB" })
    expect(last.content).toBe("Voilà votre image.")
  })

  it("conserve la réponse et pose une note si l'insert média échoue", async () => {
    mockRunAssistantTurn.mockResolvedValue(mediaTurn())
    mockMessageMediaDb.insertRows.mockRejectedValue(new Error("sqlite readonly"))
    const { result } = renderHook(() => useChat(MODEL))

    let outcome = false
    await act(async () => {
      outcome = await result.current.send("conv-1", "génère une image")
    })

    expect(outcome).toBe(true)
    const last = result.current.vm[result.current.vm.length - 1]!
    expect(last.content).toBe("Voilà votre image.")
    expect(last.media).toEqual([])
    expect(last.webWarning).toContain("média")
  })

  it("hydrate les médias depuis la DB au chargement de la conversation", async () => {
    mockMessagesDb.listByConversation.mockResolvedValue([
      blankRow({ id: "msg-1", content: "Voilà votre image.", media: '["media-1"]' }),
    ])
    mockMessageMediaDb.listByIds.mockResolvedValue([
      {
        id: "media-1", message_id: "msg-1", kind: "image", mime_type: "image/png",
        tool_label: "Cloudflare · generate_image", base64: "AAEB",
        created_at: "2026-11-10 00:00:00",
      },
    ])
    const { result } = renderHook(() => useChat(MODEL))

    await act(async () => {
      await result.current.load("conv-1")
    })

    // Les refs sont des IDS de médias : la requête doit cibler la colonne id,
    // pas message_id (régression du flash média corrigée).
    expect(mockMessageMediaDb.listByIds).toHaveBeenCalledWith(["media-1"])
    const last = result.current.vm[result.current.vm.length - 1]!
    expect(last.media![0]).toEqual({
      id: "media-1",
      type: "image",
      mimeType: "image/png",
      base64: "AAEB",
      toolLabel: "Cloudflare · generate_image",
    })
  })

  it("nettoie les médias lors d'un regenerate avant réécriture", async () => {
    mockRunAssistantTurn.mockResolvedValue(mediaTurn())
    mockMessagesDb.listByConversation.mockResolvedValue([
      blankRow({ id: "user-1", role: "user", content: "génère" }),
      blankRow({ id: "assistant-1", content: "ancienne", media: '["old"]' }),
    ])
    const { result } = renderHook(() => useChat(MODEL))

    let ok = false
    await act(async () => {
      await result.current.load("conv-1")
      ok = await result.current.regenerateLast("conv-1", "assistant-1")
    })

    expect(ok).toBe(true)
    expect(mockMessageMediaDb.removeByMessageIds).toHaveBeenCalledWith(["assistant-1"])
    expect(mockMessageMediaDb.insertRows).toHaveBeenCalled()
    expect(mockMessagesDb.setMediaRefs).toHaveBeenCalledWith("assistant-1", expect.any(String))
  })
})
