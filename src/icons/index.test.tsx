// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react"
import { afterEach, describe, expect, it } from "vitest"
import { GithubConnecteurIcon } from "./index"

afterEach(cleanup)

describe("GithubConnecteurIcon", () => {
  it("respecte le contrat des icônes maison LogAssist", () => {
    const { container } = render(<GithubConnecteurIcon className="size-5 text-brand-to" />)
    const svg = container.querySelector("svg")

    expect(svg).not.toBeNull()
    expect(svg?.getAttribute("viewBox")).toBe("0 0 24 24")
    expect(svg?.getAttribute("fill")).toBe("currentColor")
    expect(svg?.getAttribute("aria-hidden")).toBe("true")
    expect(svg?.classList.contains("size-5")).toBe(true)
    expect(svg?.querySelector("path")).not.toBeNull()
    const normalizedArtwork = svg?.querySelector('g[transform="scale(0.1)"]')
    expect(normalizedArtwork).not.toBeNull()
    expect(normalizedArtwork?.getAttribute("stroke")).toBe("currentColor")
    expect(normalizedArtwork?.getAttribute("stroke-width")).toBe("8")
    expect(svg?.querySelector("image")).toBeNull()
    expect(svg?.querySelector("[id]")).toBeNull()
  })
})
