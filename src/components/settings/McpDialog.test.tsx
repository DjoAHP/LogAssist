// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const hasSecret = vi.hoisted(() => vi.fn())
const configure = vi.hoisted(() => vi.fn())
const removeSecret = vi.hoisted(() => vi.fn())
const loadWebAccess = vi.hoisted(() => vi.fn())
const setWebEnabled = vi.hoisted(() => vi.fn())

vi.mock("@/lib/mcp/client", () => ({
  tinyfish: { hasSecret, configure, removeSecret },
}))
vi.mock("@/lib/mcp/settings", () => ({ loadWebAccess, setWebEnabled }))

import { McpDialog } from "@/components/settings/McpDialog"

beforeEach(() => {
  vi.clearAllMocks()
  loadWebAccess.mockResolvedValue({ enabled: false, configured: false })
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe("McpDialog", () => {
  it("affiche TinyFish non configuré sans clé préremplie", async () => {
    render(<McpDialog onClose={vi.fn()} onChanged={vi.fn()} />)
    expect(await screen.findByText("Non configuré")).toBeTruthy()
    expect((screen.getByLabelText("Clé API TinyFish") as HTMLInputElement).value).toBe("")
    expect((screen.getByRole("checkbox") as HTMLInputElement).disabled).toBe(true)
    expect(screen.queryByText(/endpoint/i)).toBeNull()
  })

  it("teste et enregistre une clé avant d'autoriser l'activation", async () => {
    configure.mockResolvedValue(undefined)
    const onChanged = vi.fn()
    render(<McpDialog onClose={vi.fn()} onChanged={onChanged} />)
    await screen.findByText("Non configuré")
    fireEvent.change(screen.getByLabelText("Clé API TinyFish"), { target: { value: "tf-key" } })
    fireEvent.click(screen.getByRole("button", { name: "Tester et enregistrer" }))
    await waitFor(() => expect(configure).toHaveBeenCalledWith("tf-key"))
    expect((screen.getByRole("checkbox") as HTMLInputElement).disabled).toBe(false)
    expect((screen.getByLabelText("Clé API TinyFish") as HTMLInputElement).value).toBe("")
    expect(onChanged).toHaveBeenCalled()
  })

  it("conserve l'état configuré si une clé de remplacement échoue", async () => {
    loadWebAccess.mockResolvedValue({ enabled: true, configured: true })
    configure.mockRejectedValue(new Error("refusée"))
    render(<McpDialog onClose={vi.fn()} onChanged={vi.fn()} />)
    expect(await screen.findByText("Connecté")).toBeTruthy()
    fireEvent.change(screen.getByLabelText("Clé API TinyFish"), { target: { value: "bad" } })
    fireEvent.click(screen.getByRole("button", { name: "Tester et enregistrer" }))
    expect(await screen.findByText("Échec de connexion")).toBeTruthy()
    expect((screen.getByRole("checkbox") as HTMLInputElement).checked).toBe(true)
  })

  it("supprime la clé, désactive le Web et se ferme avec Escape", async () => {
    loadWebAccess.mockResolvedValue({ enabled: true, configured: true })
    removeSecret.mockResolvedValue(undefined)
    setWebEnabled.mockResolvedValue(undefined)
    vi.spyOn(window, "confirm").mockReturnValue(true)
    const onClose = vi.fn()
    render(<McpDialog onClose={onClose} onChanged={vi.fn()} />)
    await screen.findByText("Connecté")
    fireEvent.click(screen.getByRole("button", { name: "Supprimer la clé" }))
    await waitFor(() => expect(removeSecret).toHaveBeenCalled())
    expect(setWebEnabled).toHaveBeenCalledWith(false)
    fireEvent.keyDown(document, { key: "Escape" })
    expect(onClose).toHaveBeenCalled()
  })
})
