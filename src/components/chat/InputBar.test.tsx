// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react"
import { InputBar } from "./InputBar"

const onSend = vi.fn().mockResolvedValue(true)
const onInterrupt = vi.fn()

beforeEach(() => {
  vi.clearAllMocks()
  onSend.mockResolvedValue(true)
})

afterEach(cleanup)

function renderBar(props: Partial<Parameters<typeof InputBar>[0]> = {}) {
  return render(<InputBar onSend={onSend} onInterrupt={onInterrupt} {...props} />)
}

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
      ),
    )
  })
})
