// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { act, render, screen, cleanup, fireEvent } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { ChatView } from "./ChatView"
import type { ChatMessageVM } from "@/hooks/useChat"

const originalScrollTo = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "scrollTo")

beforeEach(() => {
  vi.clearAllMocks()
  Object.defineProperty(HTMLElement.prototype, "scrollTo", {
    configurable: true,
    writable: true,
    value: vi.fn(),
  })
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  if (originalScrollTo) {
    Object.defineProperty(HTMLElement.prototype, "scrollTo", originalScrollTo)
  } else {
    delete (HTMLElement.prototype as { scrollTo?: HTMLElement["scrollTo"] }).scrollTo
  }
})

const base = {
  hasModel: true,
  showConversation: true,
}

const msg = (over: Partial<ChatMessageVM>): ChatMessageVM => ({
  role: "user",
  content: "contenu",
  attachments: [
    { id: "a1", kind: "text", base64: "", mimeType: "text/markdown", name: "HISE.md" },
  ],
  ...over,
})

function setScrollMetrics(
  element: HTMLElement,
  metrics: { scrollTop: number; clientHeight: number; scrollHeight: number },
): void {
  Object.defineProperties(element, {
    scrollTop: { configurable: true, writable: true, value: metrics.scrollTop },
    clientHeight: { configurable: true, value: metrics.clientHeight },
    scrollHeight: { configurable: true, value: metrics.scrollHeight },
  })
}

function mockReducedMotion(matches: boolean): void {
  vi.stubGlobal("matchMedia", vi.fn().mockReturnValue({ matches }))
}

interface ResizeObserverHarness {
  trigger: (height: number) => void
  disconnect: ReturnType<typeof vi.fn>
}

function installResizeObserverMock(): ResizeObserverHarness {
  let callback: ResizeObserverCallback | undefined
  let observedElement: Element | undefined
  const disconnect = vi.fn()

  class FakeResizeObserver {
    constructor(nextCallback: ResizeObserverCallback) {
      callback = nextCallback
    }

    observe(element: Element): void {
      observedElement = element
    }

    unobserve(): void {}

    disconnect(): void {
      disconnect()
    }
  }

  vi.stubGlobal("ResizeObserver", FakeResizeObserver)

  return {
    disconnect,
    trigger: (height: number) => {
      if (!callback || !observedElement) throw new Error("ResizeObserver non initialisé")
      const entry = {
        target: observedElement,
        contentRect: { height },
      } as ResizeObserverEntry
      act(() => callback?.([entry], {} as ResizeObserver))
    },
  }
}

