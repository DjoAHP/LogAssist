// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest"
import { render, screen, fireEvent, cleanup } from "@testing-library/react"
import { ProviderCard } from "./ProviderCard"
import { type ProviderRow } from "@/lib/db/providers"
import { t } from "@/i18n/fr"

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
    expect(testButton.getAttribute("data-action")).toBe("test")

    const fetchButton = screen.getByRole("button", { name: t.settings.fetchModels })
    expect(fetchButton.getAttribute("type")).toBe("button")
    expect(fetchButton.getAttribute("data-action")).toBe("fetch-models")

    const editButton = screen.getByRole("button", { name: t.settings.edit })
    expect(editButton.getAttribute("type")).toBe("button")
    expect(editButton.getAttribute("data-action")).toBe("edit")

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