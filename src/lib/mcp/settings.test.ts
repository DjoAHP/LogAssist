import { beforeEach, describe, expect, it, vi } from "vitest"

const mockLoadMcpRuntime = vi.hoisted(() => vi.fn())
const mockSetEnabled = vi.hoisted(() => vi.fn())

vi.mock("@/lib/mcp/runtime", () => ({
  loadMcpRuntime: mockLoadMcpRuntime,
}))

vi.mock("@/lib/db/mcpServers", () => ({
  mcpServers: { setEnabled: mockSetEnabled },
}))

import { loadWebAccess, setWebEnabled } from "@/lib/mcp/settings"

beforeEach(() => {
  vi.clearAllMocks()
})

describe("réglage d'accès Web (SQLite V9)", () => {
  it("délègue à loadMcpRuntime", async () => {
    mockLoadMcpRuntime.mockResolvedValueOnce({
      servers: [],
      activeTools: [],
      authStatuses: {},
      webAccess: { enabled: false, configured: false },
    })

    await loadWebAccess()

    expect(mockLoadMcpRuntime).toHaveBeenCalledTimes(1)
  })

  it("retourne le webAccess du runtime", async () => {
    mockLoadMcpRuntime.mockResolvedValueOnce({
      servers: [],
      activeTools: [],
      authStatuses: {},
      webAccess: { enabled: true, configured: true },
    })

    await expect(loadWebAccess()).resolves.toEqual({ enabled: true, configured: true })
  })

  it("setWebEnabled active/désactive tinyfish via mcpServers", async () => {
    mockSetEnabled.mockResolvedValueOnce(undefined)

    await setWebEnabled(true)

    expect(mockSetEnabled).toHaveBeenCalledWith("tinyfish", true)

    mockSetEnabled.mockResolvedValueOnce(undefined)

    await setWebEnabled(false)

    expect(mockSetEnabled).toHaveBeenCalledWith("tinyfish", false)
  })
})