// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest"
import { render, screen, fireEvent, cleanup } from "@testing-library/react"
import { ProviderCard } from "./ProviderCard"
import { type ProviderRow } from "@/lib/db/providers"
import { t } from "@/i18n/fr"

function hasClass(element: HTMLElement | SVGElement | null, className: string): boolean {
  return element?.classList.contains(className) ?? false
}

const mockOnTest = vi.fn()
const mockOnFetchModels = vi.fn()
const mockOnEdit = vi.fn()
const mockOnDelete = vi.fn()
const mockOnBrowseModels = vi.fn()

const testProvider: ProviderRow = {
  id: "provider-1",
  name: "Ollama local avec un nom long",
  api_family: "openai",
  base_url: "http://localhost:11434/v1",
  created_at: "2026-01-01",
}

const defaultProps = {
  provider: testProvider,
  modelCount: 5,
  connectionStatus: { state: "idle" as const },
  fetchStatus: undefined,
  onTest: mockOnTest,
  onFetchModels: mockOnFetchModels,
  onEdit: mockOnEdit,
  onDelete: mockOnDelete,
  onBrowseModels: mockOnBrowseModels,
}

afterEach(() => {
  vi.clearAllMocks()
  cleanup()
})

describe("ProviderCard", () => {
  it("affiche l'identité et le compteur sans intégrer la liste des modèles", () => {
    const { container } = render(<ProviderCard {...defaultProps} />)

    // Vérifie le nom du fournisseur
    expect(screen.getByText("Ollama local avec un nom long")).not.toBeNull()

    // Vérifie l'URL (tronquée dans l'affichage mais complète dans le title)
    const urlElement = screen.getByText("http://localhost:11434/v1")
    expect(urlElement).not.toBeNull()

    // Vérifie le compteur de modèles (texte dans le bouton principal)
    const browseButton = screen.getByRole("button", { name: /Parcourir les modèles \(5\)/ })
    expect(browseButton).not.toBeNull()

    // Vérifie qu'il n'y a PAS de liste <ul> des modèles
    expect(screen.queryByRole("list")).toBeNull()
    expect(container.querySelector("ul")).toBeNull()
  })

  it("expose l'URL complète et des boutons explicites", () => {
    render(<ProviderCard {...defaultProps} />)

    // Vérifie que l'URL a un title avec l'URL complète
    const urlElement = screen.getByText("http://localhost:11434/v1")
    expect(urlElement.getAttribute("title")).toBe("http://localhost:11434/v1")

    // Vérifie les 4 boutons d'action avec type="button"
    const testButton = screen.getByRole("button", { name: t.settings.test })
    expect(testButton.getAttribute("type")).toBe("button")
    expect(testButton.getAttribute("data-action")).toBe("test-connection")

    const fetchButton = screen.getByRole("button", { name: t.settings.fetchModels })
    expect(fetchButton.getAttribute("type")).toBe("button")
    expect(fetchButton.getAttribute("data-action")).toBe("fetch-models")

    const editButton = screen.getByRole("button", { name: t.settings.edit })
    expect(editButton.getAttribute("type")).toBe("button")
    expect(editButton.getAttribute("data-action")).toBe("edit-provider")

    const deleteButton = screen.getByRole("button", { name: t.settings.delete })
    expect(deleteButton.getAttribute("type")).toBe("button")
    expect(deleteButton.getAttribute("data-action")).toBe("delete")

    // Vérifie le bouton principal "Parcourir les modèles"
    const browseButton = screen.getByRole("button", { name: `${t.settings.browseModels} (5)` })
    expect(browseButton.getAttribute("type")).toBe("button")
    expect(browseButton.getAttribute("data-action")).toBe("browse-models")
  })

  it("délègue chaque commande au callback correspondant", () => {
    render(<ProviderCard {...defaultProps} />)

    // Clic sur Test
    fireEvent.click(screen.getByRole("button", { name: t.settings.test }))
    expect(mockOnTest).toHaveBeenCalledTimes(1)

    // Clic sur Récupérer les modèles
    fireEvent.click(screen.getByRole("button", { name: t.settings.fetchModels }))
    expect(mockOnFetchModels).toHaveBeenCalledTimes(1)

    // Clic sur Modifier
    fireEvent.click(screen.getByRole("button", { name: t.settings.edit }))
    expect(mockOnEdit).toHaveBeenCalledTimes(1)

    // Clic sur Supprimer
    fireEvent.click(screen.getByRole("button", { name: t.settings.delete }))
    expect(mockOnDelete).toHaveBeenCalledTimes(1)

    // Clic sur Parcourir les modèles
    fireEvent.click(screen.getByRole("button", { name: `${t.settings.browseModels} (5)` }))
    expect(mockOnBrowseModels).toHaveBeenCalledTimes(1)
  })
})

