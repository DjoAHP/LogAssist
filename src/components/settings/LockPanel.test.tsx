// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react"
import { LockPanel } from "./LockPanel"

const mockSet = vi.hoisted(() => vi.fn())
const mockVerify = vi.hoisted(() => vi.fn())
const mockIsEnabled = vi.hoisted(() => vi.fn())
const mockSetEnabled = vi.hoisted(() => vi.fn())
const mockRemove = vi.hoisted(() => vi.fn())
const mockLoggerError = vi.hoisted(() => vi.fn())

vi.mock("@/lib/applock/service", () => ({
  applock: {
    set: mockSet,
    verify: mockVerify,
    isEnabled: mockIsEnabled,
    setEnabled: mockSetEnabled,
    remove: mockRemove,
  },
}))
vi.mock("@/lib/logger", () => ({ logger: { debug: vi.fn(), error: mockLoggerError } }))

import { t } from "@/i18n/fr"

function typeIn(label: string, value: string) {
  fireEvent.change(screen.getByLabelText(label), { target: { value } })
}

beforeEach(() => {
  vi.clearAllMocks()
  mockIsEnabled.mockResolvedValue(false)
  mockSet.mockResolvedValue(undefined)
  // Le mock simule le store : setEnabled met à jour la valeur relue ensuite.
  mockSetEnabled.mockImplementation(async (value: boolean) => {
    mockIsEnabled.mockResolvedValue(value)
  })
  mockRemove.mockResolvedValue(undefined)
  mockVerify.mockResolvedValue(true)
})
afterEach(cleanup)

describe("LockPanel — état initial", () => {
  it("verrou désactivé : switch décoché, pas de bouton changer", async () => {
    render(<LockPanel />)
    await waitFor(() =>
      expect(
        screen.getByRole("switch", { name: t.lockSettings.disabled }),
      ).toHaveAttribute("aria-checked", "false"),
    )
    expect(screen.queryByRole("button", { name: t.lockSettings.change })).toBeNull()
  })

  it("verrou activé : switch coché et bouton changer présent", async () => {
    mockIsEnabled.mockResolvedValue(true)
    render(<LockPanel />)
    await waitFor(() =>
      expect(
        screen.getByRole("switch", { name: t.lockSettings.enabled }),
      ).toHaveAttribute("aria-checked", "true"),
    )
    expect(screen.getByRole("button", { name: t.lockSettings.change })).not.toBeNull()
  })
})

describe("LockPanel — activation", () => {
  it("active le verrou : applock.set puis setEnabled(true)", async () => {
    render(<LockPanel />)
    await screen.findByRole("switch", { name: t.lockSettings.disabled })
    fireEvent.click(screen.getByRole("switch", { name: t.lockSettings.disabled }))
    typeIn(t.lockSettings.newPassword, "mot-de-passe")
    typeIn(t.lockSettings.confirmPassword, "mot-de-passe")
    fireEvent.click(screen.getByRole("button", { name: t.lockSettings.validate }))
    await waitFor(() => expect(mockSet).toHaveBeenCalledWith("mot-de-passe"))
    await waitFor(() => expect(mockSetEnabled).toHaveBeenCalledWith(true))
    await waitFor(() =>
      expect(screen.getByRole("switch", { name: t.lockSettings.enabled })).not.toBeNull(),
    )
  })

  it("refuse des mots de passe différents sans rien enregistrer", async () => {
    render(<LockPanel />)
    await screen.findByRole("switch", { name: t.lockSettings.disabled })
    fireEvent.click(screen.getByRole("switch", { name: t.lockSettings.disabled }))
    typeIn(t.lockSettings.newPassword, "abc")
    typeIn(t.lockSettings.confirmPassword, "abcd")
    fireEvent.click(screen.getByRole("button", { name: t.lockSettings.validate }))
    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent(t.lockSettings.mismatch),
    )
    expect(mockSet).not.toHaveBeenCalled()
  })

  it("refuse un mot de passe trop court", async () => {
    render(<LockPanel />)
    await screen.findByRole("switch", { name: t.lockSettings.disabled })
    fireEvent.click(screen.getByRole("switch", { name: t.lockSettings.disabled }))
    typeIn(t.lockSettings.newPassword, "abc")
    typeIn(t.lockSettings.confirmPassword, "abc")
    fireEvent.click(screen.getByRole("button", { name: t.lockSettings.validate }))
    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent(t.lockSettings.tooShort),
    )
    expect(mockSet).not.toHaveBeenCalled()
  })
})

describe("LockPanel — désactivation (exige le mot de passe actuel)", () => {
  it("refuse de désactiver avec le mauvais mot de passe actuel", async () => {
    mockIsEnabled.mockResolvedValue(true)
    mockVerify.mockResolvedValue(false)
    render(<LockPanel />)
    await screen.findByRole("switch", { name: t.lockSettings.enabled })
    fireEvent.click(screen.getByRole("switch", { name: t.lockSettings.enabled }))
    typeIn(t.lockSettings.currentPassword, "faux")
    fireEvent.click(screen.getByRole("button", { name: t.lockSettings.validate }))
    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent(t.lockSettings.verifyCurrentFailed),
    )
    expect(mockRemove).not.toHaveBeenCalled()
    expect(mockSetEnabled).not.toHaveBeenCalled()
  })

  it("désactive avec le bon mot de passe actuel : remove + setEnabled(false)", async () => {
    mockIsEnabled.mockResolvedValue(true)
    render(<LockPanel />)
    await screen.findByRole("switch", { name: t.lockSettings.enabled })
    fireEvent.click(screen.getByRole("switch", { name: t.lockSettings.enabled }))
    typeIn(t.lockSettings.currentPassword, "bon")
    fireEvent.click(screen.getByRole("button", { name: t.lockSettings.validate }))
    await waitFor(() => expect(mockRemove).toHaveBeenCalledTimes(1))
    await waitFor(() => expect(mockSetEnabled).toHaveBeenCalledWith(false))
  })
})

describe("LockPanel — changement de mot de passe", () => {
  it("exige le mot de passe actuel avant d'enregistrer le nouveau", async () => {
    mockIsEnabled.mockResolvedValue(true)
    mockVerify.mockResolvedValue(false)
    render(<LockPanel />)
    await screen.findByRole("switch", { name: t.lockSettings.enabled })
    fireEvent.click(screen.getByRole("button", { name: t.lockSettings.change }))
    typeIn(t.lockSettings.currentPassword, "faux")
    typeIn(t.lockSettings.newPassword, "nouveau-mdp")
    typeIn(t.lockSettings.confirmPassword, "nouveau-mdp")
    fireEvent.click(screen.getByRole("button", { name: t.lockSettings.validate }))
    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent(t.lockSettings.verifyCurrentFailed),
    )
    expect(mockSet).not.toHaveBeenCalled()

    mockVerify.mockResolvedValue(true)
    fireEvent.change(screen.getByLabelText(t.lockSettings.currentPassword), {
      target: { value: "bon" },
    })
    fireEvent.click(screen.getByRole("button", { name: t.lockSettings.validate }))
    await waitFor(() => expect(mockSet).toHaveBeenCalledWith("nouveau-mdp"))
  })
})
