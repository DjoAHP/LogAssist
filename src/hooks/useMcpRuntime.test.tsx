// @vitest-environment jsdom
import { renderHook } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { loadMcpRuntime } from "@/lib/mcp/runtime"

const mockLoadMcpRuntime = vi.hoisted(() => vi.fn())

vi.mock("@/lib/mcp/runtime", () => ({
  loadMcpRuntime: mockLoadMcpRuntime,
  EMPTY_MCP_RUNTIME: {
    servers: [],
    activeTools: [],
    authStatuses: {},
    webAccess: { enabled: false, configured: false },
  },
  McpRuntimeSnapshot: {} as any,
}))

vi.mock("@/lib/logger", () => ({
  logger: { error: vi.fn() },
}))

import { useMcpRuntime } from "@/hooks/useMcpRuntime"

beforeEach(() => {
  vi.resetAllMocks()
  mockLoadMcpRuntime.mockResolvedValue({
    servers: [],
    activeTools: [],
    authStatuses: {},
    webAccess: { enabled: false, configured: false },
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
    })
    expect(result.current.ready).toBe(false)
  })
})