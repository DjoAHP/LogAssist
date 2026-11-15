// @vitest-environment jsdom
import { renderHook } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { loadMcpRuntime } from "@/lib/mcp/runtime"

const mockLoadMcpRuntime = vi.hoisted(() => vi.fn())

vi.mock("@/lib/mcp/runtime", () => ({
  loadMcpRuntime: mockLoadMcpRuntime,
  EMPTY_CONNECTOR_RUNTIME: { github: { binding: null, configured: false } },
  EMPTY_MCP_RUNTIME: {
    servers: [],
    activeTools: [],
    authStatuses: {},
    webAccess: { enabled: false, configured: false },
    connectors: { github: { binding: null, configured: false } },
  },
  McpRuntimeSnapshot: {} as any,
}))

vi.mock("@/lib/logger", () => ({
  logger: { error: vi.fn() },
}))

import { useMcpRuntime } from "@/hooks/useMcpRuntime"
import { logger } from "@/lib/logger"

beforeEach(() => {
  vi.resetAllMocks()
  mockLoadMcpRuntime.mockResolvedValue({
    servers: [],
    activeTools: [],
    authStatuses: {},
    webAccess: { enabled: false, configured: false },
    connectors: { github: { binding: null, configured: false } },
  })
})

describe("useMcpRuntime", () => {
  it("mock works directly", async () => {
    mockLoadMcpRuntime.mockResolvedValueOnce({ test: true })
    const result = await loadMcpRuntime()
    expect(result).toEqual({ test: true })
  })

  it("initialise avec un snapshot vide et ready=false", () => {
    const { result } = renderHook(() => useMcpRuntime())

    expect(result.current.snapshot).toEqual({
      servers: [],
      activeTools: [],
      authStatuses: {},
      webAccess: { enabled: false, configured: false },
      connectors: { github: { binding: null, configured: false } },
    })
    expect(result.current.ready).toBe(false)
  })

  it("course (sequence) : deux refresh() séquentiels — seul le dernier met à jour snapshot", async () => {
    const initialSnapshot = {
      servers: [{ name: "initial" }],
      activeTools: [],
      authStatuses: {},
      webAccess: { enabled: false, configured: false },
      connectors: { github: { binding: null, configured: false } },
    }
    const firstSnapshot = {
      servers: [{ name: "first" }],
      activeTools: [],
      authStatuses: {},
      webAccess: { enabled: false, configured: false },
      connectors: { github: { binding: null, configured: false } },
    }
    const secondSnapshot = {
      servers: [{ name: "second" }],
      activeTools: [],
      authStatuses: {},
      webAccess: { enabled: false, configured: false },
      connectors: { github: { binding: null, configured: false } },
    }

    // Le refresh initial se résout immédiatement
    mockLoadMcpRuntime.mockResolvedValueOnce(initialSnapshot)

    const { result } = renderHook(() => useMcpRuntime())

    // Attendre que le refresh initial se termine
    await vi.waitFor(() => expect(result.current.ready).toBe(true))
    expect(result.current.snapshot).toEqual(initialSnapshot)

    // Maintenant configurer les deux prochains appels pour le test de course
    let resolveFirst: (v: typeof firstSnapshot) => void
    let resolveSecond: (v: typeof secondSnapshot) => void

    const firstPromise = new Promise<typeof firstSnapshot>((resolve) => {
      resolveFirst = resolve
    })
    const secondPromise = new Promise<typeof secondSnapshot>((resolve) => {
      resolveSecond = resolve
    })

    mockLoadMcpRuntime
      .mockResolvedValueOnce(firstPromise)
      .mockResolvedValueOnce(secondPromise)

    // Lancer deux refresh() séquentiels
    const refresh1 = result.current.refresh()
    const refresh2 = result.current.refresh()

    // Résoudre le second en premier (simule délai plus court)
    resolveSecond!(secondSnapshot)
    // Puis résoudre le premier
    resolveFirst!(firstSnapshot)

    await Promise.all([refresh1, refresh2])

    // Attendre que le state soit mis à jour (React batching)
    await vi.waitFor(() => expect(result.current.snapshot).toEqual(secondSnapshot))

    // Seul le second (dernier) doit avoir mis à jour le snapshot
    expect(result.current.snapshot).toEqual(secondSnapshot)
    expect(result.current.ready).toBe(true)
    expect(mockLoadMcpRuntime).toHaveBeenCalledTimes(3) // initial + 2 refresh
  })

  it("échec : loadMcpRuntime rejette — hook met EMPTY_MCP_RUNTIME, ready=true, appelle logger.error", async () => {
    const error = new Error("MCP load failed")
    mockLoadMcpRuntime.mockRejectedValueOnce(error)

    const { result } = renderHook(() => useMcpRuntime())

    // Attendre que le refresh initial se termine (avec erreur)
    await vi.waitFor(() => expect(result.current.ready).toBe(true))

    // Vérifier l'état final
    expect(result.current.snapshot).toEqual({
      servers: [],
      activeTools: [],
      authStatuses: {},
      webAccess: { enabled: false, configured: false },
      connectors: { github: { binding: null, configured: false } },
    })
    expect(result.current.ready).toBe(true)

    // Vérifier que logger.error a été appelé avec le bon contexte
    expect(logger.error).toHaveBeenCalledWith(
      expect.objectContaining({
        context: "mcp.runtime",
        message: "MCP load failed",
      })
    )
  })

  it("recharge le runtime avec la liaison GitHub fournie", async () => {
    const connectors = {
      github: {
        binding: { owner: "DjoAHP", name: "LogAssist", ref: "main" },
        configured: true,
      },
    }
    const snapshot = {
      servers: [],
      activeTools: [],
      authStatuses: {},
      webAccess: { enabled: false, configured: false },
      connectors,
    }
    mockLoadMcpRuntime.mockResolvedValueOnce(snapshot)

    const { result } = renderHook(() => useMcpRuntime(connectors))

    await vi.waitFor(() => expect(result.current.ready).toBe(true))
    expect(mockLoadMcpRuntime).toHaveBeenCalledWith(connectors)
    expect(result.current.snapshot).toEqual(snapshot)
  })

  it("retire immédiatement les outils de l’ancienne liaison pendant un changement", async () => {
    const connectorTool = {
      serverId: "connector_github",
      serverName: "GitHub",
      nativeName: "repo_map",
      llmName: "connector_github__repo_map",
      inputSchema: { type: "object" },
      approvalMode: "auto" as const,
      kind: "connector" as const,
    }
    const contextA = {
      github: {
        binding: { owner: "acme", name: "repo-a", ref: "main" },
        configured: true,
      },
    }
    const contextB = {
      github: {
        binding: { owner: "acme", name: "repo-b", ref: "main" },
        configured: true,
      },
    }
    mockLoadMcpRuntime.mockResolvedValueOnce({
      servers: [],
      activeTools: [connectorTool],
      authStatuses: {},
      webAccess: { enabled: false, configured: false },
      connectors: contextA,
    })
    let resolveSecond!: (value: unknown) => void
    mockLoadMcpRuntime.mockReturnValueOnce(new Promise((resolve) => {
      resolveSecond = resolve
    }))
    const { result, rerender } = renderHook(
      ({ connectors }) => useMcpRuntime(connectors),
      { initialProps: { connectors: contextA } },
    )
    await vi.waitFor(() => expect(result.current.ready).toBe(true))

    rerender({ connectors: contextB })
    expect(result.current.ready).toBe(false)
    expect(result.current.snapshot.activeTools).toEqual([])
    expect(result.current.snapshot.connectors).toEqual(contextB)

    resolveSecond({
      servers: [],
      activeTools: [connectorTool],
      authStatuses: {},
      webAccess: { enabled: false, configured: false },
      connectors: contextB,
    })
    await vi.waitFor(() => expect(result.current.ready).toBe(true))
  })
})
