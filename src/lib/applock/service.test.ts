import { describe, it, expect, vi, beforeEach } from "vitest"

const mockInvoke = vi.hoisted(() => vi.fn())
vi.mock("@tauri-apps/api/core", () => ({ invoke: mockInvoke }))

const mockSettingsGet = vi.hoisted(() => vi.fn())
const mockSettingsSet = vi.hoisted(() => vi.fn())
vi.mock("@/lib/db/settings", () => ({
  settings: { get: mockSettingsGet, set: mockSettingsSet },
}))

import { applock, isLockActive, LOCK_ENABLED_KEY } from "./service"

beforeEach(() => {
  vi.clearAllMocks()
  mockInvoke.mockResolvedValue(undefined)
  mockSettingsGet.mockResolvedValue(null)
})

describe("applock — flag d'activation", () => {
  it("lit le flag lock.enabled", async () => {
    mockSettingsGet.mockResolvedValue("1")
    await expect(applock.isEnabled()).resolves.toBe(true)
    expect(mockSettingsGet).toHaveBeenCalledWith(LOCK_ENABLED_KEY)
  })

  it("écrit le flag lock.enabled", async () => {
    await applock.setEnabled(true)
    expect(mockSettingsSet).toHaveBeenCalledWith(LOCK_ENABLED_KEY, "1")
  })
})

describe("applock — pont vers les commandes Rust", () => {
  it("set délègue à set_applock_secret", async () => {
    await applock.set("secret")
    expect(mockInvoke).toHaveBeenCalledWith("set_applock_secret", { password: "secret" })
  })

  it("verify délègue à verify_applock_secret", async () => {
    mockInvoke.mockResolvedValue(true)
    await expect(applock.verify("secret")).resolves.toBe(true)
    expect(mockInvoke).toHaveBeenCalledWith("verify_applock_secret", { candidate: "secret" })
  })

  it("isConfigured délègue à applock_configured", async () => {
    mockInvoke.mockResolvedValue(false)
    await expect(applock.isConfigured()).resolves.toBe(false)
    expect(mockInvoke).toHaveBeenCalledWith("applock_configured")
  })

  it("remove délègue à remove_applock_secret", async () => {
    await applock.remove()
    expect(mockInvoke).toHaveBeenCalledWith("remove_applock_secret")
  })
})

describe("isLockActive", () => {
  it("renvoie false sans appeler le pont Rust si le flag est désactivé", async () => {
    mockSettingsGet.mockResolvedValue("0")
    await expect(isLockActive()).resolves.toBe(false)
    expect(mockInvoke).not.toHaveBeenCalled()
  })

  it("renvoie true si flag actif et hash présent", async () => {
    mockSettingsGet.mockResolvedValue("1")
    mockInvoke.mockImplementation((cmd: string) =>
      cmd === "applock_configured" ? Promise.resolve(true) : Promise.resolve(undefined),
    )
    await expect(isLockActive()).resolves.toBe(true)
  })

  it("fail-open : flag actif mais hash absent → remet le flag à zéro et renvoie false", async () => {
    mockSettingsGet.mockResolvedValue("1")
    mockInvoke.mockImplementation((cmd: string) =>
      cmd === "applock_configured" ? Promise.resolve(false) : Promise.resolve(undefined),
    )
    await expect(isLockActive()).resolves.toBe(false)
    expect(mockSettingsSet).toHaveBeenCalledWith(LOCK_ENABLED_KEY, "0")
  })
})