describe("ProviderCard — états des actions", () => {
  it("désactive et annonce uniquement le test pendant la connexion", () => {
    render(<ProviderCard {...defaultProps} connectionStatus={{ state: "testing" }} />)

    const testButton = screen.getByRole("button", { name: t.settings.test }) as HTMLButtonElement
    const fetchButton = screen.getByRole("button", { name: t.settings.fetchModels }) as HTMLButtonElement
    const status = screen.getByTestId("test-connection-status")

    expect(testButton.disabled).toBe(true)
    expect(testButton.getAttribute("aria-busy")).toBe("true")
    expect(fetchButton.disabled).toBe(false)
    expect(status.textContent).toBe(t.settings.testing)
    expect(status.getAttribute("aria-live")).toBe("polite")
  })

  it("affiche le succès de connexion dans la cellule de test", () => {
    render(<ProviderCard {...defaultProps} connectionStatus={{ state: "ok" }} />)

    const status = screen.getByTestId("test-connection-status")
    expect(status.textContent).toBe(t.settings.ok)
    expect(status.closest('[data-state="success"]')).not.toBeNull()
  })

  it("affiche l'échec de récupération sans désactiver les autres actions", () => {
    render(<ProviderCard
      {...defaultProps}
      fetchStatus={{ state: "fail", message: t.settings.noKey }}
    />)

    const status = screen.getByTestId("fetch-models-status")
    const testButton = screen.getByRole("button", { name: t.settings.test }) as HTMLButtonElement

    expect(status.textContent).toContain(t.settings.fetchFail)
    expect(status.textContent).toContain(t.settings.noKey)
    expect(status.closest('[data-state="error"]')).not.toBeNull()
    expect(testButton.disabled).toBe(false)
  })

  it("annonce le nombre de modèles récupérés", () => {
    render(<ProviderCard {...defaultProps} fetchStatus={{ state: "ok", added: 2 }} />)

    expect(screen.getByTestId("fetch-models-status").textContent)
      .toBe(`2 ${t.settings.fetchOkAdded}`)
  })
})

