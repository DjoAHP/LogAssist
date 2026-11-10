// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import { McpServerCard } from "./McpServerCard"

const callbacks = { onTest: vi.fn(), onRefresh: vi.fn(), onEdit: vi.fn(), onDelete: vi.fn(), onBrowse: vi.fn(), onToggle: vi.fn() }
const server = { id: "docs", name: "Docs", endpoint: "https://docs.example/mcp", transport: "streamable_http" as const, auth: { type: "bearer" as const }, timeoutMs: 60_000, enabled: false, builtin: false }

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe("McpServerCard", () => {
  it("affiche identité, statut et compteur", () => {
    render(<McpServerCard server={server} toolCount={4} canEnable status={{ state: "ready" }} {...callbacks} />)
    expect(screen.getByText("Docs")).toBeTruthy()
    expect(screen.getByText("Prêt")).toBeTruthy()
    expect(screen.getByRole("button", { name: "Parcourir les 4 outils disponibles" })).toBeTruthy()
  })
  it("masque la suppression pour TinyFish intégré", () => {
    render(<McpServerCard server={{ ...server, id: "tinyfish", builtin: true }} toolCount={2} canEnable status={{ state: "connected" }} {...callbacks} />)
    expect(screen.getByText("Intégré")).toBeTruthy()
    expect(screen.queryByRole("button", { name: "Supprimer" })).toBeNull()
  })
  it("délègue les actions et annonce le statut", () => {
    render(<McpServerCard server={server} toolCount={4} canEnable={false} status={{ state: "offline" }} {...callbacks} />)
    fireEvent.click(screen.getByRole("button", { name: "Tester" }))
    expect(callbacks.onTest).toHaveBeenCalled()
    expect(screen.getByRole("status").textContent).toContain("Serveur injoignable")
  })
  it("état busy (connecting) : désactive Tester/Actualiser, affiche LoaderCircle animé et annonce Connexion en cours", () => {
    render(<McpServerCard server={server} toolCount={4} canEnable status={{ state: "connecting" }} {...callbacks} />)
    const testBtn = screen.getByRole("button", { name: "Tester" }) as HTMLButtonElement
    const refreshBtn = screen.getByRole("button", { name: "Actualiser les outils" }) as HTMLButtonElement
    expect(testBtn.disabled).toBe(true)
    expect(refreshBtn.disabled).toBe(true)
    const statusIcon = screen.getByRole("status").querySelector("svg") as SVGElement
    expect(statusIcon.classList.contains("animate-spin")).toBe(true)
    expect(screen.getByRole("status").textContent).toContain("Connexion en cours")
  })
  it("appelle onRefresh, onEdit, onBrowse, onToggle au clic", () => {
    render(<McpServerCard server={server} toolCount={4} canEnable status={{ state: "ready" }} {...callbacks} />)
    fireEvent.click(screen.getByRole("button", { name: "Actualiser les outils" }))
    expect(callbacks.onRefresh).toHaveBeenCalled()
    fireEvent.click(screen.getByRole("button", { name: "Modifier" }))
    expect(callbacks.onEdit).toHaveBeenCalled()
    fireEvent.click(screen.getByRole("button", { name: "Parcourir les 4 outils disponibles" }))
    expect(callbacks.onBrowse).toHaveBeenCalled()
    fireEvent.click(screen.getByLabelText("Activer le serveur"))
    expect(callbacks.onToggle).toHaveBeenCalledWith(true)
  })
  it("annonce dynamique : changement de status met à jour role=status", () => {
    const { rerender } = render(<McpServerCard server={server} toolCount={4} canEnable status={{ state: "ready" }} {...callbacks} />)
    expect(screen.getByRole("status").textContent).toContain("Prêt")
    rerender(<McpServerCard server={server} toolCount={4} canEnable status={{ state: "offline" }} {...callbacks} />)
    expect(screen.getByRole("status").textContent).toContain("Serveur injoignable")
  })
  describe("tonalité d'état réseau (DESIGN_SYSTEM.md : texte + icône + couleur)", () => {
    // Même motif que ProviderCard : connexité en cours → neutre, succès → vert, échec → destructive.
    const toneByState: Array<{ state: string; classe: string }> = [
      { state: "connected", classe: "text-green-600" },
      { state: "auth", classe: "text-destructive" },
      { state: "offline", classe: "text-destructive" },
      { state: "timeout", classe: "text-destructive" },
      { state: "protocol", classe: "text-destructive" },
    ]
    it.each(toneByState)("l'état $state porte sa classe de tonalité $classe", ({ state, classe }) => {
      render(<McpServerCard server={server} toolCount={4} canEnable status={{ state: state as "connected" }} {...callbacks} />)
      expect((screen.getByRole("status") as HTMLElement).className).toContain(classe)
    })
    it("au moins deux états distincts rendent des couleurs différentes", () => {
      const { rerender } = render(<McpServerCard server={server} toolCount={4} canEnable status={{ state: "connected" }} {...callbacks} />)
      const connected = (screen.getByRole("status") as HTMLElement).className
      rerender(<McpServerCard server={server} toolCount={4} canEnable status={{ state: "offline" }} {...callbacks} />)
      const offline = (screen.getByRole("status") as HTMLElement).className
      expect(connected).not.toBe(offline)
    })
  })
})
