// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { render, screen, cleanup } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { ChatView } from "./ChatView"
import type { ChatMessageVM } from "@/hooks/useChat"

beforeEach(() => {
  vi.clearAllMocks()
  // jsdom n'a pas scrollIntoView (ChatView auto-scroll)
  Element.prototype.scrollIntoView = Element.prototype.scrollIntoView ?? (() => {})
})
afterEach(cleanup)

const base = {
  hasModel: true,
  showConversation: true,
  systemPrompt: "test prompt",
  activeModel: null,
  conversationId: null,
}

const msg = (over: Partial<ChatMessageVM>): ChatMessageVM => ({
  role: "user",
  content: "contenu",
  attachments: [
    { id: "a1", kind: "text", base64: "", mimeType: "text/markdown", name: "HISE.md" },
  ],
  ...over,
})

describe("ChatView — pièces jointes texte", () => {
  it("une pièce jointe texte rend un chip fichier, pas un <img> cassé", () => {
    render(<ChatView {...base} vm={[msg({})]} />)
    expect(screen.getByText("HISE.md")).toBeTruthy()
    // Pas de <img> avec src vide dans la bulle
    expect(document.querySelector("img[src], img")).toBeNull()
  })

  it("une pièce jointe image continue de rendre son aperçu (src data natif)", () => {
    render(
      <ChatView
        {...base}
        vm={[msg({ attachments: [{ id: "a1", kind: "image", base64: "AAAA", mimeType: "image/png", name: "shot.png" }] })]}
      />,
    )
    const img = screen.getByAltText("shot.png") as HTMLImageElement
    expect(img.getAttribute("src")).toContain("data:image/png")
  })
})

describe("ChatView — rendu markdown des réponses assistant", () => {
  it("les titres, gras et listes markdown sont rendus en éléments HTML", () => {
    render(
      <ChatView
        {...base}
        vm={[msg({ role: "assistant", content: "## Titre\n\n**gras** et texte\n\n- item un\n- item deux" })]}
      />,
    )
    expect(screen.getByRole("heading", { level: 2 }).textContent).toContain("Titre")
    expect(screen.getByText("gras").tagName).toBe("STRONG")
    const items = screen.getAllByRole("listitem")
    expect(items).toHaveLength(2)
  })

  it("un tableau GFM est rendu avec en-têtes et cellules", () => {
    render(
      <ChatView
        {...base}
        vm={[msg({ role: "assistant", content: "| A | B |\n|---|---|\n| 1 | 2 |" })]}
      />,
    )
    expect(screen.getByRole("table")).toBeTruthy()
    expect(screen.getByRole("columnheader", { name: "A" })).toBeTruthy()
    expect(screen.getByRole("cell", { name: "2" })).toBeTruthy()
  })

  it("un bloc de code est rendu avec un bouton Copier qui copie son contenu", async () => {
    // Ordre imposé : userEvent.setup() installe son stub Clipboard sur
    // navigator.clipboard (absent de jsdom 29) — on espionne APRÈS le setup.
    const user = userEvent.setup()
    const writeText = vi.spyOn(navigator.clipboard, "writeText").mockResolvedValue(undefined)
    render(
      <ChatView
        {...base}
        vm={[msg({ role: "assistant", content: "Avant\n\n```js\nconst x = 1\n```\n\nAprès" })]}
      />,
    )
    // rehype-highlight morcelle le code en spans : on lit textContent
    const codeEl = document.querySelector(".md-body pre code")
    expect(codeEl?.textContent).toContain("const x = 1")
    await user.click(screen.getByRole("button", { name: "Copier" }))
    // Le \n final fait partie du bloc markdown (avant la fence de fermeture)
    expect(writeText).toHaveBeenCalledWith("const x = 1\n")
  })

  it("le HTML brut d'une réponse LLM est échappé, jamais exécuté (invariant sécurité)", () => {
    render(
      <ChatView
        {...base}
        vm={[msg({ role: "assistant", content: '<img src=x onerror="alert(1)"> et <script>evil()</script>' })]}
      />,
    )
    // Aucune balise réelle injectée : le contenu n'apparaît que comme texte
    expect(document.querySelector("img[src='x']")).toBeNull()
    expect(document.querySelector("script")).toBeNull()
    expect(screen.getByText(/alert\(1\)/)).toBeTruthy()
  })

  it("les messages utilisateur restent en texte brut (pas de markdown)", () => {
    render(<ChatView {...base} vm={[msg({ role: "user", content: "##pas un titre\n- liste" })]} />)
    expect(screen.queryByRole("heading")).toBeNull()
    expect(screen.queryByRole("list")).toBeNull()
    expect(screen.getByText(/##pas un titre/)).toBeTruthy()
  })

  it("le markdown partiel du streaming ne lève pas d'erreur (bloc code non fermé)", () => {
    render(
      <ChatView
        {...base}
        vm={[msg({ role: "assistant", content: "Voici :\n\n```py\ndef f(" })]}
      />,
    )
    const pre = document.querySelector(".md-body pre")
    expect(pre?.textContent).toContain("def f(")
  })
})
