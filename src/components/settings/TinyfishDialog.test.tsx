// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { McpRuntimeSnapshot } from "@/lib/mcp/runtime"

const listServers = vi.hoisted(() => vi.fn())
const listTools = vi.hoisted(() => vi.fn())
const replaceCatalog = vi.hoisted(() => vi.fn())
const setEnabled = vi.hoisted(() => vi.fn())
const setToolEnabled = vi.hoisted(() => vi.fn())
const setAllToolsEnabled = vi.hoisted(() => vi.fn())
const setApprovalMode = vi.hoisted(() => vi.fn())
const configureAuth = vi.hoisted(() => vi.fn())
const connectAndListTools = vi.hoisted(() => vi.fn())
const testTool = vi.hoisted(() => vi.fn())
const removeSecret = vi.hoisted(() => vi.fn())
const dialogConfirm = vi.hoisted(() => vi.fn())

vi.mock("@/lib/db/mcpServers", () => ({
  mcpServers: {
    list: listServers,
    listTools,
    replaceCatalog,
    setEnabled,
    setToolEnabled,
    setAllToolsEnabled,
    setApprovalMode,
  },
  serverConfigFromRow: vi.fn((row: Record<string, unknown>) => ({
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
  mcp: { configureAuth, connectAndListTools, testTool, removeSecret },
}))

vi.mock("@/lib/mcp/catalog", () => ({ buildActiveToolCatalog: vi.fn() }))
vi.mock("@/lib/mcp/errorMessages", () => ({ mcpUiError: () => "Clé refusée par TinyFish" }))
vi.mock("@tauri-apps/plugin-dialog", () => ({ confirm: dialogConfirm }))

import { TinyfishDialog } from "@/components/settings/TinyfishDialog"

const TINYFISH_ROW = {
  id: "tinyfish",
  name: "TinyFish",
  endpoint: "https://agent.tinyfish.ai/mcp",
  transport: "streamable_http",
  auth_type: "bearer",
  header_name: null,
  timeout_ms: 30_000,
  enabled: 1,
  builtin: 1,
  created_at: "2026-01-01T00:00:00.000Z",
  updated_at: "2026-01-01T00:00:00.000Z",
}

const TOOL_ROW = {
  server_id: "tinyfish",
  native_name: "search",
  llm_name: "tinyfish__search",
  title: "Search",
  description: "Recherche Web",
  input_schema: "{}",
  output_schema: null,
  annotations: null,
  enabled: 1,
  approval_mode: "auto" as const,
  schema_hash: "abc",
  discovered_at: "2026-01-01T00:00:00.000Z",
}

function snapshot(overrides: Partial<McpRuntimeSnapshot> = {}): McpRuntimeSnapshot {
  return {
    servers: [],
    activeTools: [],
    authStatuses: { tinyfish: "configured" },
    webAccess: { enabled: true, configured: true },
    connectors: { github: { binding: null, configured: false } },
    ...overrides,
  }
}

function renderDialog(overrides: Partial<McpRuntimeSnapshot> = {}) {
  const onChanged = vi.fn()
  const onClose = vi.fn()
  render(<TinyfishDialog snapshot={snapshot(overrides)} onClose={onClose} onChanged={onChanged} />)
  return { onChanged, onClose }
}

beforeEach(() => {
  listServers.mockResolvedValue([TINYFISH_ROW])
  listTools.mockResolvedValue([TOOL_ROW])
  replaceCatalog.mockResolvedValue([])
  setEnabled.mockResolvedValue(undefined)
  setToolEnabled.mockResolvedValue(undefined)
  setAllToolsEnabled.mockResolvedValue(undefined)
  setApprovalMode.mockResolvedValue(undefined)
  configureAuth.mockResolvedValue([])
  connectAndListTools.mockResolvedValue([])
  testTool.mockResolvedValue({ content: [], isError: false })
  removeSecret.mockResolvedValue(undefined)
  dialogConfirm.mockResolvedValue(true)
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe("TinyfishDialog", () => {
  it("utilise le gabarit standard des outils du header", async () => {
    renderDialog()
    const dialog = await screen.findByRole("dialog")
    expect(dialog.className).toContain("w-[1100px]")
    expect(screen.getByRole("heading", { name: "Recherche Web" })).toBeTruthy()
  })

  it("n'expose que TinyFish, sans ajout, import ni recherche de serveur", async () => {
    listServers.mockResolvedValue([
      TINYFISH_ROW,
      { ...TINYFISH_ROW, id: "autre", name: "Autre serveur", builtin: 0 },
    ])
    renderDialog()
    await screen.findByText("TinyFish")
    expect(screen.queryByText("Autre serveur")).toBeNull()
    expect(screen.queryByRole("button", { name: /ajouter/i })).toBeNull()
    expect(screen.queryByRole("button", { name: /importer/i })).toBeNull()
    expect(screen.queryByRole("searchbox")).toBeNull()
  })

  it("enregistre la clé : configureAuth puis replaceCatalog", async () => {
    const discovered = [{ nativeName: "search", inputSchema: {}, schemaHash: "abc" }]
    configureAuth.mockResolvedValue(discovered)
    const { onChanged } = renderDialog()
    const input = await screen.findByLabelText("Clé API TinyFish")
    fireEvent.change(input, { target: { value: "tf-123" } })
    fireEvent.click(screen.getByRole("button", { name: "Tester et enregistrer" }))
    await waitFor(() => expect(configureAuth).toHaveBeenCalledWith("tinyfish", "tf-123"))
    expect(replaceCatalog).toHaveBeenCalledWith(expect.objectContaining({ id: "tinyfish" }), discovered)
    await waitFor(() => expect(onChanged).toHaveBeenCalled())
  })

  it("affiche l'erreur normalisée et n'active rien quand la clé est refusée", async () => {
    configureAuth.mockRejectedValue(Object.assign(new Error("refusé"), { kind: "auth" }))
    renderDialog()
    const input = await screen.findByLabelText("Clé API TinyFish")
    fireEvent.change(input, { target: { value: "bad" } })
    fireEvent.click(screen.getByRole("button", { name: "Tester et enregistrer" }))
    const alert = await screen.findByRole("alert")
    expect(alert.textContent).toContain("Clé refusée par TinyFish")
    expect(setEnabled).not.toHaveBeenCalled()
  })

  it("active l'accès Web via setEnabled('tinyfish')", async () => {
    renderDialog()
    const toggle = await screen.findByRole("checkbox", { name: "Activer l'accès Web" })
    fireEvent.click(toggle)
    await waitFor(() => expect(setEnabled).toHaveBeenCalledWith("tinyfish", false))
  })

  it("supprime la clé après confirmation puis désactive le serveur", async () => {
    renderDialog()
    fireEvent.click(await screen.findByRole("button", { name: "Supprimer la clé" }))
    await waitFor(() => expect(dialogConfirm).toHaveBeenCalled())
    expect(removeSecret).toHaveBeenCalledWith("tinyfish")
    expect(setEnabled).toHaveBeenCalledWith("tinyfish", false)
  })

  it("ouvre les outils, bascule un outil et Échap ferme d'abord les outils", async () => {
    renderDialog()
    fireEvent.click(await screen.findByRole("button", { name: /parcourir les outils/i }))
    await screen.findByRole("dialog", { name: /outils/i })
    fireEvent.click(screen.getByRole("checkbox", { name: "Activer search" }))
    await waitFor(() => expect(setToolEnabled).toHaveBeenCalledWith("tinyfish", "search", false))
    fireEvent.keyDown(window, { key: "Escape" })
    await waitFor(() => expect(screen.queryByRole("dialog", { name: /outils/i })).toBeNull())
    expect(screen.getByRole("dialog")).toBeTruthy()
  })
})
