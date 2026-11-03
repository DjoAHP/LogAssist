import { beforeEach, describe, expect, it, vi } from "vitest"

const mockGet = vi.hoisted(() => vi.fn())
const mockSet = vi.hoisted(() => vi.fn())
const mockHasSecret = vi.hoisted(() => vi.fn())

vi.mock("@/lib/db/settings", () => ({
  settings: { get: mockGet, set: mockSet },
}))

vi.mock("@/lib/mcp/client", () => ({
  tinyfish: { hasSecret: mockHasSecret },
}))

import { loadWebAccess, setWebEnabled } from "@/lib/mcp/settings"

beforeEach(() => {
  vi.clearAllMocks()
})

describe("réglage d'accès Web", () => {
  it("est désactivé par défaut", async () => {
    mockGet.mockResolvedValueOnce(null)
    mockHasSecret.mockResolvedValueOnce(false)

    await expect(loadWebAccess()).resolves.toEqual({ enabled: false, configured: false })
    expect(mockGet).toHaveBeenCalledWith("web.enabled")
  })

  it("ne retourne jamais enabled=true sans clé configurée", async () => {
    mockGet.mockResolvedValueOnce("true")
    mockHasSecret.mockResolvedValueOnce(false)

    await expect(loadWebAccess()).resolves.toEqual({ enabled: false, configured: false })
  })

  it("restaure l'activation quand la clé existe", async () => {
    mockGet.mockResolvedValueOnce("true")
    mockHasSecret.mockResolvedValueOnce(true)

    await expect(loadWebAccess()).resolves.toEqual({ enabled: true, configured: true })
  })

  it("persiste uniquement le booléen d'activation", async () => {
    mockSet.mockResolvedValueOnce(undefined)

    await setWebEnabled(true)

    expect(mockSet).toHaveBeenCalledWith("web.enabled", "true")
  })
})
