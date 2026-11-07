// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react"
import { AssistantDialog } from "./AssistantDialog"

function hasClass(element: HTMLElement | null, className: string): boolean {
  return element?.classList.contains(className) ?? false
}

const mockGet = vi.hoisted(() => vi.fn())
const mockSetPrompt = vi.hoisted(() => vi.fn())
const mockKList = vi.hoisted(() => vi.fn())
const mockKAdd = vi.hoisted(() => vi.fn())
const mockKSetEnabled = vi.hoisted(() => vi.fn())
const mockKRemove = vi.hoisted(() => vi.fn())
const mockKUpdate = vi.hoisted(() => vi.fn())

vi.mock("@/lib/prompts/store", () => ({
  loadPromptSettings: vi.fn(() => Promise.resolve({ general: mockGet() === null ? "Défaut general" : "Custom general", profile: "Défaut profil" })),
  savePromptSettings: mockSetPrompt,
  PROMPT_KEYS: { general: "prompt.general", profile: "prompt.profile" },
}))
vi.mock("@/lib/prompts/defaults", () => ({
  DEFAULT_GENERAL_INSTRUCTIONS: "Défaut general",
  PROFILE_APPRENTISSAGE: "Défaut profil",
}))
vi.mock("@/lib/db/knowledge", () => ({
  knowledge: {
    list: mockKList,
    add: mockKAdd,
    setEnabled: mockKSetEnabled,
    remove: mockKRemove,
    update: mockKUpdate,
  },
}))

const rows = [
  { id: "k1", name: "HISE", content: "## HISE mode d'emploi", enabled: 1, created_at: "2026-01-01" },
  { id: "k2", name: "Resolve", content: "## Resolve", enabled: 0, created_at: "2026-01-02" },
]

beforeEach(() => {
  vi.clearAllMocks()
  mockKList.mockResolvedValue(rows)
  mockKAdd.mockResolvedValue(rows[0])
  mockKSetEnabled.mockResolvedValue(undefined)
  mockKRemove.mockResolvedValue(undefined)
  mockKUpdate.mockResolvedValue(undefined)
  mockGet.mockReturnValue(null)
})

afterEach(cleanup)

describe("AssistantDialog", () => {
  it("utilise le gabarit standard des outils du header", () => {
    render(<AssistantDialog onClose={() => {}} conversationId={null} />)

    const dialog = screen.getByRole("dialog")
    expect(hasClass(dialog, "h-[75vh]")).toBe(true)
    expect(hasClass(dialog, "w-[1100px]")).toBe(true)
    expect(hasClass(dialog, "max-w-[96vw]")).toBe(true)
    expect(screen.getByRole("heading", { name: "Assistant" })).not.toBeNull()
    expect(screen.getByTestId("assistant-dialog-icon")).not.toBeNull()
  })

  it("affiche les 3 sections avec les valeurs chargées", async () => {
    render(<AssistantDialog onClose={() => {}} conversationId="test-conv" />)
    const general = await screen.findByLabelText(/Instructions générales/) as HTMLTextAreaElement
    expect(general.value).toBe("Défaut general")
    expect((screen.getByLabelText(/Profil/) as HTMLTextAreaElement).value).toBe("Défaut profil")
    expect(await screen.findByText("HISE")).toBeTruthy()
    expect(screen.getByText("Resolve")).toBeTruthy()
  })

  it("Enregistrer sauvegarde les deux sections éditées", async () => {
    render(<AssistantDialog onClose={() => {}} conversationId="test-conv" />)
    const general = await screen.findByLabelText(/Instructions générales/)
    fireEvent.change(general, { target: { value: "Nouveau general" } })
    fireEvent.click(screen.getByRole("button", { name: "Enregistrer le prompt" }))
    await waitFor(() =>
      expect(mockSetPrompt).toHaveBeenCalledWith({ general: "Nouveau general", profile: "Défaut profil" }),
    )
  })

  it("Restaurer les défauts remet les textes par défaut", async () => {
    render(<AssistantDialog onClose={() => {}} conversationId="test-conv" />)
    const general = await screen.findByLabelText(/Instructions générales/) as HTMLTextAreaElement
    fireEvent.change(general, { target: { value: "Modifié" } })
    fireEvent.click(screen.getByRole("button", { name: "Restaurer les défauts" }))
    expect(general.value).toBe("Défaut general")
  })

  it("l'interrupteur d'une connaissance alterne enabled", async () => {
    render(<AssistantDialog onClose={() => {}} conversationId="test-conv" />)
    const HISE = await screen.findByText("HISE")
    const article = HISE.closest("article")!
    const checkbox = article.querySelector('input[type="checkbox"]') as HTMLInputElement
    expect(checkbox.checked).toBe(true)
    fireEvent.click(checkbox)
    await waitFor(() => expect(mockKSetEnabled).toHaveBeenCalledWith("k1", false))
  })

  it("supprimer une connaissance passe par knowledge.remove", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true)
    render(<AssistantDialog onClose={() => {}} conversationId="test-conv" />)
    const Resolve = await screen.findByText("Resolve")
    const article = Resolve.closest("article")!
    fireEvent.click(article.querySelector('[aria-label="Supprimer"]')!)
    await waitFor(() => expect(mockKRemove).toHaveBeenCalledWith("k2"))
  })

  it("Ajouter connaissance : nom + fichier .md importé + enregistrer", async () => {
    render(<AssistantDialog onClose={() => {}} conversationId="test-conv" />)
    fireEvent.click(await screen.findByRole("button", { name: "Ajouter connaissance" }))
    fireEvent.change(await screen.findByLabelText("Nom de la connaissance"), { target: { value: "HISE" } })
    // Import fichier : File.text() retourne le markdown
    const file = new File(["## HISE v1.2"], "HISE.md", { type: "text/markdown" })
    const input = (await screen.findByLabelText("Fichier .md")) as HTMLInputElement
    Object.defineProperty(file, "text", { value: () => Promise.resolve("## HISE v1.2") })
    fireEvent.change(input, { target: { files: [file] } })
    const content = await screen.findByLabelText("Contenu markdown")
    await waitFor(() => expect((content as HTMLTextAreaElement).value).toContain("## HISE v1.2"))
    fireEvent.click(screen.getByRole("button", { name: "Enregistrer la connaissance" }))
    await waitFor(() => expect(mockKAdd).toHaveBeenCalledWith("HISE", "## HISE v1.2"))
  })

  it("modifier une connaissance existante passe par knowledge.update", async () => {
    render(<AssistantDialog onClose={() => {}} conversationId="test-conv" />)
    const HISE = await screen.findByText("HISE")
    const article = HISE.closest("article")!
    fireEvent.click(article.querySelector('[aria-label="Modifier"]')!)
    const content = await screen.findByLabelText("Contenu markdown")
    fireEvent.change(content, { target: { value: "content markdown" } })
    fireEvent.click(screen.getByRole("button", { name: "Enregistrer la connaissance" }))
    await waitFor(() =>
      // Upsert complet : name non vide + content (name inchangé = no-op SQL).
      expect(mockKUpdate).toHaveBeenCalledWith("k1", { name: "HISE", content: "content markdown" }),
    )
  })
})