describe("ProviderCard — proportions et couleurs (TDD)", () => {
  it("normalise les trois icônes dans la même empreinte visuelle", () => {
    render(<ProviderCard {...defaultProps} />)

    // Vérifier chaque bouton d'action a son wrapper optique
    const testIconFrame = screen.getByTestId("test-connection-icon-frame")
    const fetchIconFrame = screen.getByTestId("fetch-models-icon-frame")
    const editIconFrame = screen.getByTestId("edit-provider-icon-frame")

    // Wrapper compact : size-6, items-center, justify-center
    expect(hasClass(testIconFrame, "size-6")).toBe(true)
    expect(hasClass(testIconFrame, "items-center")).toBe(true)
    expect(hasClass(testIconFrame, "justify-center")).toBe(true)
    expect(hasClass(fetchIconFrame, "size-6")).toBe(true)
    expect(hasClass(fetchIconFrame, "items-center")).toBe(true)
    expect(hasClass(fetchIconFrame, "justify-center")).toBe(true)
    expect(hasClass(editIconFrame, "size-6")).toBe(true)
    expect(hasClass(editIconFrame, "items-center")).toBe(true)
    expect(hasClass(editIconFrame, "justify-center")).toBe(true)

    // SVG à l'intérieur : size-5, strokeWidth=2
    const testSvg = testIconFrame.querySelector("svg")
    const fetchSvg = fetchIconFrame.querySelector("svg")
    const editSvg = editIconFrame.querySelector("svg")
    expect(hasClass(testSvg, "size-5")).toBe(true)
    expect(hasClass(fetchSvg, "size-5")).toBe(true)
    expect(hasClass(editSvg, "size-5")).toBe(true)
  })

  it("répartit les trois conteneurs d'action sur des colonnes identiques", () => {
    render(<ProviderCard {...defaultProps} />)

    // Le groupe d'actions doit être une grille 3 colonnes
    const actionsGroup = screen.getByTestId("provider-actions")
    expect(hasClass(actionsGroup, "grid")).toBe(true)
    expect(hasClass(actionsGroup, "grid-cols-3")).toBe(true)
    expect(hasClass(actionsGroup, "flex")).toBe(false)

    // Chaque conteneur d'action (parent [data-state]) doit être w-full
    const testContainer = screen.getByRole("button", { name: t.settings.test }).closest("[data-state]") as HTMLElement
    const fetchContainer = screen.getByRole("button", { name: t.settings.fetchModels }).closest("[data-state]") as HTMLElement
    const editContainer = screen.getByRole("button", { name: t.settings.edit }).closest("[data-state]") as HTMLElement
    expect(hasClass(testContainer, "w-full")).toBe(true)
    expect(hasClass(fetchContainer, "w-full")).toBe(true)
    expect(hasClass(editContainer, "w-full")).toBe(true)
  })

  it("compacte la zone d'action sans sacrifier la zone de statut", () => {
    render(<ProviderCard {...defaultProps} />)

    // Bouton test compact pour une carte sur quatre colonnes.
    const testButton = screen.getByRole("button", { name: t.settings.test })
    expect(hasClass(testButton, "min-h-24")).toBe(true)
    expect(hasClass(testButton, "pb-8")).toBe(true)
    expect(hasClass(testButton, "pt-2.5")).toBe(true)
    expect(hasClass(testButton, "min-h-28")).toBe(false)
    expect(hasClass(testButton, "pb-10")).toBe(false)
    expect(hasClass(testButton, "pt-3")).toBe(false)

    // Statut test : min-h-7, bottom-1.5, line-clamp-2 (pas min-h-8, line-clamp-3)
    const testStatus = screen.getByTestId("test-connection-status")
    expect(hasClass(testStatus, "min-h-6")).toBe(true)
    expect(hasClass(testStatus, "bottom-1")).toBe(true)
    expect(hasClass(testStatus, "line-clamp-2")).toBe(true)
    expect(hasClass(testStatus, "min-h-7")).toBe(false)
    expect(hasClass(testStatus, "line-clamp-3")).toBe(false)

    // Carte et CTA compactés.
    const card = screen.getByTestId("provider-card")
    expect(hasClass(card, "min-h-56")).toBe(true)
    expect(hasClass(card, "p-2.5")).toBe(true)
    expect(hasClass(card, "min-h-64")).toBe(false)

    // Bouton browse : absence de mt-auto
    const browseButton = screen.getByRole("button", { name: `${t.settings.browseModels} (5)` })
    expect(hasClass(browseButton, "mt-auto")).toBe(false)
    expect(hasClass(browseButton, "py-1.5")).toBe(true)
    expect(hasClass(browseButton, "text-xs")).toBe(true)
  })

  it("conserve un texte lisible sur le bouton modèles dans les deux thèmes", () => {
    render(<ProviderCard {...defaultProps} />)

    const browseButton = screen.getByRole("button", { name: `${t.settings.browseModels} (5)` })

    // Texte foreground standard (pas brand-foreground)
    expect(hasClass(browseButton, "text-foreground")).toBe(true)
    expect(hasClass(browseButton, "text-brand-foreground")).toBe(false)

    // Pas de hover:bg-brand-from/10
    expect(hasClass(browseButton, "hover:bg-brand-from/10")).toBe(false)

    // Hover : bg-foreground/5, text-brand-to, border-brand-to
    expect(hasClass(browseButton, "hover:bg-foreground/5")).toBe(true)
    expect(hasClass(browseButton, "hover:text-brand-to")).toBe(true)
    expect(hasClass(browseButton, "hover:border-brand-to")).toBe(true)
  })
})
