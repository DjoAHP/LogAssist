// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest"
import { render, screen, fireEvent, cleanup } from "@testing-library/react"
import { GeneralSettingsDialog } from "./GeneralSettingsDialog"

// Les panneaux sont stubs : leur comportement est couvert par leurs propres tests.
vi.mock("./LockPanel", () => ({ LockPanel: () => <div data-testid="lock-panel-stub" /> }))
vi.mock("./ConnectorsPanel", () => ({
  ConnectorsPanel: ({ statuses, onSelect }: {
    statuses: { github: { configured: boolean; login: string | null } }
    onSelect: (connectorId: string) => void
  }) => (
    <div data-testid="connectors-panel-stub">
      <span>{statuses.github.configured ? `@${statuses.github.login}` : "off"}</span>
      <button onClick={() => onSelect("github")}>Configurer GitHub</button>
    </div>
  ),
}))

const mockRefreshGithubStatus = vi.hoisted(() => vi.fn().mockResolvedValue(undefined))
vi.mock("@/hooks/useGithubConnectorStatus", () => ({
  useGithubConnectorStatus: () => ({
    status: { configured: true, login: "octocat" },
    loading: false,
    refresh: mockRefreshGithubStatus,
  }),
}))

vi.mock("./GithubConnectorDialog", () => ({
  GithubConnectorDialog: ({ isOpen, onClose }: { isOpen: boolean; onClose: () => void }) => (
    isOpen ? (
      <div data-testid="github-connector-dialog-stub">
        <button onClick={onClose}>Fermer GitHub</button>
      </div>
    ) : null
  ),
}))

import { t } from "@/i18n/fr"

afterEach(cleanup)

describe("GeneralSettingsDialog — squelette miniature", () => {
  it("affiche le titre avec l'icône à droite, la catégorie avec son icône et le panneau verrou", () => {
    render(<GeneralSettingsDialog onClose={() => {}} />)
    const dialog = screen.getByRole("dialog", { name: t.generalSettings.title })
    expect(dialog).not.toBeNull()
    // Icône à droite du titre : dans le header, le <h2> précède le <svg>.
    const headerTitle = dialog.querySelector("h2")!
    expect(headerTitle.textContent).toBe(t.generalSettings.title)
    expect(headerTitle.nextElementSibling?.tagName.toLowerCase()).toBe("svg")
    // Catégorie avec icône lucide à gauche du libellé.
    const categoryButton = screen.getByRole("button", { name: t.generalSettings.categories.lock })
    const firstIcon = categoryButton.querySelector("svg")
    expect(firstIcon).not.toBeNull()
    expect(categoryButton.textContent).toContain(t.generalSettings.categories.lock)
    expect(screen.getByTestId("lock-panel-stub")).not.toBeNull()
  })

  it("affiche la catégorie Connecteurs et son panneau quand on clique dessus", () => {
    render(<GeneralSettingsDialog onClose={() => {}} />)
    const connectorsButton = screen.getByRole("button", { name: t.generalSettings.categories.connectors })
    expect(connectorsButton).not.toBeNull()
    fireEvent.click(connectorsButton)
    expect(screen.getByTestId("connectors-panel-stub")).not.toBeNull()
    expect(screen.getByText("@octocat")).not.toBeNull()
  })

  it("ouvre le dialogue GitHub puis rafraîchit son statut à la fermeture", () => {
    render(<GeneralSettingsDialog onClose={() => {}} />)
    fireEvent.click(screen.getByRole("button", { name: t.generalSettings.categories.connectors }))

    fireEvent.click(screen.getByRole("button", { name: "Configurer GitHub" }))
    expect(screen.getByTestId("github-connector-dialog-stub")).not.toBeNull()

    fireEvent.click(screen.getByRole("button", { name: "Fermer GitHub" }))
    expect(mockRefreshGithubStatus).toHaveBeenCalledTimes(1)
    expect(screen.queryByTestId("github-connector-dialog-stub")).toBeNull()
  })

  it("ferme au clic sur la croix", () => {
    const onClose = vi.fn()
    render(<GeneralSettingsDialog onClose={onClose} />)
    fireEvent.click(screen.getByRole("button", { name: t.generalSettings.close }))
    expect(onClose).toHaveBeenCalledTimes(1)
  })
})
