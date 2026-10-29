// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest"
import { render, screen, fireEvent, waitFor, act, cleanup } from "@testing-library/react"
import { InputBar } from "@/components/chat/InputBar"

afterEach(cleanup)

function setup(onSend: (text: string, attachments: unknown[]) => Promise<boolean>) {
  render(<InputBar onSend={onSend} onInterrupt={() => {}} />)
  const textarea = screen.getByPlaceholderText(/Écrivez votre message/) as HTMLTextAreaElement
  const sendBtn = screen.getByRole("button", { name: "Envoyer" })
  return { textarea, sendBtn }
}

describe("InputBar — soumission et restauration", () => {
  it("vide le champ quand onSend résout true", async () => {
    const { textarea, sendBtn } = setup(vi.fn().mockResolvedValue(true))
    await act(async () => {
      fireEvent.change(textarea, { target: { value: "Bonjour" } })
    })
    await act(async () => {
      fireEvent.click(sendBtn)
    })
    await waitFor(() => expect(textarea.value).toBe(""))
  })

  it("restaure le texte quand onSend résout false (échec d'enregistrement)", async () => {
    const { textarea, sendBtn } = setup(vi.fn().mockResolvedValue(false))
    await act(async () => {
      fireEvent.change(textarea, { target: { value: "Message perdu" } })
    })
    await act(async () => {
      fireEvent.click(sendBtn)
    })
    // Clé du fix : tant que l'enregistrement n'a pas confirmé, le contenu est
    // restauré — on n'attend plus du tout value "" comme état final.
    await waitFor(() => {
      expect(textarea.value).toBe("Message perdu")
    })
    expect(textarea.value).toBe("Message perdu")
  })

  it("restaure le texte quand onSend rejette", async () => {
    const { textarea, sendBtn } = setup(vi.fn().mockRejectedValue(new Error("boom")))
    await act(async () => {
      fireEvent.change(textarea, { target: { value: "Message rejeté" } })
    })
    await act(async () => {
      fireEvent.click(sendBtn)
    })
    await waitFor(() => {
      expect(textarea.value).toBe("Message rejeté")
    })
    expect(textarea.value).toBe("Message rejeté")
  })

  it("restaure aussi les pièces jointes en cas d'échec", async () => {
    const onSend = vi.fn().mockResolvedValue(false)
    const { textarea, sendBtn } = setup(onSend)
    await act(async () => {
      fireEvent.change(textarea, { target: { value: "Avec image" } })
    })
    const file = new File(["x"], "a.png", { type: "image/png" })
    const input = document.querySelector<HTMLInputElement>('input[type="file"]')!
    await act(async () => {
      fireEvent.change(input, { target: { files: [file] } })
    })
    await act(async () => {
      fireEvent.click(sendBtn)
    })
    await waitFor(() => {
      expect(screen.getByAltText("a.png")).toBeTruthy()
    })
    await waitFor(() => {
      expect(textarea.value).toBe("Avec image")
    })
  })
})