describe("ChatView — suivi respectueux du défilement", () => {
  it("suit automatiquement le streaming lorsque la vue est près du bas", () => {
    const { rerender } = render(
      <ChatView {...base} conversationId="conv-1" vm={[msg({ role: "assistant", content: "Début" })]} />,
    )
    const log = screen.getByRole("log")
    setScrollMetrics(log, { scrollTop: 820, clientHeight: 100, scrollHeight: 1_000 })
    const scrollTo = vi.fn()
    Object.defineProperty(log, "scrollTo", { configurable: true, value: scrollTo })
    fireEvent.scroll(log)
    scrollTo.mockReset()

    setScrollMetrics(log, { scrollTop: 820, clientHeight: 100, scrollHeight: 1_100 })
    rerender(
      <ChatView {...base} conversationId="conv-1" vm={[msg({ role: "assistant", content: "Début suite" })]} />,
    )

    expect(scrollTo).toHaveBeenCalledWith({ top: 1_100, behavior: "auto" })
    expect(screen.queryByRole("button", { name: "Revenir en bas de la conversation" })).toBeNull()
    expect(log.classList.contains("p-4")).toBe(true)
    expect(log.classList.contains("pb-16")).toBe(false)
  })

  it("fige la lecture loin du bas et signale une nouvelle réponse", () => {
    const { rerender } = render(
      <ChatView {...base} conversationId="conv-1" vm={[msg({ role: "assistant", content: "Début" })]} />,
    )
    const log = screen.getByRole("log")
    setScrollMetrics(log, { scrollTop: 100, clientHeight: 100, scrollHeight: 1_000 })
    const scrollTo = vi.fn()
    Object.defineProperty(log, "scrollTo", { configurable: true, value: scrollTo })
    fireEvent.scroll(log)
    scrollTo.mockReset()

    setScrollMetrics(log, { scrollTop: 100, clientHeight: 100, scrollHeight: 1_100 })
    rerender(
      <ChatView {...base} conversationId="conv-1" vm={[msg({ role: "assistant", content: "Début suite" })]} />,
    )

    expect(scrollTo).not.toHaveBeenCalled()
    expect(screen.getByRole("button", { name: "Revenir en bas de la conversation" })).toBeTruthy()
    const announcement = screen.getByText("Nouvelle réponse", { selector: ".sr-only" })
    expect(announcement.getAttribute("role")).toBe("status")
    expect(log.classList.contains("pb-16")).toBe(true)
  })

  it("revient en douceur au bas au clic lorsque les animations sont autorisées", () => {
    mockReducedMotion(false)
    const { rerender } = render(
      <ChatView {...base} conversationId="conv-1" vm={[msg({ role: "assistant", content: "Début" })]} />,
    )
    const log = screen.getByRole("log")
    setScrollMetrics(log, { scrollTop: 100, clientHeight: 100, scrollHeight: 1_000 })
    const scrollTo = vi.fn()
    Object.defineProperty(log, "scrollTo", { configurable: true, value: scrollTo })
    fireEvent.scroll(log)
    rerender(
      <ChatView {...base} conversationId="conv-1" vm={[msg({ role: "assistant", content: "Début suite" })]} />,
    )
    scrollTo.mockReset()

    fireEvent.click(screen.getByRole("button", { name: "Revenir en bas de la conversation" }))

    expect(scrollTo).toHaveBeenCalledWith({ top: 1_000, behavior: "smooth" })
    expect(screen.queryByRole("button", { name: "Revenir en bas de la conversation" })).toBeNull()
  })

  it("revient sans animation au bas quand les mouvements sont réduits", () => {
    mockReducedMotion(true)
    const { rerender } = render(
      <ChatView {...base} conversationId="conv-1" vm={[msg({ role: "assistant", content: "Début" })]} />,
    )
    const log = screen.getByRole("log")
    setScrollMetrics(log, { scrollTop: 100, clientHeight: 100, scrollHeight: 1_000 })
    const scrollTo = vi.fn()
    Object.defineProperty(log, "scrollTo", { configurable: true, value: scrollTo })
    fireEvent.scroll(log)
    rerender(
      <ChatView {...base} conversationId="conv-1" vm={[msg({ role: "assistant", content: "Début suite" })]} />,
    )
    scrollTo.mockReset()

    fireEvent.click(screen.getByRole("button", { name: "Revenir en bas de la conversation" }))

    expect(scrollTo).toHaveBeenCalledWith({ top: 1_000, behavior: "auto" })
  })

  it("revient en douceur au bas si matchMedia n'est pas disponible", () => {
    vi.stubGlobal("matchMedia", undefined)
    const { rerender } = render(
      <ChatView {...base} conversationId="conv-1" vm={[msg({ role: "assistant", content: "Début" })]} />,
    )
    const log = screen.getByRole("log")
    setScrollMetrics(log, { scrollTop: 100, clientHeight: 100, scrollHeight: 1_000 })
    const scrollTo = vi.fn()
    Object.defineProperty(log, "scrollTo", { configurable: true, value: scrollTo })
    fireEvent.scroll(log)
    rerender(
      <ChatView {...base} conversationId="conv-1" vm={[msg({ role: "assistant", content: "Début suite" })]} />,
    )
    scrollTo.mockReset()

    fireEvent.click(screen.getByRole("button", { name: "Revenir en bas de la conversation" }))

    expect(scrollTo).toHaveBeenCalledWith({ top: 1_000, behavior: "smooth" })
  })

  it("resynchronise le bas lorsque la nouvelle VM chargée a la même taille et le même contenu final", () => {
    const oldVm = [msg({ id: "old-message", role: "assistant", content: "Même réponse" })]
    const { rerender } = render(
      <ChatView {...base} conversationId="conv-1" vm={oldVm} />,
    )
    const log = screen.getByRole("log")
    setScrollMetrics(log, { scrollTop: 100, clientHeight: 100, scrollHeight: 1_000 })
    const scrollTo = vi.fn()
    Object.defineProperty(log, "scrollTo", { configurable: true, value: scrollTo })
    fireEvent.scroll(log)
    scrollTo.mockReset()
    setScrollMetrics(log, { scrollTop: 0, clientHeight: 100, scrollHeight: 700 })

    rerender(<ChatView {...base} conversationId="conv-2" vm={oldVm} />)
    expect(screen.queryByRole("button", { name: "Revenir en bas de la conversation" })).toBeNull()
    expect(scrollTo).toHaveBeenCalledWith({ top: 700, behavior: "auto" })
    scrollTo.mockReset()

    const loadedVm = [msg({ id: "new-message", role: "assistant", content: "Même réponse" })]
    setScrollMetrics(log, { scrollTop: 0, clientHeight: 100, scrollHeight: 1_200 })
    rerender(<ChatView {...base} conversationId="conv-2" vm={loadedVm} />)

    expect(scrollTo).toHaveBeenCalledWith({ top: 1_200, behavior: "auto" })
  })

  it("reprend le suivi après un retour manuel près du bas", () => {
    const { rerender } = render(
      <ChatView {...base} conversationId="conv-1" vm={[msg({ role: "assistant", content: "Début" })]} />,
    )
    const log = screen.getByRole("log")
    setScrollMetrics(log, { scrollTop: 100, clientHeight: 100, scrollHeight: 1_000 })
    const scrollTo = vi.fn()
    Object.defineProperty(log, "scrollTo", { configurable: true, value: scrollTo })
    fireEvent.scroll(log)
    rerender(
      <ChatView {...base} conversationId="conv-1" vm={[msg({ role: "assistant", content: "Début suite" })]} />,
    )
    expect(screen.getByRole("button", { name: "Revenir en bas de la conversation" })).toBeTruthy()

    setScrollMetrics(log, { scrollTop: 830, clientHeight: 100, scrollHeight: 1_000 })
    fireEvent.scroll(log)
    expect(screen.queryByRole("button", { name: "Revenir en bas de la conversation" })).toBeNull()
    scrollTo.mockReset()
    setScrollMetrics(log, { scrollTop: 830, clientHeight: 100, scrollHeight: 1_100 })
    rerender(
      <ChatView {...base} conversationId="conv-1" vm={[msg({ role: "assistant", content: "Début suite fin" })]} />,
    )

    expect(scrollTo).toHaveBeenCalledWith({ top: 1_100, behavior: "auto" })
  })
})

