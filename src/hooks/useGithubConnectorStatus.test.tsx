// @vitest-environment jsdom
import { act, renderHook, waitFor } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"

const mockStatus = vi.hoisted(() => vi.fn())

vi.mock("@/lib/connectors/client", () => ({
  connectorGithub: { status: mockStatus },
}))

import { useGithubConnectorStatus } from "@/hooks/useGithubConnectorStatus"

beforeEach(() => {
  vi.clearAllMocks()
})

describe("useGithubConnectorStatus", () => {
  it("charge le statut GitHub sans exposer le jeton", async () => {
    mockStatus.mockResolvedValueOnce({ configured: true, login: "octocat" })
    const { result } = renderHook(() => useGithubConnectorStatus())

    await waitFor(() => expect(result.current.status).toEqual({ configured: true, login: "octocat" }))
    expect(mockStatus).toHaveBeenCalledTimes(1)
    expect(result.current.loading).toBe(false)
  })

  it("revient à un statut sûr quand le pont échoue", async () => {
    mockStatus.mockRejectedValueOnce(new Error("offline"))
    const { result } = renderHook(() => useGithubConnectorStatus())

    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.status).toEqual({ configured: false, login: null })
  })

  it("peut être rafraîchi après une configuration", async () => {
    mockStatus
      .mockResolvedValueOnce({ configured: false, login: null })
      .mockResolvedValueOnce({ configured: true, login: "octocat" })
    const { result } = renderHook(() => useGithubConnectorStatus())
    await waitFor(() => expect(result.current.loading).toBe(false))

    await act(async () => {
      await result.current.refresh()
    })

    expect(result.current.status).toEqual({ configured: true, login: "octocat" })
    expect(mockStatus).toHaveBeenCalledTimes(2)
  })
})
