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
    // Le libellé dépend de l'édition : on repère le bouton par son action.
    const mcpButton = source.indexOf("onClick={() => setMcpOpen(true)}")
    const assistantButton = source.indexOf("aria-label={t.assistant.title}")
    expect(mcpButton).toBeGreaterThan(-1)
    expect(assistantButton).toBeGreaterThan(mcpButton)
    expect(source.slice(mcpButton, assistantButton)).toContain("<McpIcon")
  })

  it("aligne les libellés du header avec les titres des modales", () => {
    expect(t.mcp.open).toBe("MCP")
    expect(t.mcp.title).toBe("MCP")
    expect(t.assistant.title).toBe("Assistant")
    expect(t.providers.modelsSettings).toBe("Fournisseurs")
    expect(t.providers.title).toBe("Fournisseur")

    // Édition portable : le même bouton ouvre la « Recherche Web », et son
    // infobulle porte le titre de la modale réellement montée.
    expect(t.portableWeb.open).toBe("Recherche Web")
    expect(t.portableWeb.title).toBe("Recherche Web")
    expect(t.portableWeb.title).toBe(t.portableWeb.open)

    const source = readFileSync(new URL("./App.tsx", import.meta.url), "utf8")
    expect(source).toContain("title={isPortableEdition ? t.portableWeb.title : t.mcp.title}")
    expect(source).toContain("aria-label={isPortableEdition ? t.portableWeb.open : t.mcp.open}")
    expect(source).toContain("title={t.assistant.title}")
    expect(source).toContain("aria-label={t.providers.modelsSettings}")
    expect(source).toContain("title={t.providers.modelsSettings}")
  })

  it("place Paramètres généraux après le bouton fournisseurs, avec séparateur", () => {
    const source = readFileSync(new URL("./App.tsx", import.meta.url), "utf8")
    const providersButton = source.indexOf("aria-label={t.providers.modelsSettings}")
    const generalButton = source.indexOf("aria-label={t.generalSettings.open}")
    expect(providersButton).toBeGreaterThan(-1)
    expect(generalButton).toBeGreaterThan(providersButton)
    expect(source.slice(providersButton, generalButton)).toContain("bg-border")
    expect(source.slice(generalButton, generalButton + 400)).toContain("<ParaGenIcon")
    expect(source).toContain("import { LockGate }")
    expect(source).toContain("isLockActive()")
  })
})

describe("App — runtime MCP et galerie", () => {
  it("l'application transmet le snapshot MCP au chat et au modal", () => {
    const source = readFileSync(new URL("./App.tsx", import.meta.url), "utf8")
    expect(source).toContain("useMcpRuntime(connectorRuntime)")
    expect(source).toContain("useChat(modelSelection, mcpRuntime)")
    expect(source).toContain("snapshot={mcpRuntime}")
  })

  it("transmet les overrides du modèle actif au moteur de chat", () => {
    const source = readFileSync(new URL("./App.tsx", import.meta.url), "utf8")
    expect(source).toContain("modelRowId: activeModel.modelRowId")
    expect(source).toContain("contextWindowOverride: activeModel.contextWindowOverride")
    expect(source).toContain("maxOutputTokensOverride: activeModel.maxOutputTokensOverride")
  })

  it("rafraîchit le statut GitHub après la fermeture des paramètres généraux", () => {
    const source = readFileSync(new URL("./App.tsx", import.meta.url), "utf8")
    expect(source).toContain("useGithubConnectorStatus()")
    expect(source).toContain("githubAvailable={githubStatus.configured}")
    expect(source).toContain("void refreshGithubStatus()")
  })

  it("choisit le panneau selon l'édition sans retirer la galerie bureau", () => {
    const source = readFileSync(new URL("./App.tsx", import.meta.url), "utf8")
    expect(source).toContain("import { McpDialog }")
    expect(source).toContain("import { TinyfishDialog }")
    expect(source).toContain("<McpDialog")
    expect(source).toContain("<TinyfishDialog")
    expect(source).toContain("isPortableEdition ? (")
  })

  it("alimente le runtime d’outils avec la liaison GitHub courante", () => {
    const source = readFileSync(new URL("./App.tsx", import.meta.url), "utf8")
    expect(source).toContain("const connectorRuntime")
    expect(source).toContain("binding: githubBinding")
    expect(source).toContain("configured: githubStatus.configured")
  })
})
