// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { renderHook, act, cleanup } from "@testing-library/react"
import { useChat, type Attachment } from "@/hooks/useChat"
import type { MessageRow } from "@/lib/db/messages"
import type { ProviderConfig } from "@/lib/ai/types"

const streamMock = vi.hoisted(() => vi.fn())
const systemPromptMock = vi.hoisted(() => vi.fn())

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
vi.mock("@/lib/db/knowledge", () => ({ knowledge: { listEnabled: vi.fn().mockResolvedValue([]) } }))
vi.mock("@/lib/ai/factory", () => ({
  buildPreview: (p: string, m: string) => `${p} › ${m}`,
  createProvider: () => ({ stream: streamMock, complete: vi.fn(), testConnection: vi.fn() }),
}))

import { messages as messagesDb } from "@/lib/db/messages"
import { conversations } from "@/lib/db/conversations"
import { secrets } from "@/lib/secrets/service"
import { knowledge } from "@/lib/db/knowledge"

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

  it("construit le prompt système depuis les réglages stockés et les connaissances activées", async () => {
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

  it("onDone/onError retournent leur promesse de persistance (le provider les await)", async () => {
    // Contrat du fix 85acc6b : StreamCallbacks.onDone/onError doivent
    // RETOURNER leur promesse d'insert pour que stream() se résolve APRÈS
    // committance → busy=false ne déclenche pas le refetch prématuré d'App.
    let captured: { onDelta?: (d: string) => void; onDone?: (p: { text: string; totalMs: number }) => unknown; onError?: (e: unknown) => unknown } | undefined
    streamMock.mockImplementationOnce(async (_req, _key, _id, cb) => {
      captured = cb
      return
    })
    const { result } = renderHook(() => useChat(modelSelection))
    await act(async () => {
      await result.current.send("conv-1", "Salut")
      expect(captured).toBeDefined()
      // Contrat 1 : onDone retourne une promesse dont le dénouement suit
      // l'insert assistant.
      const onDoneResult = captured!.onDone?.({ text: "réponse", totalMs: 5 })
      expect(onDoneResult).toBeInstanceOf(Promise)
      await onDoneResult
      expect(messagesDb.insert).toHaveBeenCalledWith(
        expect.objectContaining({ role: "assistant", content: "réponse" }),
      )
    })
  })

  it("onError retourne sa promesse de persistance d'erreur", async () => {    let captured: { onDelta?: (d: string) => void; onDone?: (p: { text: string; totalMs: number }) => unknown; onError?: (e: unknown) => unknown } | undefined
    streamMock.mockImplementationOnce(async (_req, _key, _id, cb) => {
      captured = cb
      return
    })
    const { result } = renderHook(() => useChat(modelSelection))
    await act(async () => {
      await result.current.send("conv-1", "Salut")
      expect(captured).toBeDefined()
      const onErrorResult = captured!.onError?.({ kind: "network", message: "fail" })
      expect(onErrorResult).toBeInstanceOf(Promise)
      await onErrorResult
      expect(messagesDb.insert).toHaveBeenCalledWith(
        expect.objectContaining({ content: "", error: JSON.stringify({ kind: "network", message: "fail" }) }),
      )
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
    const apiReq = streamMock.mock.calls[0][0] as { messages: { role: string; content: string }[] }
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
    const apiReq = streamMock.mock.calls[0][0] as { messages: { role: string; content: string; images?: unknown[] }[] }
    const lastMsg = apiReq.messages[apiReq.messages.length - 1]
    expect(lastMsg.images).toEqual([{ base64: "AAAA", mimeType: "image/png" }])
  })
})
