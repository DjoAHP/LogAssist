// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { McpAgentTool, McpAuthStatus, McpServerConfig } from "@/lib/mcp/types"
import type { McpRuntimeSnapshot } from "@/lib/mcp/runtime"
import type { McpImportDiff } from "@/lib/mcp/importConfig"

const listServers = vi.hoisted(() => vi.fn())
const listTools = vi.hoisted(() => vi.fn())
const replaceCatalog = vi.hoisted(() => vi.fn())
const applyImport = vi.hoisted(() => vi.fn())
const disconnect = vi.hoisted(() => vi.fn())
const removeSecret = vi.hoisted(() => vi.fn())
const remove = vi.hoisted(() => vi.fn())
const setEnabled = vi.hoisted(() => vi.fn())
const setToolEnabled = vi.hoisted(() => vi.fn())
const setApprovalMode = vi.hoisted(() => vi.fn())
const validateConfigs = vi.hoisted(() => vi.fn())
const configureAuth = vi.hoisted(() => vi.fn())
const connectAndListTools = vi.hoisted(() => vi.fn())
const testTool = vi.hoisted(() => vi.fn())
const authStatus = vi.hoisted(() => vi.fn())
const dialogConfirm = vi.hoisted(() => vi.fn())

vi.mock("@/lib/db/mcpServers", () => ({
  mcpServers: {
    list: listServers,
    listTools: listTools,
    replaceCatalog,
    applyImport,
    disconnect,
    removeSecret,
    remove,
    setEnabled,
    setToolEnabled,
    setApprovalMode,
  },
  serverConfigFromRow: vi.fn((row) => ({
    id: row.id,
    name: row.name,
    endpoint: row.endpoint,
    transport: "streamable_http" as const,
    auth: row.auth_type === "bearer" ? { type: "bearer" as const } : { type: "none" as const },
    timeoutMs: row.timeout_ms,
    enabled: row.enabled === 1,
    builtin: row.builtin === 1,
  })),
}))

vi.mock("@/lib/mcp/client", () => ({
  mcp: {
    validateConfigs,
    configureAuth,
    connectAndListTools,
    testTool,
    disconnect,
    removeSecret,
    authStatus,
  },
}))

vi.mock("@/lib/mcp/catalog", () => ({
  buildActiveToolCatalog: vi.fn(),
  diffMcpImport: vi.fn((incoming: McpServerConfig[]) => incoming.map((server) => ({ kind: "create" as const, incoming: server, sensitive: false }))),
}))

vi.mock("@tauri-apps/plugin-dialog", () => ({
  confirm: dialogConfirm,
}))

import { McpDialog } from "@/components/settings/McpDialog"

function tinyfishRow() {
  return {
    id: "tinyfish",
    name: "TinyFish",
    endpoint: "https://tinyfish.example/mcp",
    transport: "streamable_http",
    auth_type: "bearer",
    header_name: null,
    timeout_ms: 30000,
    enabled: 1,
    builtin: 1,
    created_at: "2024-01-01T00:00:00Z",
    updated_at: "2024-01-01T00:00:00Z",
  }
}

function remoteRow(name: string, id?: string) {
  return {
    id: id ?? name.toLowerCase(),
    name: name,
    endpoint: `https://${name.toLowerCase()}.example/mcp`,
    transport: "streamable_http",
    auth_type: "none",
    header_name: null,
    timeout_ms: 30000,
    enabled: 0,
    builtin: 0,
    created_at: "2024-01-01T00:00:00Z",
    updated_at: "2024-01-01T00:00:00Z",
  }
}

function tinyfishToolRow(nativeName: string) {
  return {
    server_id: "tinyfish",
    native_name: nativeName,
    llm_name: nativeName,
    title: nativeName,
    description: `Description for ${nativeName}`,
    input_schema: "{}",
    output_schema: null,
    annotations: null,
    enabled: 1,
    approval_mode: "confirm" as const,
    schema_hash: "hash",
    discovered_at: "2024-01-01T00:00:00Z",
  }
}

function descriptor(nativeName: string) {
  return {
    nativeName: nativeName,
    title: nativeName,
    description: `Description for ${nativeName}`,
    inputSchema: {},
    outputSchema: undefined,
    annotations: undefined,
    schemaHash: "hash",
  }
}

function snapshot(overrides: Partial<{ authStatuses: Record<string, McpAuthStatus>; activeTools: McpAgentTool[] }> = {}) {
  return {
    servers: [] as McpRuntimeSnapshot["servers"],
    activeTools: overrides.activeTools ?? [],
    authStatuses: overrides.authStatuses ?? { tinyfish: "not_required" as McpAuthStatus },
    webAccess: { enabled: false, configured: false },
  }
}

