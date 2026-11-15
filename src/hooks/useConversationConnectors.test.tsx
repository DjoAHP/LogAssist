// @vitest-environment jsdom
import { act, renderHook, waitFor } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"

const mockListAll = vi.hoisted(() => vi.fn())
const mockSet = vi.hoisted(() => vi.fn())
const mockRemove = vi.hoisted(() => vi.fn())

vi.mock("@/lib/db/conversationConnectors", () => ({
  conversationConnectors: {
    listAll: mockListAll,
    set: mockSet,
    remove: mockRemove,
  },
}))

import { useConversationConnectors } from "@/hooks/useConversationConnectors"

const githubBinding = {
  connectorId: "github",
  resourceOwner: "DjoAHP",
  resourceName: "LogAssist",
  resourceRef: "main",
  createdAt: "2026-11-15T10:00:00Z",
}

beforeEach(() => {
  vi.clearAllMocks()
  mockListAll.mockResolvedValue([githubBinding])
  mockSet.mockResolvedValue(undefined)
  mockRemove.mockResolvedValue(undefined)
})

describe("useConversationConnectors", () => {
  it("charge et indexe les liaisons de la conversation active", async () => {
    const { result } = renderHook(() => useConversationConnectors("conv-1"))

    await waitFor(() => expect(result.current.getBinding("github")).toEqual(githubBinding))
    expect(mockListAll).toHaveBeenCalledWith("conv-1")
  })

  it("attache puis recharge l’état canonique", async () => {
    const { result } = renderHook(() => useConversationConnectors("conv-1"))
    await waitFor(() => expect(result.current.getBinding("github")).toEqual(githubBinding))

    await act(async () => {
      await result.current.attach("github", {
        resourceOwner: "acme",
        resourceName: "console",
        resourceRef: "develop",
      })
    })

    expect(mockSet).toHaveBeenCalledWith("conv-1", "github", {
      resourceOwner: "acme",
      resourceName: "console",
      resourceRef: "develop",
    })
    expect(mockListAll).toHaveBeenCalledTimes(2)
  })

  it("détache puis recharge l’état canonique", async () => {
    const { result } = renderHook(() => useConversationConnectors("conv-1"))
    await waitFor(() => expect(result.current.getBinding("github")).toEqual(githubBinding))

    await act(async () => {
      await result.current.detach("github")
    })

    expect(mockRemove).toHaveBeenCalledWith("conv-1", "github")
    expect(mockListAll).toHaveBeenCalledTimes(2)
  })

  it("ne touche pas SQLite sans conversation active", async () => {
    const { result } = renderHook(() => useConversationConnectors(null))

    await act(async () => {
      await result.current.attach("github", {
        resourceOwner: "acme",
        resourceName: "console",
        resourceRef: null,
      })
      await result.current.detach("github")
    })

    expect(mockListAll).not.toHaveBeenCalled()
    expect(mockSet).not.toHaveBeenCalled()
    expect(mockRemove).not.toHaveBeenCalled()
  })

  it("masque immédiatement la liaison précédente au changement de conversation", async () => {
    let resolveSecond!: (value: (typeof githubBinding)[]) => void
    mockListAll
      .mockResolvedValueOnce([githubBinding])
      .mockReturnValueOnce(new Promise((resolve) => {
        resolveSecond = resolve
      }))
    const { result, rerender } = renderHook(
      ({ conversationId }) => useConversationConnectors(conversationId),
      { initialProps: { conversationId: "conv-1" as string | null } },
    )
    await waitFor(() => expect(result.current.getBinding("github")).toEqual(githubBinding))

    rerender({ conversationId: "conv-2" })
    expect(result.current.getBinding("github")).toBeUndefined()

    resolveSecond([])
    await waitFor(() => expect(result.current.loading).toBe(false))
  })

  it("ignore une lecture obsolète résolue après la conversation courante", async () => {
    let resolveFirst!: (value: (typeof githubBinding)[]) => void
    let resolveSecond!: (value: (typeof githubBinding)[]) => void
    mockListAll
      .mockReturnValueOnce(new Promise((resolve) => {
        resolveFirst = resolve
      }))
      .mockReturnValueOnce(new Promise((resolve) => {
        resolveSecond = resolve
      }))
    const bindingB = {
      ...githubBinding,
      resourceOwner: "acme",
      resourceName: "console",
    }
    const { result, rerender } = renderHook(
      ({ conversationId }) => useConversationConnectors(conversationId),
      { initialProps: { conversationId: "conv-1" as string | null } },
    )

    rerender({ conversationId: "conv-2" })
    resolveSecond([bindingB])
    await waitFor(() => expect(result.current.getBinding("github")).toEqual(bindingB))

    resolveFirst([githubBinding])
    await Promise.resolve()
    expect(result.current.getBinding("github")).toEqual(bindingB)
  })
})
