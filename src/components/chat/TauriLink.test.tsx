// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { render, screen, fireEvent, waitFor, cleanup, act } from "@testing-library/react"
import { extractUrls } from "./InputBar"

const mockOpenUrl = vi.hoisted(() => vi.fn())

vi.mock("@tauri-apps/plugin-opener", () => ({
  openUrl: mockOpenUrl,
}))

import { TauriLink } from "./TauriLink"

beforeEach(() => {
  vi.clearAllMocks()
})

afterEach(cleanup)

describe("TauriLink", () => {
  it("rend un lien avec la classe de base et l'icône externe", () => {
    render(<TauriLink href="https://example.com">Exemple</TauriLink>)
    const link = screen.getByRole("link", { name: /Exemple/ })
    expect(link.getAttribute("href")).toBe("https://example.com")
    expect(link.getAttribute("target")).toBe("_blank")
    expect(link.getAttribute("rel")).toBe("noopener noreferrer")
    expect(link.classList.contains("text-[var(--brand-to)]")).toBe(true)
    expect(link.classList.contains("underline")).toBe(true)
    expect(screen.getByTestId("external-link-icon")).toBeTruthy()
  })

  it("appelle openUrl au clic et empêche le comportement natif", async () => {
    mockOpenUrl.mockResolvedValue(undefined)
    render(<TauriLink href="https://example.com">Exemple</TauriLink>)
    const link = screen.getByRole("link")

    await act(async () => {
      fireEvent.click(link)
    })

    await waitFor(() => expect(mockOpenUrl).toHaveBeenCalledWith("https://example.com"))
  })

  it("fallback vers window.open si openUrl échoue", async () => {
    mockOpenUrl.mockRejectedValue(new Error("Tauri unavailable"))
    const openSpy = vi.spyOn(window, "open").mockImplementation(() => null)
    render(<TauriLink href="https://example.com">Exemple</TauriLink>)
    const link = screen.getByRole("link")

    await act(async () => {
      fireEvent.click(link)
    })

    await waitFor(() => expect(openSpy).toHaveBeenCalledWith("https://example.com", "_blank", "noopener,noreferrer"))
    openSpy.mockRestore()
  })

  it("n'ouvre pas externement pour les protocoles non http/https", async () => {
    render(<TauriLink href="javascript:alert(1)">Danger</TauriLink>)
    const link = screen.getByRole("link")

    await act(async () => {
      fireEvent.click(link)
    })

    expect(mockOpenUrl).not.toHaveBeenCalled()
  })

  it("transmet les props supplémentaires (className, role, etc.)", () => {
    render(
      <TauriLink href="https://example.com" className="custom-class" role="menuitem" data-testid="my-link">
        Test
      </TauriLink>
    )
    const link = screen.getByTestId("my-link")
    expect(link.classList.contains("custom-class")).toBe(true)
    expect(link.getAttribute("role")).toBe("menuitem")
  })
})

describe("extractUrls (InputBar)", () => {
  it("détecte une URL simple", () => {
    expect(extractUrls("Regarde https://example.com")).toEqual(["https://example.com"])
  })

  it("détecte plusieurs URLs", () => {
    expect(extractUrls("Visite https://example.com et https://test.org")).toEqual([
      "https://example.com",
      "https://test.org",
    ])
  })

  it("déduplique les URLs", () => {
    expect(extractUrls("https://example.com et https://example.com")).toEqual(["https://example.com"])
  })

  it("ne détecte pas les URLs sans protocole", () => {
    expect(extractUrls("example.com")).toEqual([])
  })

  it("ne détecte pas les protocoles non supportés", () => {
    expect(extractUrls("ftp://files.com")).toEqual([])
    expect(extractUrls("mailto:test@example.com")).toEqual([])
  })

  it("gère les URLs avec chemins et paramètres", () => {
    expect(extractUrls("https://example.com/path?query=1&a=2#hash")).toEqual([
      "https://example.com/path?query=1&a=2#hash",
    ])
  })

  it("retourne un tableau vide si pas d'URL", () => {
    expect(extractUrls("Aucun lien ici")).toEqual([])
    expect(extractUrls("")).toEqual([])
  })
})