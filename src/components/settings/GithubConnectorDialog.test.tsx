// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, describe, expect, it, vi } from "vitest"
import { GithubConnectorDialog } from "./GithubConnectorDialog"
import { t } from "@/i18n/fr"

afterEach(cleanup)

vi.mock("@/lib/connectors/client", () => ({
  connectorGithub: {
    status: vi.fn(),
    configure: vi.fn(),
    delete: vi.fn(),
  },
}))

vi.mock("@tauri-apps/plugin-dialog", () => ({
  confirm: vi.fn(),
}))

vi.mock("@/components/chat/TauriLink", () => ({
  TauriLink: ({ children, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement>) => (
    <a {...props} data-testid="tauri-link">{children}</a>
  ),
}))

describe("GithubConnectorDialog", () => {
  const defaultProps = {
    isOpen: true,
    onClose: vi.fn(),
  }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("affiche l'état 'Non configuré' et le champ mot de passe vide", async () => {
    const { connectorGithub } = await import("@/lib/connectors/client")
    vi.mocked(connectorGithub.status).mockResolvedValue({
      configured: false,
      login: null,
    })

    render(<GithubConnectorDialog {...defaultProps} />)

    expect(screen.getByRole("heading", { name: t.connectors.title })).toBeInTheDocument()
    expect(screen.getByLabelText(t.connectors.tokenLabel)).toHaveValue("")
    expect(screen.getByText(t.connectors.status.notConfigured)).toBeInTheDocument()
    expect(screen.getByRole("button", { name: t.connectors.testAndSave })).toBeInTheDocument()
    expect(screen.queryByText(t.connectors.replace)).not.toBeInTheDocument()
    expect(screen.queryByText(t.connectors.disconnect)).not.toBeInTheDocument()
  })

  it("affiche l'état 'Connecté en tant que @login' et les boutons Remplacer/Déconnecter", async () => {
    const { connectorGithub } = await import("@/lib/connectors/client")
    vi.mocked(connectorGithub.status).mockResolvedValue({
      configured: true,
      login: "octocat",
    })

    render(<GithubConnectorDialog {...defaultProps} />)

    // Attendre que le statut se charge
    await vi.waitFor(() => expect(screen.getByTestId("connected-text")).toHaveTextContent("Connecté (@octocat)"))
    expect(screen.getByRole("button", { name: t.connectors.replace })).toBeInTheDocument()
    expect(screen.getByRole("button", { name: t.connectors.disconnect })).toBeInTheDocument()
    // queryByRole pour assertion négative
    expect(screen.queryByRole("button", { name: t.connectors.testAndSave })).not.toBeInTheDocument()
  })

  it("appelle configure au clic sur 'Tester et enregistrer' et affiche le résultat en aria-live", async () => {
    const { connectorGithub } = await import("@/lib/connectors/client")
    vi.mocked(connectorGithub.status).mockResolvedValue({
      configured: false,
      login: null,
    })
    // Ajouter un délai pour que le message "testing" soit visible
    vi.mocked(connectorGithub.configure).mockImplementation(async () => {
      await new Promise((r) => setTimeout(r, 50))
      return { configured: true, login: "octocat" }
    })

    render(<GithubConnectorDialog {...defaultProps} />)

    const input = screen.getByLabelText(t.connectors.tokenLabel)
    await userEvent.type(input, "ghp_fake_token_123")

    const liveRegion = screen.getByRole("status", { hidden: true })
    expect(liveRegion.textContent).toBe("")

    await userEvent.click(screen.getByRole("button", { name: t.connectors.testAndSave }))

    expect(connectorGithub.configure).toHaveBeenCalledWith("ghp_fake_token_123")
    // Attendre que le message "testing" apparaisse
    await vi.waitFor(() => expect(liveRegion.textContent).toBe(t.connectors.testing))
    // Attendre la résolution
    await vi.waitFor(() => expect(liveRegion.textContent).not.toBe(t.connectors.testing))
    expect(liveRegion.textContent).toContain("octocat")
  })

  it("affiche l'erreur i18n si configure échoue", async () => {
    const { connectorGithub } = await import("@/lib/connectors/client")
    vi.mocked(connectorGithub.status).mockResolvedValue({
      configured: false,
      login: null,
    })
    // L'erreur doit avoir la structure ConnectorErrorPayload
    const authError = { kind: "auth", message: t.connectors.errors.auth }
    vi.mocked(connectorGithub.configure).mockRejectedValue(authError)

    render(<GithubConnectorDialog {...defaultProps} />)

    const input = screen.getByLabelText(t.connectors.tokenLabel)
    await userEvent.type(input, "bad_token")

    const liveRegion = screen.getByRole("status", { hidden: true })
    await userEvent.click(screen.getByRole("button", { name: t.connectors.testAndSave }))

    await vi.waitFor(() => expect(liveRegion.textContent).toBe(t.connectors.errors.auth))
  })

  it("affiche l'avertissement jeton classique", async () => {
    const { connectorGithub } = await import("@/lib/connectors/client")
    vi.mocked(connectorGithub.status).mockResolvedValue({
      configured: false,
      login: null,
    })
    vi.mocked(connectorGithub.configure).mockResolvedValue({
      configured: true,
      login: "classic_user",
    })

    render(<GithubConnectorDialog {...defaultProps} />)

    const input = screen.getByLabelText(t.connectors.tokenLabel)
    await userEvent.type(input, "ghp_fake_token_123")
    await userEvent.click(screen.getByRole("button", { name: t.connectors.testAndSave }))

    // Attendre que l'avertissement apparaisse
    await vi.waitFor(() => expect(screen.getByTestId("classic-warning")).toBeInTheDocument())
  })

  it("confirme avant déconnexion avec dialogConfirm", async () => {
    const { connectorGithub } = await import("@/lib/connectors/client")
    const { confirm } = await import("@tauri-apps/plugin-dialog")
    vi.mocked(connectorGithub.status).mockResolvedValue({
      configured: true,
      login: "octocat",
    })
    vi.mocked(confirm).mockResolvedValue(true)

    render(<GithubConnectorDialog {...defaultProps} />)

    // Attendre que le bouton Déconnecter apparaisse
    await vi.waitFor(() => {
      const buttons = screen.getAllByRole("button")
      const disconnectButton = buttons.find((b) => b.textContent?.includes(t.connectors.disconnect))
      expect(disconnectButton).toBeDefined()
      return disconnectButton
    }).then((btn) => userEvent.click(btn!))

    expect(confirm).toHaveBeenCalledWith(
      expect.stringContaining(t.connectors.disconnectConfirm),
      expect.any(Object)
    )
    expect(connectorGithub.delete).toHaveBeenCalled()
  })

  it("ne déconnecte pas si confirm annulé", async () => {
    const { connectorGithub } = await import("@/lib/connectors/client")
    const { confirm } = await import("@tauri-apps/plugin-dialog")
    vi.mocked(connectorGithub.status).mockResolvedValue({
      configured: true,
      login: "octocat",
    })
    vi.mocked(confirm).mockResolvedValue(false)

    render(<GithubConnectorDialog {...defaultProps} />)

    await vi.waitFor(() => {
      const buttons = screen.getAllByRole("button")
      const disconnectButton = buttons.find((b) => b.textContent?.includes(t.connectors.disconnect))
      expect(disconnectButton).toBeDefined()
      return disconnectButton
    }).then((btn) => userEvent.click(btn!))

    expect(confirm).toHaveBeenCalled()
    expect(connectorGithub.delete).not.toHaveBeenCalled()
  })

  it("ferme la modale via onClose", async () => {
    const { connectorGithub } = await import("@/lib/connectors/client")
    vi.mocked(connectorGithub.status).mockResolvedValue({
      configured: false,
      login: null,
    })

    render(<GithubConnectorDialog {...defaultProps} />)

    await userEvent.click(screen.getByRole("button", { name: t.generalSettings.close }))

    expect(defaultProps.onClose).toHaveBeenCalledTimes(1)
  })

  it("ferme au clic sur l'overlay", async () => {
    const { connectorGithub } = await import("@/lib/connectors/client")
    vi.mocked(connectorGithub.status).mockResolvedValue({
      configured: false,
      login: null,
    })

    render(<GithubConnectorDialog {...defaultProps} />)

    const overlay = screen.getByTestId("github-connector-dialog-overlay")
    await userEvent.click(overlay)

    expect(defaultProps.onClose).toHaveBeenCalledTimes(1)
  })

  it("le focus initial est sur le champ token", async () => {
    const { connectorGithub } = await import("@/lib/connectors/client")
    vi.mocked(connectorGithub.status).mockResolvedValue({
      configured: false,
      login: null,
    })

    render(<GithubConnectorDialog {...defaultProps} />)

    expect(screen.getByLabelText(t.connectors.tokenLabel)).toHaveFocus()
  })

  it("affiche le lien de création du jeton", async () => {
    const { connectorGithub } = await import("@/lib/connectors/client")
    vi.mocked(connectorGithub.status).mockResolvedValue({
      configured: false,
      login: null,
    })

    render(<GithubConnectorDialog {...defaultProps} />)

    const link = screen.getByTestId("tauri-link")
    expect(link).toBeInTheDocument()
  })
})