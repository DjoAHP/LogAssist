// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { render, screen, cleanup } from "@testing-library/react"
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
