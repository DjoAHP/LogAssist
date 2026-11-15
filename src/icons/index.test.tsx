// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react"
import { afterEach, describe, expect, it } from "vitest"
import githubConnecteurSource from "./svg/github_connecteur.svg?raw"
import { GithubConnecteurIcon } from "./index"

afterEach(cleanup)

describe("GithubConnecteurIcon", () => {
  it("rend le nouveau SVG GitHub 512 × 512 avec sa couleur héritée", () => {
    const { container } = render(<GithubConnecteurIcon className="size-5 text-brand-to" />)
    const svg = container.querySelector("svg")

    expect(svg).not.toBeNull()
    expect(svg?.getAttribute("viewBox")).toBe("0 0 512 512")
    expect(svg?.getAttribute("fill")).toBe("currentColor")
    expect(svg?.getAttribute("aria-hidden")).toBe("true")
    expect(svg?.classList.contains("size-5")).toBe(true)
    expect(svg?.querySelectorAll("path")).toHaveLength(30)

    const artwork = svg?.querySelector('g[transform="translate(0 512) scale(0.1 -0.1)"]')
    expect(artwork).not.toBeNull()
    expect(artwork?.getAttribute("fill")).toBe("currentColor")
    expect(artwork?.getAttribute("stroke")).toBe("none")
    expect(svg?.querySelector('g[transform="scale(0.1)"]')).toBeNull()

    const normalizePath = (path: string) => path.replace(/\s+/g, " ").trim()
    const sourcePaths = [...githubConnecteurSource.matchAll(/<path d="([\s\S]*?)"/g)]
      .map((match) => normalizePath(match[1]))
    const renderedPaths = [...(svg?.querySelectorAll("path") ?? [])]
      .map((path) => normalizePath(path.getAttribute("d") ?? ""))
    expect(renderedPaths).toEqual(sourcePaths)

    expect(svg?.querySelector("image")).toBeNull()
    expect(svg?.querySelector("[id]")).toBeNull()
  })
})
