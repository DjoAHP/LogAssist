// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { renderHook, act, cleanup } from "@testing-library/react"
import { useChat } from "@/hooks/useChat"
import type { ProviderConfig } from "@/lib/ai/types"

const streamMock = vi.hoisted(() => vi.fn())

vi.mock("@/lib/db/messages", () => ({
  messages: { insert: vi.fn(), listByConversation: vi.fn(), updateError: vi.fn(), removeByConversation: vi.fn() },
}))
vi.mock("@/lib/db/images", () => ({ images: { create: vi.fn(), get: vi.fn(), remove: vi.fn() } }))
vi.mock("@/lib/db/conversations", () => ({ conversations: { touch: vi.fn(), create: vi.fn(), rename: vi.fn(), remove: vi.fn() } }))
vi.mock("@/lib/secrets/service", () => ({ secrets: { set: vi.fn(), get: vi.fn(), remove: vi.fn() } }))
vi.mock("@/lib/prompts/compose", () => ({ buildSystemPrompt: () => "" }))
vi.mock("@/lib/prompts/defaults", () => ({
  DEFAULT_GENERAL_INSTRUCTIONS: "",
  PROFILE_APPRENTISSAGE: "",
}))
vi.mock("@/lib/ai/factory", () => ({
  buildPreview: (p: string, m: string) => `${p} › ${m}`,
  createProvider: () => ({ stream: streamMock, complete: vi.fn(), testConnection: vi.fn() }),
}))

import { messages as messagesDb } from "@/lib/db/messages"
import { conversations } from "@/lib/db/conversations"
import { secrets } from "@/lib/secrets/service"

const provider = {
  name: "Test",
  apiFamily: "openai-compatible",
  baseUrl: "https://api.test/v1",
  secretRef: "ref",
} as unknown as ProviderConfig
const modelSelection = { provider, modelId: "m1", supportsImages: false }

beforeEach(() => {
  vi.mocked(messagesDb.insert).mockResolvedValue("row-1")
  vi.mocked(messagesDb.listByConversation).mockResolvedValue([])
  vi.mocked(conversations.touch).mockResolvedValue(undefined)
  vi.mocked(secrets.get).mockResolvedValue("sk-test")
  streamMock.mockResolvedValue(undefined)
})

afterEach(cleanup)

describe("useChat.send — contract anti-perte", () => {
  it("résout true quand l'utilisateur est persisté et le stream s'achève", async () => {
    const { result } = renderHook(() => useChat(modelSelection))
    await act(async () => {
      const ok = await result.current.send("conv-1", "Salut")
      expect(ok).toBe(true)
    })
    expect(messagesDb.insert).toHaveBeenCalled()
    expect(result.current.busy).toBe(false)
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

  it("résout false sur les gardes (pas de modèle sélectionné / contenu vide)", async () => {
    const { result } = renderHook(() => useChat(null))
    let ok: boolean | undefined
    await act(async () => {
      ok = await result.current.send("conv-1", "Salut")
    })
    expect(ok).toBe(false)
    expect(streamMock).not.toHaveBeenCalled()
  })
})
