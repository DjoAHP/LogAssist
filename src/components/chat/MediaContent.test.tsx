// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, fireEvent, waitFor } from "@testing-library/react"
import { MediaContent } from "@/components/chat/MediaContent"

describe("MediaContent", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("rend une image avec max-w-full max-h-[70vh] et skeleton pendant le chargement", () => {
    const media = [{
      id: "m1",
      type: "image" as const,
      mimeType: "image/png",
      base64: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
      toolLabel: "Cloudflare · generate_image",
    }]
    render(<MediaContent media={media} />)
    const img = screen.getByAltText("Image générée : Cloudflare · generate_image")
    expect(img).toHaveStyle("max-width: 100%")
    expect(img).toHaveStyle("max-height: 70vh")
    expect(img).toHaveStyle("width: auto")
    expect(img).toHaveStyle("height: auto")
    // skeleton présent tant que l'image n'est pas loaded
    expect(screen.getByTestId("media-skeleton-m1")).toBeInTheDocument()
  })

  it("remplace le skeleton par l'image chargée et expose la lightbox au clic", async () => {
    const onImageClick = vi.fn()
    const media = [{
      id: "m1",
      type: "image" as const,
      mimeType: "image/png",
      base64: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
      toolLabel: "Cloudflare · generate_image",
    }]
    render(<MediaContent media={media} onImageClick={onImageClick} />)
    const img = screen.getByAltText("Image générée : Cloudflare · generate_image")
    fireEvent.load(img)
    await waitFor(() => expect(screen.queryByTestId("media-skeleton-m1")).not.toBeInTheDocument())
    expect(img).toHaveClass("cursor-zoom-in")
    fireEvent.click(img)
    // onImageClick appelé avec l'URL data: de l'image
    expect(onImageClick).toHaveBeenCalledWith(expect.objectContaining({
      src: expect.stringMatching(/^data:image\/png;base64,/),
      alt: "Image générée : Cloudflare · generate_image",
    }))
  })

  it("affiche un chip role=note si l'image échoue (onError)", () => {
    const media = [{
      id: "m1",
      type: "image" as const,
      mimeType: "image/png",
      base64: "invalid-base64",
      toolLabel: "Cloudflare · generate_image",
    }]
    render(<MediaContent media={media} />)
    const img = screen.getByAltText("Image générée : Cloudflare · generate_image")
    fireEvent.error(img)
    expect(screen.getByRole("note")).toHaveTextContent("Média non affichable")
  })

  it("rend un élément audio avec contrôles", () => {
    const media = [{
      id: "m2",
      type: "audio" as const,
      mimeType: "audio/mpeg",
      base64: "//uQxAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
      toolLabel: "ElevenLabs · tts",
    }]
    render(<MediaContent media={media} />)
    const audio = screen.getByRole("img", { name: "Audio : ElevenLabs · tts" })
    expect(audio.tagName).toBe("AUDIO")
    expect(audio).toHaveAttribute("controls")
    expect(audio).toHaveAttribute("src", expect.stringMatching(/^data:audio\/mpeg;base64,/))
  })

  it("affiche un chip role=note si l'audio échoue", () => {
    const media = [{
      id: "m2",
      type: "audio" as const,
      mimeType: "audio/mpeg",
      base64: "invalid",
      toolLabel: "ElevenLabs · tls",
    }]
    render(<MediaContent media={media} />)
    const audio = screen.getByRole("img", { name: "Audio : ElevenLabs · tls" })
    fireEvent.error(audio)
    expect(screen.getByRole("note")).toHaveTextContent("Média non affichable")
  })

  it("n'affiche rien pour un tableau vide", () => {
    render(<MediaContent media={[]} />)
    expect(screen.queryByRole("img")).not.toBeInTheDocument()
    expect(screen.queryByRole("note")).not.toBeInTheDocument()
  })
})