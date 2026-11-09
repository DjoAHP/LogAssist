import { readFileSync } from "node:fs"
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"

import { McpIcon } from "@/icons"
import { t } from "@/i18n/fr"

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

  it("aligne les libellés du header avec les titres des modales", () => {
    expect(t.mcp.open).toBe("MCP")
    expect(t.mcp.title).toBe("MCP")
    expect(t.assistant.title).toBe("Assistant")
    expect(t.settings.modelsSettings).toBe("Fournisseurs")
    expect(t.settings.title).toBe("Fournisseur")

    const source = readFileSync(new URL("./App.tsx", import.meta.url), "utf8")
    expect(source).toContain("title={t.mcp.title}")
    expect(source).toContain("title={t.assistant.title}")
    expect(source).toContain("aria-label={t.settings.modelsSettings}")
    expect(source).toContain("title={t.settings.modelsSettings}")
  })
})

describe("App — runtime MCP et galerie", () => {
  it("l'application transmet le snapshot MCP au chat et au modal", () => {
    const source = readFileSync(new URL("./App.tsx", import.meta.url), "utf8")
    expect(source).toContain("useMcpRuntime()")
    expect(source).toContain("useChat(modelSelection, mcpRuntime)")
    expect(source).toContain("snapshot={mcpRuntime}")
  })
})