describe("ChatView — croissance asynchrone du contenu", () => {
  it("suit une hausse de hauteur lorsque la vue suit le bas", () => {
    const resizeObserver = installResizeObserverMock()
    render(<ChatView {...base} conversationId="conv-1" vm={[msg({ role: "assistant", content: "Réponse" })]} />)
    const log = screen.getByRole("log")
    setScrollMetrics(log, { scrollTop: 1_020, clientHeight: 100, scrollHeight: 1_200 })
    const scrollTo = vi.fn()
    Object.defineProperty(log, "scrollTo", { configurable: true, value: scrollTo })
    fireEvent.scroll(log)
    scrollTo.mockReset()

    setScrollMetrics(log, { scrollTop: 1_100, clientHeight: 100, scrollHeight: 1_500 })
    resizeObserver.trigger(600)

    expect(scrollTo).toHaveBeenCalledWith({ top: 1_500, behavior: "auto" })
  })

  it("signale une hausse de hauteur sans déplacer une vue figée", () => {
    const resizeObserver = installResizeObserverMock()
    render(<ChatView {...base} conversationId="conv-1" vm={[msg({ role: "assistant", content: "Réponse" })]} />)
    const log = screen.getByRole("log")
    setScrollMetrics(log, { scrollTop: 100, clientHeight: 100, scrollHeight: 1_000 })
    const scrollTo = vi.fn()
    Object.defineProperty(log, "scrollTo", { configurable: true, value: scrollTo })
    fireEvent.scroll(log)
    scrollTo.mockReset()

    setScrollMetrics(log, { scrollTop: 100, clientHeight: 100, scrollHeight: 1_300 })
    resizeObserver.trigger(700)

    expect(scrollTo).not.toHaveBeenCalled()
    expect(screen.getByRole("button", { name: "Revenir en bas de la conversation" })).toBeTruthy()
  })

  it("déconnecte l'observer au démontage", () => {
    const resizeObserver = installResizeObserverMock()
    const { unmount } = render(
      <ChatView {...base} conversationId="conv-1" vm={[msg({ role: "assistant", content: "Réponse" })]} />,
    )

    unmount()

    expect(resizeObserver.disconnect).toHaveBeenCalledOnce()
  })

  it("conserve le suivi par la VM lorsque ResizeObserver est absent", () => {
    vi.stubGlobal("ResizeObserver", undefined)
    const { rerender } = render(
      <ChatView {...base} conversationId="conv-1" vm={[msg({ id: "m1", role: "assistant", content: "Réponse" })]} />,
    )
    const log = screen.getByRole("log")
    const scrollTo = vi.fn()
    Object.defineProperty(log, "scrollTo", { configurable: true, value: scrollTo })
    setScrollMetrics(log, { scrollTop: 1_220, clientHeight: 100, scrollHeight: 1_400 })
    fireEvent.scroll(log)
    scrollTo.mockReset()

    expect(() => rerender(
      <ChatView {...base} conversationId="conv-1" vm={[msg({ id: "m2", role: "assistant", content: "Réponse" })]} />,
    )).not.toThrow()
    expect(scrollTo).toHaveBeenCalledWith({ top: 1_400, behavior: "auto" })
  })
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

  it("affiche le TTFT au format français avec son libellé i18n", () => {
    render(
      <ChatView {...base} vm={[msg({ role: "assistant", content: "réponse", firstTokenMs: 1250 })]} />,
    )
    expect(screen.getByText("1,3 s premier token")).toBeTruthy()
  })
})

