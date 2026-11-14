// @vitest-environment jsdom
// ModelPickerModal — parcourt du modèle fournisseur :
// liste complète en modal, recherche, ajout textuel, clic = activation (pas d'appels DB ici :
// composant muet, la persistance est le rôle du parent).
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { render, screen, fireEvent, cleanup } from "@testing-library/react"
import { ModelPickerModal, type PickerModel } from "./ModelPickerModal"

const models: PickerModel[] = [
  { id: "mid-a", label: "openai/gpt-4o", isDefault: true, contextWindowOverride: 128000, maxOutputTokensOverride: 4096 },
  { id: "mid-b", label: "anthropic/claude-3.5-sonnet", isDefault: false, contextWindowOverride: null, maxOutputTokensOverride: null },
  { id: "mid-c", label: "meta-llama/llama-3.1-70b-instruct", isDefault: false, contextWindowOverride: null, maxOutputTokensOverride: null },
]

const baseProps = {
  providerName: "OpenRouter",
  models,
  onClose: vi.fn(),
  onSelect: vi.fn(),
  onAddModel: vi.fn(),
  onConfigure: vi.fn(),
}

beforeEach(() => {
  vi.clearAllMocks()
})

afterEach(cleanup)

function renderModal(overrides: Partial<typeof baseProps> = {}) {
  return render(<ModelPickerModal {...baseProps} {...overrides} />)
}

describe("ModelPickerModal", () => {
  it("affiche le fournisseur, le compteur et la liste complète", () => {
    renderModal()
    expect(screen.getByRole("dialog", { name: "Parcourir les modèles — OpenRouter" })).not.toBeNull()
    expect(screen.getByText("(3)")).not.toBeNull()
    expect(screen.getByText("openai/gpt-4o")).not.toBeNull()
    expect(screen.getByText("anthropic/claude-3.5-sonnet")).not.toBeNull()
    expect(screen.getByText("meta-llama/llama-3.1-70b-instruct")).not.toBeNull()
  })

  it("la recherche filtre la liste (sous-chaîne insensible à la casse)", async () => {
    renderModal()
    fireEvent.change(screen.getByLabelText("Filtrer les modèles…"), { target: { value: "CLAUDE" } })
    expect(screen.getByText("anthropic/claude-3.5-sonnet")).not.toBeNull()
    expect(screen.queryByText("openai/gpt-4o")).toBeNull()
  })

  it("l'ajout textuel délègue onAddModel puis vide le champ", async () => {
    const { waitFor } = await import("@testing-library/react")
    renderModal()
    const input = screen.getByLabelText("Ajouter un modèle")
    fireEvent.change(input, { target: { value: "openai/nouveau-modele" } })
    fireEvent.click(screen.getByRole("button", { name: "Ajouter le modèle" }))
    expect(baseProps.onAddModel).toHaveBeenCalledWith("openai/nouveau-modele")
    await waitFor(() => expect((input as HTMLInputElement).value).toBe(""))
  })

  it("clic sur un modèle → onSelect avec l'id de ligne", () => {
    renderModal()
    fireEvent.click(screen.getByText("anthropic/claude-3.5-sonnet"))
    expect(baseProps.onSelect).toHaveBeenCalledWith("mid-b")
    expect(baseProps.onClose).not.toHaveBeenCalled() // la fermeture est le rôle du parent
  })

  it("ouvre le réglage de contexte sans activer le modèle", () => {
    renderModal()
    fireEvent.click(screen.getByRole("button", {
      name: "Contexte du modèle — anthropic/claude-3.5-sonnet",
    }))

    expect(baseProps.onConfigure).toHaveBeenCalledWith(models[1])
    expect(baseProps.onSelect).not.toHaveBeenCalled()
  })

  it("le modèle actif est repéré (étoile) et Alone le clic reste possible", () => {
    renderModal()
    // l'étoile est un aria-label "Modèle actif" sur le badge du défaut
    expect(screen.getByLabelText("Modèle actif")).not.toBeNull()
  })

  it("aucun modèle : message vide", () => {
    renderModal({ models: [] })
    expect(
      screen.getByText("Aucun modèle — ajoutez l'identifiant du modèle chez ce fournisseur."),
    ).not.toBeNull()
  })
})
