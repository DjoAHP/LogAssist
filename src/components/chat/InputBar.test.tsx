// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react"
import { t } from "@/i18n/fr"

const mockInvoke = vi.hoisted(() => vi.fn())
const mockOpenUrl = vi.hoisted(() => vi.fn())
const mockConnectorGithub = vi.hoisted(() => ({
  configure: vi.fn(),
  status: vi.fn(),
  delete: vi.fn(),
  listRepos: vi.fn().mockResolvedValue({ repos: [], page: 1, hasMore: false }),
  listBranches: vi.fn().mockResolvedValue([]),
  callTool: vi.fn(),
  cancelTurn: vi.fn(),
}))
vi.mock("@tauri-apps/api/core", () => ({ invoke: mockInvoke }))
vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl: mockOpenUrl }))
vi.mock("@/lib/connectors/client", () => ({
  connectorGithub: mockConnectorGithub,
  connectorErrorKindToI18nKey: vi.fn(),
}))
vi.mock("@/lib/logger", () => ({
  logger: { debug: vi.fn(), error: vi.fn(), warn: vi.fn(), info: vi.fn() },
}))

import { InputBar } from "@/components/chat/InputBar"

const onSend = vi.fn().mockResolvedValue(true)
const onInterrupt = vi.fn()

beforeEach(() => {
  vi.clearAllMocks()
  onSend.mockResolvedValue(true)
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

function renderBar(props: Partial<Parameters<typeof InputBar>[0]> = {}) {
  return render(
    <InputBar
      onSend={onSend}
      onInterrupt={onInterrupt}
      githubAvailable={false}
      githubAttached={null}
      onOpenRepoPicker={vi.fn()}
      onCloseRepoPicker={vi.fn()}
      onAttachRepo={vi.fn()}
      onDetachRepo={vi.fn()}
      {...props}
    />,
  )
}

describe("InputBar — dépôt GitHub", () => {
  it("utilise l’icône connecteur locale et ouvre le sélecteur quand GitHub est prêt", () => {
    const onOpenRepoPicker = vi.fn()
    renderBar({ githubAvailable: true, onOpenRepoPicker })

    const button = screen.getByRole("button", { name: t.connectors.github })
    expect(button.querySelector('[data-testid="github-connecteur-icon"]')).not.toBeNull()

    fireEvent.click(button)
    expect(onOpenRepoPicker).toHaveBeenCalledTimes(1)
  })

  it("reste désactivé et explique comment configurer GitHub", () => {
    renderBar({ githubAvailable: false })

    const button = screen.getByRole("button", { name: t.connectors.github }) as HTMLButtonElement
    expect(button.disabled).toBe(true)
    expect(button.title).toBe("Configurez GitHub dans Paramètres généraux › Connecteurs")
  })

  it("affiche la puce attachée et détache sans rouvrir le sélecteur", () => {
    const onOpenRepoPicker = vi.fn()
    const onDetachRepo = vi.fn()
    renderBar({
      githubAvailable: true,
      githubAttached: { owner: "acme", name: "console", ref: "develop" },
      onOpenRepoPicker,
      onDetachRepo,
    })

    expect(screen.getByText("acme/console@develop")).toBeTruthy()
    fireEvent.click(screen.getByRole("button", { name: t.chat.detachGitHubRepo }))

    expect(onDetachRepo).toHaveBeenCalledTimes(1)
    expect(onOpenRepoPicker).not.toHaveBeenCalled()
  })

  it("marque la puce indisponible si le jeton a été retiré", () => {
    const onDetachRepo = vi.fn()
    renderBar({
      githubAvailable: false,
      githubAttached: { owner: "acme", name: "console", ref: "main" },
      onDetachRepo,
    })

    expect(screen.getByText(t.chat.githubRepoUnavailable)).toBeTruthy()
    expect((screen.getByRole("button", { name: t.connectors.github }) as HTMLButtonElement).disabled).toBe(true)
    fireEvent.click(screen.getByRole("button", { name: t.chat.detachGitHubRepo }))
    expect(onDetachRepo).toHaveBeenCalledTimes(1)
  })

  it("persiste la liaison choisie depuis le sélecteur", async () => {
    const onAttachRepo = vi.fn().mockResolvedValue(undefined)
    mockConnectorGithub.listRepos.mockResolvedValueOnce({
      repos: [
        {
          fullName: "acme/console",
          isPrivate: false,
          defaultBranch: "main",
          updatedAt: null,
        },
      ],
      page: 1,
      hasMore: false,
    })
    mockConnectorGithub.listBranches.mockResolvedValueOnce(["main", "develop"])

    renderBar({
      githubAvailable: true,
      isRepoPickerOpen: true,
      onAttachRepo,
    })

    await waitFor(() => expect(screen.getByText("acme/console")).toBeTruthy())
    fireEvent.click(screen.getByText("acme/console"))
    await waitFor(() => expect(mockConnectorGithub.listBranches).toHaveBeenCalledWith("acme", "console"))
    fireEvent.change(screen.getByLabelText(t.connectors.repoPicker.branch), {
      target: { value: "develop" },
    })
    fireEvent.click(screen.getByRole("button", { name: t.connectors.repoPicker.attach }))

    expect(onAttachRepo).toHaveBeenCalledWith({ owner: "acme", name: "console", ref: "develop" })
  })
})

describe("InputBar — fichiers texte", () => {
  it("import d'un .md : chip nommé, contenu lu via File.text", async () => {
    renderBar()
    const input = document.getElementById("text-file-upload") as HTMLInputElement
    const file = new File(["## Mode d'emploi"], "HISE.md", { type: "text/markdown" })
    Object.defineProperty(file, "text", { value: () => Promise.resolve("## Mode d'emploi") })
    fireEvent.change(input, { target: { files: [file] } })
    await waitFor(() => expect(screen.getByText("HISE.md")).toBeTruthy())
    fireEvent.change(screen.getByPlaceholderText(/Écrivez/), { target: { value: "Aide-moi" } })
    fireEvent.click(screen.getByRole("button", { name: /Envoyer/ }))
    await waitFor(() =>
      expect(onSend).toHaveBeenCalledWith(
        "Aide-moi",
        [expect.objectContaining({ kind: "text", name: "HISE.md", text: "## Mode d'emploi" })],
        { forceWeb: false },
      ),
    )
  })

  it("un fichier texte > 512 Ko est rejeté silencieusement", async () => {
    renderBar()
    const input = document.getElementById("text-file-upload") as HTMLInputElement
    const file = new File(["x"], "gros.md", { type: "text/markdown" })
    Object.defineProperty(file, "text", { value: () => Promise.resolve("x") })
    Object.defineProperty(file, "size", { value: 512 * 1024 + 1 })
    fireEvent.change(input, { target: { files: [file] } })
    await waitFor(() => expect(screen.queryByText("gros.md")).toBeNull())
    expect(onSend).not.toHaveBeenCalledWith(expect.anything(), expect.arrayContaining([expect.objectContaining({ name: "gros.md" })]))
  })

  it("les images continuent de partir en base64 (kind image), chemin historique inchangé", async () => {
    renderBar()
    const input = document.getElementById("image-upload") as HTMLInputElement
    const file = new File([new Uint8Array(1)], "shot.png", { type: "image/png" })
    fireEvent.change(input, { target: { files: [file] } })
    await waitFor(() => expect(screen.getByText("shot.png")).toBeTruthy())
    // La chip image rend un <img data:> — assert AVANT le submit (le vidage
    // optimiste retire les chips dès le clic Envoyer).
    const img = screen.getByAltText("shot.png") as HTMLImageElement
    expect(img.src).toContain("data:image/png")
    fireEvent.change(screen.getByPlaceholderText(/Écrivez/), { target: { value: "voici" } })
    fireEvent.click(screen.getByRole("button", { name: /Envoyer/ }))
    await waitFor(() =>
      expect(onSend).toHaveBeenCalledWith(
        "voici",
        [expect.objectContaining({ kind: "image", name: "shot.png" })],
        { forceWeb: false },
      ),
    )
  })

  it("transmet les dimensions de l’image sans modifier son aperçu", async () => {
    const close = vi.fn()
    vi.stubGlobal("createImageBitmap", vi.fn().mockResolvedValue({
      width: 1920,
      height: 1080,
      close,
    }))
    renderBar()
    const input = document.getElementById("image-upload") as HTMLInputElement
    const file = new File([new Uint8Array(1)], "dimensions.png", { type: "image/png" })

    fireEvent.change(input, { target: { files: [file] } })
    await waitFor(() => expect(screen.getByText("dimensions.png")).toBeTruthy())
    expect(screen.getByAltText("dimensions.png")).toBeTruthy()
    fireEvent.change(screen.getByPlaceholderText(/Écrivez/), { target: { value: "analyse" } })
    fireEvent.click(screen.getByRole("button", { name: /Envoyer/ }))

    await waitFor(() => expect(onSend).toHaveBeenCalledWith(
      "analyse",
      [expect.objectContaining({
        kind: "image",
        name: "dimensions.png",
        width: 1920,
        height: 1080,
      })],
      { forceWeb: false },
    ))
    expect(close).toHaveBeenCalledTimes(1)
  })
})

describe("InputBar — forçage Web ponctuel", () => {
  it("est inactif par défaut puis transmet forceWeb une seule fois après activation", async () => {
    renderBar({ webAvailable: true })
    const web = screen.getByRole("button", { name: "Forcer la recherche Web" })
    expect(web.getAttribute("aria-pressed")).toBe("false")
    fireEvent.click(web)
    expect(web.getAttribute("aria-pressed")).toBe("true")
    fireEvent.change(screen.getByPlaceholderText(/Écrivez/), { target: { value: "Actualité" } })
    fireEvent.click(screen.getByRole("button", { name: /Envoyer/ }))
    await waitFor(() => expect(onSend).toHaveBeenCalledWith("Actualité", [], { forceWeb: true }))
    await waitFor(() => expect(web.getAttribute("aria-pressed")).toBe("false"))
  })

  it("conserve le forçage et restaure le texte si send retourne false", async () => {
    onSend.mockResolvedValueOnce(false)
    renderBar({ webAvailable: true })
    const web = screen.getByRole("button", { name: "Forcer la recherche Web" })
    fireEvent.click(web)
    fireEvent.change(screen.getByPlaceholderText(/Écrivez/), { target: { value: "À garder" } })
    fireEvent.click(screen.getByRole("button", { name: /Envoyer/ }))
    await waitFor(() => expect((screen.getByPlaceholderText(/Écrivez/) as HTMLTextAreaElement).value).toBe("À garder"))
    expect(web.getAttribute("aria-pressed")).toBe("true")
  })

  it("est désactivé avec une explication si le Web est indisponible ou occupé", () => {
    const { rerender } = renderBar({ webAvailable: false, webUnavailableReason: "TinyFish indisponible" })
    const unavailable = screen.getByRole("button", { name: "Forcer la recherche Web" }) as HTMLButtonElement
    expect(unavailable.disabled).toBe(true)
    expect(unavailable.title).toBe("TinyFish indisponible")

    rerender(<InputBar onSend={onSend} onInterrupt={onInterrupt} webAvailable busy />)
    expect((screen.getByRole("button", { name: "Forcer la recherche Web" }) as HTMLButtonElement).disabled).toBe(true)
  })
})

describe("InputBar — détection d'URLs", () => {
  it("affiche les URLs détectées comme puces cliquables", async () => {
    renderBar()
    const textarea = screen.getByPlaceholderText(/Écrivez/)
    fireEvent.change(textarea, { target: { value: "Regarde https://example.com/page" } })
    await waitFor(() => expect(screen.getByText("https://example.com/page")).toBeTruthy())
    // Le lien est un listitem dans une liste, on le trouve via son texte
    const link = screen.getByText("https://example.com/page").closest("a") as HTMLAnchorElement
    expect(link).toBeTruthy()
    expect(link!.getAttribute("href")).toBe("https://example.com/page")
    expect(link!.getAttribute("target")).toBe("_blank")
  })

  it("affiche plusieurs URLs dédupliquées", async () => {
    renderBar()
    const textarea = screen.getByPlaceholderText(/Écrivez/)
    fireEvent.change(textarea, { target: { value: "https://a.com et https://b.org et https://a.com" } })
    await waitFor(() => {
      const list = screen.getByRole("list", { name: /Liens détectés/ })
      const links = list.querySelectorAll("a[role='listitem']")
      expect(links).toHaveLength(2)
      expect(links[0].getAttribute("href")).toMatch(/^https:\/\/a\.com\/?$/)
      expect(links[1].getAttribute("href")).toMatch(/^https:\/\/b\.org\/?$/)
    })
  })

  it("n'affiche rien sans URL", () => {
    renderBar()
    const textarea = screen.getByPlaceholderText(/Écrivez/)
    fireEvent.change(textarea, { target: { value: "Juste du texte sans lien" } })
    expect(screen.queryByRole("list", { name: /Liens détectés/ })).toBeNull()
  })

  it("les puces URLs ont les classes visuelles attendues", async () => {
    renderBar()
    const textarea = screen.getByPlaceholderText(/Écrivez/)
    fireEvent.change(textarea, { target: { value: "Voir https://test.com" } })
    await waitFor(() => {
      const list = screen.getByRole("list", { name: /Liens détectés/ })
      const link = list.querySelector("a[role='listitem']") as HTMLAnchorElement
      expect(link).toBeTruthy()
      expect(link!.classList.contains("text-[var(--brand-to)]")).toBe(true)
      expect(link!.classList.contains("border-[var(--brand-to)]/30")).toBe(true)
      expect(link!.classList.contains("bg-[var(--brand-to)]/10")).toBe(true)
    })
  })
})
