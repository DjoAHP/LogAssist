// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const mockCheck = vi.hoisted(() => vi.fn())
const mockRelaunch = vi.hoisted(() => vi.fn())

vi.mock("@tauri-apps/plugin-updater", () => ({ check: mockCheck }))
vi.mock("@tauri-apps/plugin-process", () => ({ relaunch: mockRelaunch }))

import { useUpdater } from "@/hooks/useUpdater"

function makeUpdate(version: string) {
  return { version, downloadAndInstall: vi.fn() }
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.useFakeTimers()
  vi.stubEnv("PROD", true)
})

afterEach(() => {
  vi.unstubAllEnvs()
  vi.useRealTimers()
})

describe("useUpdater", () => {
  it("au démarrage, vérifie après le délai de grâce et reste discret sans mise à jour", async () => {
    mockCheck.mockResolvedValue(null)
    const { result } = renderHook(() => useUpdater({ graceDelayMs: 0 }))

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })
    expect(mockCheck).toHaveBeenCalledTimes(1)
    expect(result.current.state).toEqual({ phase: "idle" })
  })

  it("au démarrage, expose une mise à jour disponible", async () => {
    mockCheck.mockResolvedValue(makeUpdate("3.5.0"))
    const { result } = renderHook(() => useUpdater({ graceDelayMs: 0 }))

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })
    expect(result.current.state).toEqual({ phase: "available", version: "3.5.0" })
  })

  it("ne vérifie pas avant la fin du délai de grâce", async () => {
    mockCheck.mockResolvedValue(null)
    renderHook(() => useUpdater({ graceDelayMs: 15_000 }))

    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000)
    })
    expect(mockCheck).not.toHaveBeenCalled()
  })

  it("un check silencieux en échec n'alerte pas", async () => {
    mockCheck.mockRejectedValue(new Error("offline"))
    const { result } = renderHook(() => useUpdater({ graceDelayMs: 0 }))

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })
    expect(result.current.state).toEqual({ phase: "idle" })
  })

  it("checkNow sans mise à jour affiche 'à jour'", async () => {
    mockCheck.mockResolvedValue(null)
    const { result } = renderHook(() => useUpdater({ graceDelayMs: 60_000 }))

    await act(async () => {
      await result.current.checkNow()
    })
    expect(result.current.state).toEqual({ phase: "upToDate" })
  })

  it("expose checking pendant une vérification manuelle", async () => {
    let resolveCheck!: (value: null) => void
    mockCheck.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveCheck = resolve
        }),
    )
    const { result } = renderHook(() => useUpdater({ graceDelayMs: 60_000 }))
    let checkPromise!: Promise<void>

    act(() => {
      checkPromise = result.current.checkNow()
    })
    expect(result.current.state).toEqual({ phase: "checking" })

    await act(async () => {
      resolveCheck(null)
      await checkPromise
    })
    expect(result.current.state).toEqual({ phase: "upToDate" })
  })

  it("garde le check silencieux invisible pendant la requête", async () => {
    let resolveCheck!: (value: null) => void
    mockCheck.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveCheck = resolve
        }),
    )
    const { result } = renderHook(() => useUpdater({ graceDelayMs: 0 }))

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })
    expect(result.current.state).toEqual({ phase: "idle" })

    await act(async () => {
      resolveCheck(null)
      await Promise.resolve()
    })
    expect(result.current.state).toEqual({ phase: "idle" })
  })

  it("checkNow en échec expose l'erreur", async () => {
    mockCheck.mockRejectedValue(new Error("offline"))
    const { result } = renderHook(() => useUpdater({ graceDelayMs: 60_000 }))

    await act(async () => {
      await result.current.checkNow()
    })
    expect(result.current.state).toEqual({ phase: "error", operation: "check" })
  })

  it("install télécharge avec progression puis passe en ready et relance", async () => {
    const update = makeUpdate("3.5.0")
    update.downloadAndInstall.mockImplementation(async (onEvent?: (e: unknown) => void) => {
      onEvent?.({ event: "Started", data: { contentLength: 10 } })
      onEvent?.({ event: "Progress", data: { chunkLength: 5 } })
      onEvent?.({ event: "Progress", data: { chunkLength: 5 } })
      onEvent?.({ event: "Finished" })
    })
    mockCheck.mockResolvedValue(update)
    const { result } = renderHook(() => useUpdater({ graceDelayMs: 0 }))

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })
    expect(result.current.state).toEqual({ phase: "available", version: "3.5.0" })

    await act(async () => {
      await result.current.install()
    })
    expect(mockRelaunch).toHaveBeenCalledTimes(1)
    expect(result.current.state).toEqual({ phase: "ready", version: "3.5.0" })
  })

  it("install en échec expose l'erreur", async () => {
    const update = makeUpdate("3.5.0")
    update.downloadAndInstall.mockRejectedValue(new Error("signature invalide"))
    mockCheck.mockResolvedValue(update)
    const { result } = renderHook(() => useUpdater({ graceDelayMs: 0 }))

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })
    await act(async () => {
      await result.current.install()
    })
    expect(mockRelaunch).not.toHaveBeenCalled()
    expect(result.current.state).toEqual({ phase: "error", operation: "install" })
  })

  it("en développement, aucun appel au plugin", async () => {
    vi.stubEnv("PROD", false)
    renderHook(() => useUpdater({ graceDelayMs: 0 }))

    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000)
    })
    expect(mockCheck).not.toHaveBeenCalled()
  })
})