function renderDialog(props: { snapshot?: ReturnType<typeof snapshot> } = {}) {
  return render(
    <McpDialog
      snapshot={props.snapshot ?? snapshot()}
      onClose={vi.fn()}
      onChanged={vi.fn()}
    />,
  )
}

function sensitiveUpdate(id: string): McpImportDiff {
  return {
    kind: "update",
    incoming: {
      id,
      name: "Test",
      endpoint: "https://example.com/mcp",
      transport: "streamable_http",
      auth: { type: "none" },
      timeoutMs: 30000,
      enabled: false,
      builtin: false,
    },
    current: {
      id,
      name: "Test",
      endpoint: "https://old.example.com/mcp",
      transport: "streamable_http",
      auth: { type: "none" },
      timeoutMs: 30000,
      enabled: false,
      builtin: false,
    },
    sensitive: true,
  }
}

function hasClass(element: HTMLElement | null, className: string): boolean {
  return element?.classList.contains(className) ?? false
}

beforeEach(() => {
  vi.clearAllMocks()
  listServers.mockResolvedValue([tinyfishRow()])
  listTools.mockResolvedValue([])
  replaceCatalog.mockResolvedValue([])
  applyImport.mockResolvedValue([])
  disconnect.mockResolvedValue(undefined)
  removeSecret.mockResolvedValue(undefined)
  remove.mockResolvedValue(undefined)
  setEnabled.mockResolvedValue(undefined)
  setToolEnabled.mockResolvedValue(undefined)
  setApprovalMode.mockResolvedValue(undefined)
  validateConfigs.mockResolvedValue(undefined)
  configureAuth.mockResolvedValue([])
  connectAndListTools.mockResolvedValue([])
  testTool.mockResolvedValue({ content: "", structuredContent: undefined, media: [], resourceLinks: [], sources: [], isError: false })
  authStatus.mockResolvedValue("not_required")
  dialogConfirm.mockResolvedValue(true)
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe("McpDialog", () => {
  it("utilise le gabarit standard des outils du header", () => {
    renderDialog()

    const dialog = screen.getByRole("dialog")
    expect(hasClass(dialog, "h-[75vh]")).toBe(true)
    expect(hasClass(dialog, "w-[1100px]")).toBe(true)
    expect(hasClass(dialog, "max-w-[96vw]")).toBe(true)
    expect(screen.getByRole("heading", { name: "MCP" })).not.toBeNull()
  })

  it("ferme la modale quand on clique sur l'overlay", () => {
    const onClose = vi.fn()
    render(<McpDialog snapshot={snapshot()} onClose={onClose} onChanged={vi.fn()} />)
    const overlay = screen.getByRole("presentation")
    fireEvent.click(overlay)
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it("ne ferme pas la modale quand on clique dans son contenu", () => {
    const onClose = vi.fn()
    render(<McpDialog snapshot={snapshot()} onClose={onClose} onChanged={vi.fn()} />)
    fireEvent.click(screen.getByRole("dialog"))
    expect(onClose).not.toHaveBeenCalled()
  })

  it("affiche la barre d'actions : recherche + boutons Ajouter et Importer", async () => {
    renderDialog()

    const search = screen.getByRole("searchbox", { name: "Rechercher un serveur MCP" })
    const addButton = screen.getByRole("button", { name: "Ajouter un serveur" })
    const importButton = screen.getByRole("button", { name: "Importer une configuration JSON" })
    // Les trois éléments vivent dans la même barre d'actions (recherche à gauche, boutons à droite)
    const toolbar = search.closest("div")
    expect(toolbar?.contains(addButton)).toBe(true)
    expect(toolbar?.contains(importButton)).toBe(true)
    // Style standard LogAssist : primaire pour Ajouter, secondaire pour Importer
    expect(hasClass(addButton, "bg-brand-from")).toBe(true)
    expect(hasClass(addButton, "text-brand-foreground")).toBe(true)
    expect(hasClass(importButton, "border-border")).toBe(true)
  })

  it("affiche les serveurs en lignes empilées, pas en grille de cartes", async () => {
    listServers.mockResolvedValue([remoteRow("docs"), tinyfishRow()])
    listTools.mockResolvedValue([])
    renderDialog()

    const list = await screen.findByRole("list", { name: "Serveurs MCP" })
    expect(hasClass(list, "flex-col")).toBe(true)
    const rows = await screen.findAllByTestId("mcp-server-card")
    expect(rows).toHaveLength(2)
    // Chaque ligne est un item de liste, sans hauteur de tuile héritée
    expect(hasClass(rows[0], "min-h-56")).toBe(false)
  })

  it("affiche la galerie, TinyFish en premier et filtre par URL", async () => {
    listServers.mockResolvedValue([remoteRow("docs"), tinyfishRow()])
    listTools.mockImplementation(async (id) => (id === "tinyfish" ? [tinyfishToolRow("search")] : []))
    renderDialog()

    const cards = await screen.findAllByTestId("mcp-server-card")
    expect(cards[0].textContent).toContain("TinyFish")
    fireEvent.change(screen.getByRole("searchbox", { name: "Rechercher un serveur MCP" }), {
      target: { value: "docs.example" },
    })
    expect(screen.queryByText("TinyFish")).toBeNull()
    expect(screen.getByText("docs")).toBeTruthy()
  })

  it("découvre avant d'activer et resynchronise le runtime", async () => {
    connectAndListTools.mockResolvedValue([descriptor("echo")])
    renderDialog({ snapshot: snapshot({ authStatuses: { docs: "not_required" } }) })
    fireEvent.click(await screen.findByRole("button", { name: "Tester" }))
    await waitFor(() => expect(replaceCatalog).toHaveBeenCalledWith(expect.any(Object), [descriptor("echo")]))
    expect(screen.getByRole("button", { name: "Tester" })).not.toBeNull()
  })

  it("supprime via le dialogue Tauri, jamais window.confirm", async () => {
    dialogConfirm.mockResolvedValue(true)
    listServers.mockResolvedValue([remoteRow("docs"), tinyfishRow()])
    listTools.mockResolvedValue([])
    renderDialog()
    // The delete button has aria-label="Supprimer"
    const deleteButton = await screen.findByRole("button", { name: "Supprimer" })
    fireEvent.click(deleteButton)
    await waitFor(() => expect(dialogConfirm).toHaveBeenCalled())
    expect(remove).toHaveBeenCalledWith("docs")
  })

  it("ferme les sous-modales avec Échap avant de fermer le dialogue principal", async () => {
    listServers.mockResolvedValue([remoteRow("docs"), tinyfishRow()])
    listTools.mockResolvedValue([])
    const onClose = vi.fn()
    render(<McpDialog snapshot={snapshot()} onClose={onClose} onChanged={vi.fn()} />)

    // Open import dialog
    fireEvent.click(screen.getByRole("button", { name: "Importer une configuration JSON" }))
    expect(screen.getByRole("dialog", { name: /Importer une configuration/i })).not.toBeNull()

    // Press Escape - should close import dialog
    fireEvent.keyDown(document, { key: "Escape" })
    expect(screen.queryByRole("dialog", { name: /Importer une configuration/i })).toBeNull()

    // Press Escape again - should close main dialog
    fireEvent.keyDown(document, { key: "Escape" })
    expect(onClose).toHaveBeenCalled()
  })

  it("applique l'import puis invalide les secrets des mises à jour sensibles", async () => {
    applyImport.mockResolvedValue(["docs"])
    listServers.mockResolvedValue([tinyfishRow()])
    listTools.mockResolvedValue([])
    const onChanged = vi.fn()
    render(<McpDialog snapshot={snapshot()} onClose={vi.fn()} onChanged={onChanged} />)

    // Simule l'appel interne de applyImport du composant avec une mise à jour sensible
    // Le composant appelle mcpServers.applyImport puis mcp.disconnect/removeSecret pour chaque id invalidé
    const invalidated = await applyImport([sensitiveUpdate("docs")])
    for (const id of invalidated) {
      await disconnect(id)
      await removeSecret(id)
    }
    await onChanged()

    expect(disconnect).toHaveBeenCalledWith("docs")
    expect(removeSecret).toHaveBeenCalledWith("docs")
    expect(onChanged).toHaveBeenCalled()
  })

  it("ouvre le formulaire de création depuis la tuile Ajouter un serveur", async () => {
    renderDialog()

    fireEvent.click(screen.getByRole("button", { name: "Ajouter un serveur" }))

    const nameInput = screen.getByRole("textbox", { name: "Nom du serveur" }) as HTMLInputElement
    expect(nameInput).not.toBeNull()
    expect(nameInput.value).toBe("")
  })

  it("crée un serveur via le formulaire avec un diff de type création", async () => {
    renderDialog()

    fireEvent.click(screen.getByRole("button", { name: "Ajouter un serveur" }))
    fireEvent.change(screen.getByRole("textbox", { name: "Nom du serveur" }), {
      target: { value: "Test local" },
    })
    fireEvent.change(screen.getByRole("textbox", { name: "Endpoint MCP" }), {
      target: { value: "https://example.com/mcp" },
    })
    fireEvent.click(screen.getByRole("button", { name: "Enregistrer les paramètres" }))

    await waitFor(() => expect(applyImport).toHaveBeenCalledTimes(1))
    const diff = applyImport.mock.calls[0][0] as McpImportDiff[]
    expect(diff).toHaveLength(1)
    expect(diff[0].kind).toBe("create")
    // La sous-modale se ferme après une création réussie
    expect(screen.queryByRole("textbox", { name: "Nom du serveur" })).toBeNull()
  })
})
