// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react"
import { LockGate } from "./LockGate"

const mockVerify = vi.hoisted(() => vi.fn())
const mockLoggerError = vi.hoisted(() => vi.fn())
vi.mock("@/lib/applock/service", () => ({ applock: { verify: mockVerify } }))
vi.mock("@/lib/logger", () => ({ logger: { debug: vi.fn(), error: mockLoggerError } }))
vi.mock("@/assets/logo.png", () => ({ default: "logo.png" }))

import { t } from "@/i18n/fr"

beforeEach(() => {
  vi.clearAllMocks()
  mockVerify.mockResolvedValue(false)
})
afterEach(cleanup)

describe("LockGate — déverrouillage", () => {
  it("n'affiche que le logo, le champ et le bouton (pas de titre ni de texte)", () => {
    render(<LockGate onUnlock={vi.fn()} />)
    expect(screen.getByTestId("lock-logo")).not.toBeNull()
    expect(screen.queryByText(t.lock.title)).toBeNull()
    expect(screen.queryByText(t.lock.subtitle)).toBeNull()
  })

  it("affiche une erreur sans déverrouiller si le mot de passe est faux", async () => {
    const onUnlock = vi.fn()
    render(<LockGate onUnlock={onUnlock} />)
    const input = screen.getByLabelText(t.lock.passwordField)
    fireEvent.change(input, { target: { value: "mauvais" } })
    fireEvent.click(screen.getByRole("button", { name: t.lock.unlock }))
    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent(t.lock.wrongPassword),
    )
    expect(onUnlock).not.toHaveBeenCalled()
  })

  it("appelle onUnlock si le mot de passe est correct", async () => {
    mockVerify.mockResolvedValue(true)
    const onUnlock = vi.fn()
    render(<LockGate onUnlock={onUnlock} />)
    const input = screen.getByLabelText(t.lock.passwordField)
    fireEvent.change(input, { target: { value: "bon" } })
    fireEvent.click(screen.getByRole("button", { name: t.lock.unlock }))
    await waitFor(() => expect(onUnlock).toHaveBeenCalledTimes(1))
    expect(screen.queryByRole("alert")).toBeNull()
  })

  it("soumet avec la touche Entrée", async () => {
    mockVerify.mockResolvedValue(true)
    const onUnlock = vi.fn()
    render(<LockGate onUnlock={onUnlock} />)
    const input = screen.getByLabelText(t.lock.passwordField)
    fireEvent.change(input, { target: { value: "bon" } })
    fireEvent.keyDown(input, { key: "Enter" })
    await waitFor(() => expect(onUnlock).toHaveBeenCalledTimes(1))
  })

  it("refuse de soumettre un champ vide", async () => {
    render(<LockGate onUnlock={vi.fn()} />)
    fireEvent.click(screen.getByRole("button", { name: t.lock.unlock }))
    await waitFor(() => expect(mockVerify).not.toHaveBeenCalled())
  })

  it("affiche une erreur générique si la commande Rust échoue", async () => {
    mockVerify.mockRejectedValue(new Error("boom"))
    render(<LockGate onUnlock={vi.fn()} />)
    const input = screen.getByLabelText(t.lock.passwordField)
    fireEvent.change(input, { target: { value: "x" } })
    fireEvent.click(screen.getByRole("button", { name: t.lock.unlock }))
    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent(t.lock.verifyFailed),
    )
    expect(mockLoggerError).toHaveBeenCalled()
  })
})