describe("ChatView — métriques propres à chaque réponse", () => {
  it("affiche uniquement les métriques du message assistant concerné", () => {
    render(<ChatView {...base} vm={[
      msg({
        role: "assistant",
        content: "réponse A",
        inputTokens: 1_000,
        outputTokens: 200,
        usageSource: "provider",
        costMicrousd: 450,
      }),
      msg({ role: "assistant", content: "réponse B" }),
    ]} />)
    expect(screen.getByText("1.2k tokens")).toBeTruthy()
    expect(screen.getByText("$0.0005")).toBeTruthy()
    expect(screen.getAllByText(/tokens/)).toHaveLength(1)
  })

  it("marque visuellement une estimation", () => {
    render(<ChatView {...base} vm={[msg({
      role: "assistant",
      content: "réponse",
      inputTokens: 100,
      outputTokens: 20,
      usageSource: "estimated",
    })]} />)
    expect(screen.getByText("≈ 120 tokens")).toBeTruthy()
    expect(screen.getByTitle("Estimation locale des tokens")).toBeTruthy()
    const accessibleLabel = screen.getByText("Estimation locale des tokens", { selector: ".sr-only" })
    expect(accessibleLabel).toBeTruthy()
  })

  it("affiche un usage fournisseur exact sans marque d'estimation", () => {
    render(<ChatView {...base} vm={[msg({
      role: "assistant",
      content: "réponse",
      inputTokens: 100,
      outputTokens: 20,
      usageSource: "provider",
    })]} />)
    expect(screen.getByText("120 tokens")).toBeTruthy()
    expect(screen.queryByText(/≈ 120 tokens/)).toBeNull()
  })

  it("affiche un coût nul lorsqu'il est explicitement fourni", () => {
    render(<ChatView {...base} vm={[msg({
      role: "assistant",
      content: "réponse",
      costMicrousd: 0,
    })]} />)
    expect(screen.getByText("< $0.0001")).toBeTruthy()
  })

  it("autorise la rangée de métriques à revenir à la ligne sans réduire le bouton copier", () => {
    render(<ChatView {...base} vm={[msg({
      role: "assistant",
      content: "réponse",
      inputTokens: 100,
      outputTokens: 20,
    })]} />)
    const copyButton = screen.getByRole("button", { name: "Copier le message" })
    expect(copyButton.parentElement?.classList.contains("flex-wrap")).toBe(true)
    expect(copyButton.classList.contains("shrink-0")).toBe(true)
  })

  it("n'affiche aucun faux coût quand il est inconnu", () => {
    render(<ChatView {...base} vm={[msg({
      role: "assistant",
      content: "réponse",
      inputTokens: 100,
      outputTokens: 20,
      usageSource: "estimated",
    })]} />)
    expect(screen.queryByText(/\$/)).toBeNull()
  })

  it("se rend sans les anciennes props du compteur cumulatif", () => {
    render(<ChatView {...base} vm={[msg({ role: "assistant", content: "réponse" })]} />)
    expect(screen.getByText("réponse")).toBeTruthy()
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
    expect(screen.getByText(label, { selector: 'span[role="status"]' })).toBeTruthy()
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

describe("ChatView — erreurs historiques", () => {
  it("affiche l'erreur générique d'un assistant vide sans spinner de réflexion", () => {
    render(<ChatView {...base} vm={[msg({
      role: "assistant",
      content: "",
      apiError: { kind: "unknown", message: "" },
    })]} />)

    expect(screen.queryByRole("status", { name: "Le modèle réfléchit…" })).toBeNull()
    expect(screen.getByText("Erreur inattendue du fournisseur")).toBeTruthy()
  })

  it("affiche le libellé local d'une erreur de persistance rechargée", () => {
    render(<ChatView {...base} vm={[msg({
      role: "assistant",
      content: "Réponse reçue",
      apiError: { kind: "persistence", message: "" },
    })]} />)

    expect(screen.getByText("Réponse non enregistrée localement")).toBeTruthy()
    expect(screen.queryByText("Erreur inattendue du fournisseur")).toBeNull()
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
    vi.spyOn(navigator.clipboard, "writeText").mockResolvedValue(undefined)
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

  it("un message assistant vide garde zéro bouton copier", () => {
    render(<ChatView {...base} vm={[msg({ role: "assistant", content: "" })]} />)
    expect(screen.queryByRole("button", { name: "Copier le message" })).toBeNull()
  })

  it("un assistant avec contenu mais sans métrique garde un seul bouton copier", () => {
    render(<ChatView {...base} vm={[msg({ role: "assistant", content: "réponse" })]} />)
    expect(screen.getAllByRole("button", { name: "Copier le message" })).toHaveLength(1)
  })

  it("deux assistants donnent exactement deux boutons copier", () => {
    render(<ChatView {...base} vm={[
      msg({ role: "assistant", content: "réponse A", inputTokens: 10, outputTokens: 5 }),
      msg({ role: "assistant", content: "réponse B" }),
    ]} />)
    expect(screen.getAllByRole("button", { name: "Copier le message" })).toHaveLength(2)
  })

  it("un message utilisateur garde son bouton copier", () => {
    render(<ChatView {...base} vm={[msg({ role: "user", content: "question" })]} />)
    expect(screen.getAllByRole("button", { name: "Copier le message" })).toHaveLength(1)
  })

  it("un second clic réinitialise le minuteur de fin de feedback", async () => {
    const user = userEvent.setup()
    vi.spyOn(navigator.clipboard, "writeText").mockResolvedValue(undefined)
    // Spies en pass-through : le setTimeout de 1500 ms est le nôtre (les
    // délais internes de userEvent sont à 0/50) ; on enregistre aussi les
    // clearTimeout pour vérifier la réinitialisation, sans asphyxier
    // userEvent (les appels restent délégués aux timers réels).
    const origSetTimeout = window.setTimeout.bind(window)
    const origClearTimeout = window.clearTimeout.bind(window)
    let ourTimer: number | null = null
    const cleared = new Set<number>()
    const setTimeoutSpy = vi
      .spyOn(window, "setTimeout")
      .mockImplementation(((cb: TimerHandler, ms?: number) => {
        const id = origSetTimeout(cb, ms) as unknown as number
        if (ms === 1500) ourTimer = id
        return id
      }) as unknown as typeof window.setTimeout)
    const clearTimeoutSpy = vi
      .spyOn(window, "clearTimeout")
      .mockImplementation(((id?: number) => {
        if (id !== undefined && id !== null) cleared.add(id)
        return origClearTimeout(id as unknown as Parameters<typeof origClearTimeout>[0])
      }) as unknown as typeof window.clearTimeout)
    try {
      render(<ChatView {...base} vm={[msg({ role: "assistant", content: "réponse" })]} />)
      await user.click(screen.getByRole("button", { name: "Copier le message" }))
      expect(ourTimer).not.toBeNull()
      const firstTimer = ourTimer!
      // Le nom accessible a basculé pendant le feedback : le second clic
      // vise le bouton tel qu'il est rendu à ce moment-là.
      await user.click(screen.getByRole("button", { name: "Message copié" }))
      // Le setTimeout du second clic écrase ourTimer : c'est le PREMIER
      // id qui doit être nettoyé au second clic.
      ourTimer = firstTimer
      expect(cleared.has(ourTimer)).toBe(true)
    } finally {
      setTimeoutSpy.mockRestore()
      clearTimeoutSpy.mockRestore()
    }
  })

  it("le minuteur est nettoyé au démontage (pas de setState fantôme)", async () => {
    const user = userEvent.setup()
    vi.spyOn(navigator.clipboard, "writeText").mockResolvedValue(undefined)
    const origSetTimeout = window.setTimeout.bind(window)
    const origClearTimeout = window.clearTimeout.bind(window)
    let ourTimer: number | null = null
    const cleared = new Set<number>()
    const setTimeoutSpy = vi
      .spyOn(window, "setTimeout")
      .mockImplementation(((cb: TimerHandler, ms?: number) => {
        const id = origSetTimeout(cb, ms) as unknown as number
        if (ms === 1500) ourTimer = id
        return id
      }) as unknown as typeof window.setTimeout)
    const clearTimeoutSpy = vi
      .spyOn(window, "clearTimeout")
      .mockImplementation(((id?: number) => {
        if (id !== undefined && id !== null) cleared.add(id)
        return origClearTimeout(id as unknown as Parameters<typeof origClearTimeout>[0])
      }) as unknown as typeof window.clearTimeout)
    try {
      const { unmount } = render(<ChatView {...base} vm={[msg({ role: "assistant", content: "réponse" })]} />)
      await user.click(screen.getByRole("button", { name: "Copier le message" }))
      expect(screen.getByRole("button", { name: "Message copié" })).toBeTruthy()
      expect(ourTimer).not.toBeNull()
      unmount()
      // Le cleanup useEffect doit avoir annulé le setTimeout — sinon
      // setCopied partirait sur un composant démonté à l'expiration.
      expect(cleared.has(ourTimer!)).toBe(true)
    } finally {
      setTimeoutSpy.mockRestore()
      clearTimeoutSpy.mockRestore()
    }
  })

  it("ignore la résolution différée du presse-papiers après démontage", async () => {
    const user = userEvent.setup()
    let resolveClipboard!: () => void
    const clipboardPromise = new Promise<void>((resolve) => {
      resolveClipboard = resolve
    })
    vi.spyOn(navigator.clipboard, "writeText").mockReturnValue(clipboardPromise)
    const originalSetTimeout = window.setTimeout.bind(window)
    const setTimeoutSpy = vi
      .spyOn(window, "setTimeout")
      .mockImplementation(((callback: TimerHandler, ms?: number) =>
        originalSetTimeout(callback, ms)) as typeof window.setTimeout)
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {})

    try {
      const { unmount } = render(
        <ChatView {...base} vm={[msg({ role: "assistant", content: "réponse" })]} />,
      )
      await user.click(screen.getByRole("button", { name: "Copier le message" }))
      unmount()

      resolveClipboard()
      await clipboardPromise
      await Promise.resolve()

      const feedbackTimers = setTimeoutSpy.mock.calls.filter(([, ms]) => ms === 1500)
      expect(feedbackTimers).toHaveLength(0)
      expect(consoleErrorSpy).not.toHaveBeenCalled()
    } finally {
      setTimeoutSpy.mockRestore()
      consoleErrorSpy.mockRestore()
    }
  })
})
