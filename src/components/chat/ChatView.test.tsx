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

describe("ChatView — latence en secondes", () => {
  it("14500 ms s'affiche « 14,5 s » (pas de « ms »)", () => {
    render(
      <ChatView {...base} vm={[msg({ role: "assistant", content: "réponse", latencyMs: 14500 })]} />,
    )
    expect(screen.getByText("14,5 s")).toBeTruthy()
    expect(screen.queryByText(/ms$/)).toBeNull()
  })

  it("420 ms s'affiche « 0,4 s » (format français)", () => {
    render(
      <ChatView {...base} vm={[msg({ role: "assistant", content: "réponse", latencyMs: 420 })]} />,
    )
    expect(screen.getByText("0,4 s")).toBeTruthy()
  })
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

describe("ChatView — accès Web", () => {
  it.each([
    ["searching", "Recherche sur le Web…"],
    ["fetching", "Lecture de la page…"],
  ] as const)("affiche le statut %s dans une bulle assistant vide", (webStatus, label) => {
    render(<ChatView {...base} vm={[msg({ role: "assistant", content: "", webStatus })]} />)
    expect(screen.getByRole("status").textContent).toContain(label)
  })

  it("ne remplace pas un texte déjà streamé par le statut", () => {
    render(<ChatView {...base} vm={[msg({ role: "assistant", content: "Début", webStatus: "searching" })]} />)
    expect(screen.getByText("Début")).toBeTruthy()
    expect(screen.queryByText("Recherche sur le Web…")).toBeNull()
  })

  it("rend avertissement et sources dédupliquées comme liens sûrs", () => {
    render(
      <ChatView
        {...base}
        vm={[msg({
          role: "assistant",
          content: "Réponse",
          webWarning: "Recherche incomplète",
          sources: [
            { url: "https://example.com", title: '<img src=x onerror="alert(1)">', origin: "search" },
            { url: "https://example.com", title: "Doublon", origin: "search" },
          ],
        })]}
      />,
    )
    expect(screen.getByText("Recherche incomplète")).toBeTruthy()
    const links = screen.getAllByRole("link") as HTMLAnchorElement[]
    expect(links).toHaveLength(1)
    expect(links[0].href).toBe("https://example.com/")
    expect(links[0].target).toBe("_blank")
    expect(links[0].rel).toBe("noreferrer")
    expect(document.querySelector("img[src='x']")).toBeNull()
    expect(links[0].textContent).toContain("<img src=x")
  })

  it("refuse les protocoles de source non Web même dans un historique corrompu", () => {
    render(
      <ChatView
        {...base}
        vm={[msg({
          role: "assistant",
          content: "Réponse",
          sources: [
            { url: "javascript:alert(1)", title: "JS", origin: "search" },
            { url: "file:///etc/passwd", title: "Fichier", origin: "fetch_content" },
          ],
        })]}
      />,
    )
    expect(screen.queryByRole("link")).toBeNull()
  })
})

describe("ChatView — bouton copier du message", () => {
  it("la réponse assistant est copiée depuis le bouton du message", async () => {
    // Ordre imposé (cf. test bloc de code) : setup d'abord, spy ensuite.
    const user = userEvent.setup()
    const writeText = vi.spyOn(navigator.clipboard, "writeText").mockResolvedValue(undefined)
    render(
      <ChatView {...base} vm={[msg({ role: "assistant", content: "## Titre\n\nparagraphe" })]} />,
    )
    await user.click(screen.getByRole("button", { name: "Copier le message" }))
    expect(writeText).toHaveBeenCalledWith("## Titre\n\nparagraphe")
  })

  it("le message utilisateur est copié tel quel", async () => {
    const user = userEvent.setup()
    const writeText = vi.spyOn(navigator.clipboard, "writeText").mockResolvedValue(undefined)
    render(<ChatView {...base} vm={[msg({ role: "user", content: "ma question ##pas un titre" })]} />)
    await user.click(screen.getByRole("button", { name: "Copier le message" }))
    expect(writeText).toHaveBeenCalledWith("ma question ##pas un titre")
  })

  it("le bouton passe en retour visuel « Message copié » puis revient", async () => {
    // Timers réels et attente de 1,6 s (> 1500 ms) : les fake timers de
    // vitest pend avec userEvent dans cette pile (vitest v5 + jsdom).
    const user = userEvent.setup()
    const writeText = vi.spyOn(navigator.clipboard, "writeText").mockResolvedValue(undefined)
    render(<ChatView {...base} vm={[msg({ role: "assistant", content: "réponse" })]} />)
    await user.click(screen.getByRole("button", { name: "Copier le message" }))
    expect(screen.getByRole("button", { name: "Message copié" })).toBeTruthy()
    await new Promise((r) => setTimeout(r, 1600))
    expect(screen.getByRole("button", { name: "Copier le message" })).toBeTruthy()
  })

  it("un échec du presse-papiers ne casse pas l'UI", async () => {
    const user = userEvent.setup()
    vi.spyOn(navigator.clipboard, "writeText").mockRejectedValue(new Error("denied"))
    render(<ChatView {...base} vm={[msg({ role: "assistant", content: "réponse" })]} />)
    await user.click(screen.getByRole("button", { name: "Copier le message" }))
    expect(screen.getByRole("button", { name: "Copier le message" })).toBeTruthy()
  })

  it("pas de bouton copier sur un message sans contenu", () => {
    render(<ChatView {...base} vm={[msg({ role: "assistant", content: "" })]} />)
    expect(screen.queryByRole("button", { name: "Copier le message" })).toBeNull()
  })
})
