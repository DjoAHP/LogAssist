import { readFileSync } from "node:fs"
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"

import { McpIcon } from "@/icons"

describe("bouton MCP du header", () => {
  it("utilise l'icône 24x24 et précède immédiatement le System prompt", () => {
    const markup = renderToStaticMarkup(<McpIcon />)
    expect(markup).toContain('viewBox="0 0 24 24"')

    const source = readFileSync(new URL("./App.tsx", import.meta.url), "utf8")
    const mcpButton = source.indexOf("aria-label={t.mcp.open}")
    const assistantButton = source.indexOf("aria-label={t.assistant.title}")
    expect(mcpButton).toBeGreaterThan(-1)
    expect(assistantButton).toBeGreaterThan(mcpButton)
    expect(source.slice(mcpButton, assistantButton)).toContain("<McpIcon")
  })
})
