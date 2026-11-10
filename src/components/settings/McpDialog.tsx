import { useCallback, useEffect, useRef, useState } from "react"
import { Plus } from "lucide-react"

import { t } from "@/i18n/fr"
import { mcpUiError } from "@/lib/mcp/errorMessages"
import { mcp } from "@/lib/mcp/client"
import { mcpServers, serverConfigFromRow } from "@/lib/db/mcpServers"
import { buildActiveToolCatalog } from "@/lib/mcp/catalog"
import { logger } from "@/lib/logger"
import { diffMcpImport, type McpImportDiff } from "@/lib/mcp/importConfig"
import { confirm as dialogConfirm } from "@tauri-apps/plugin-dialog"
import type {
  McpAgentTool,
  McpAuthStatus,
  McpServerConfig,
  McpServerRow,
  McpToolRow,
} from "@/lib/mcp/types"
import type { McpRuntimeSnapshot } from "@/lib/mcp/runtime"
import type { McpServerStatus } from "./McpServerCard"
import { McpImportDialog } from "./McpImportDialog"
import { McpServerCard } from "./McpServerCard"
import { McpServerForm } from "./McpServerForm"
import { McpToolsDialog } from "./McpToolsDialog"
import { HEADER_TOOL_DIALOG_SIZE_CLASS } from "./headerToolDialog"

interface Props {
  snapshot: McpRuntimeSnapshot
  onClose(): void
  onChanged(): Promise<void> | void
}

export function McpDialog({ snapshot, onClose, onChanged }: Props) {
  const [rows, setRows] = useState<McpServerRow[]>([])
  const [tools, setTools] = useState<Record<string, McpToolRow[]>>({})
  const [statuses, setStatuses] = useState<Record<string, McpServerStatus>>({})
  const [query, setQuery] = useState("")
  const [importing, setImporting] = useState(false)
  const [editing, setEditing] = useState<McpServerConfig | null>(null)
  const [browsing, setBrowsing] = useState<McpServerConfig | null>(null)
  const [actionError, setActionError] = useState<string>()
  const [busyServers, setBusyServers] = useState<Set<string>>(new Set())
  const searchRef = useRef<HTMLInputElement>(null)
  const returnFocusRef = useRef<HTMLElement | null>(null)

  const refresh = useCallback(async () => {
    const nextRows = await mcpServers.list()
    const nextTools = await Promise.all(
      nextRows.map(async (row) => [row.id, await mcpServers.listTools(row.id)] as const),
    )
    setRows(nextRows)
    setTools(Object.fromEntries(nextTools))
  }, [])

  const afterChange = useCallback(async () => {
    await refresh()
    await onChanged()
  }, [onChanged, refresh])

  const runUi = async (action: () => Promise<void>) => {
    setActionError(undefined)
    try {
      await action()
    } catch (error) {
      setActionError(mcpUiError(error))
    }
  }

  // Initial refresh
  useEffect(() => {
    void refresh().catch((error) => {
      logger.error({ context: "mcp.dialog.refresh", message: String(error) })
    })
  }, [refresh])

  // Initial focus on search input + return focus on close
  useEffect(() => {
    returnFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
    searchRef.current?.focus()
    return () => returnFocusRef.current?.focus()
  }, [])

  // Escape key handling: close sub-modals first, then dialog
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return
      if (browsing) {
        setBrowsing(null)
      } else if (editing) {
        setEditing(null)
      } else if (importing) {
        setImporting(false)
      } else {
        onClose()
      }
    }
    window.addEventListener("keydown", onKeyDown)
    return () => window.removeEventListener("keydown", onKeyDown)
  }, [browsing, editing, importing, onClose])

  const discover = async (server: McpServerConfig, secret?: string) => {
    setStatuses((current) => ({ ...current, [server.id]: { state: "connecting" } }))
    try {
      const discovered = secret === undefined
        ? await mcp.connectAndListTools(server.id)
        : await mcp.configureAuth(server.id, secret)
      await mcpServers.replaceCatalog(server, discovered)
      setStatuses((current) => ({ ...current, [server.id]: { state: "connected" } }))
      await afterChange()
    } catch (error) {
      const kind = error instanceof Error && "kind" in error ? (error as { kind: string }).kind : "unknown"
      const state = kind === "auth" ? "auth" : kind === "timeout" ? "timeout" : kind === "protocol" ? "protocol" : "offline"
      setStatuses((current) => ({ ...current, [server.id]: { state } }))
    }
  }

  const applyImport = async (diff: McpImportDiff[]) => {
    const invalidated = await mcpServers.applyImport(diff)
    let cleanupError: unknown
    try {
      for (const id of invalidated) {
        await mcp.disconnect(id)
        await mcp.removeSecret(id)
      }
    } catch (error) {
      cleanupError = error
    } finally {
      await afterChange()
    }
    if (cleanupError) throw cleanupError
  }

  const removeServer = async (server: McpServerConfig) => {
    const confirmed = await dialogConfirm(t.mcp.deleteConfirm, { title: server.name, kind: "warning" })
    if (!confirmed) return
    await mcp.disconnect(server.id)
    await mcp.removeSecret(server.id)
    await mcpServers.remove(server.id)
    await afterChange()
  }

  const toggleServer = async (server: McpServerConfig, enabled: boolean) => {
    if (busyServers.has(server.id)) return
    if (enabled) {
      const status = snapshot.authStatuses[server.id]
      if (
        !(["configured", "not_required"] as McpAuthStatus[]).includes(status) ||
        (tools[server.id] ?? []).length === 0
      ) {
        return
      }
    }
    setBusyServers((prev) => new Set(prev).add(server.id))
    try {
      await mcpServers.setEnabled(server.id, enabled)
      await afterChange()
    } finally {
      setBusyServers((prev) => {
        const next = new Set(prev)
        next.delete(server.id)
        return next
      })
    }
  }

  const runManualTool = async (serverId: string, nativeName: string, arguments_: Record<string, unknown>) => {
    const callId = crypto.randomUUID()
    return mcp.testTool(serverId, callId, nativeName, arguments_)
  }

  const toggleTool = async (server: McpServerConfig, nativeName: string, enabled: boolean) => {
    if (enabled) {
      const row = (tools[server.id] ?? []).find((candidate) => candidate.native_name === nativeName)
      if (!row) return
      const candidate: McpAgentTool = {
        serverId: server.id,
        serverName: server.name,
        nativeName: row.native_name,
        llmName: row.llm_name,
        title: row.title ?? undefined,
        description: row.description ?? undefined,
        inputSchema: JSON.parse(row.input_schema) as Record<string, unknown>,
        approvalMode: row.approval_mode,
        kind: server.id === "tinyfish" ? "tinyfish_web" : "generic",
      }
      await buildActiveToolCatalog([...snapshot.activeTools, candidate])
    }
    await mcpServers.setToolEnabled(server.id, nativeName, enabled)
    await afterChange()
  }

  // Build server configs from rows
  const serverConfigs = rows.map(serverConfigFromRow)

  // Sort: TinyFish (builtin) first, then by created_at
  serverConfigs.sort((a, b) => (b.builtin ? 1 : 0) - (a.builtin ? 1 : 0))

  const startCreate = () => {
    const usedIds = new Set(serverConfigs.map((server) => server.id))
    const idBase = `mcp-${Date.now().toString(36)}`
    let id = idBase
    let suffix = 2
    while (usedIds.has(id)) {
      id = `${idBase}-${suffix}`
      suffix += 1
    }

    setEditing({
      id,
      name: "",
      endpoint: "",
      transport: "streamable_http",
      auth: { type: "none" },
      timeoutMs: 30_000,
      enabled: false,
      builtin: false,
    })
  }

  const editingIsCreate = editing !== null && !serverConfigs.some((server) => server.id === editing.id)

  // Filter servers by query (name or endpoint)
  const normalizedQuery = query.trim().toLocaleLowerCase("fr")
  const filteredServers = serverConfigs.filter((server) =>
    !normalizedQuery ||
    server.name.toLocaleLowerCase("fr").includes(normalizedQuery) ||
    server.endpoint.toLocaleLowerCase("fr").includes(normalizedQuery)
  )

  // Derive status for each server from transient statuses or snapshot auth statuses
  const statusFor = (server: McpServerConfig): McpServerStatus => {
    const transient = statuses[server.id]
    if (transient) return transient
    const auth = snapshot.authStatuses[server.id]
    if (auth === "missing") return { state: "not_configured" }
    if (auth === "stale") return { state: "auth" }
    if (!server.enabled) return { state: "disabled" }
    return { state: "ready" }
  }

  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-black/55 p-4"
      role="presentation"
      onClick={onClose}
    >
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="mcp-title"
        className={`${HEADER_TOOL_DIALOG_SIZE_CLASS} flex flex-col overflow-hidden rounded-lg border border-border bg-background shadow-2xl`}
        onClick={(event) => event.stopPropagation()}
      >
        <header className="flex items-start justify-between border-b border-border px-5 py-4">
          <div>
            <h2 id="mcp-title" className="text-base font-semibold">
              {t.mcp.title}
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">{t.mcp.description}</p>
          </div>
          <button aria-label={t.mcp.close} onClick={onClose} className="rounded-md p-1.5 hover:bg-foreground/5">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto p-5">
          {actionError && (
            <p role="alert" className="mb-3 text-xs text-destructive">
              {actionError}
            </p>
          )}
          <p className="mb-2 text-xs text-muted-foreground">
            {snapshot.activeTools.length} {t.mcp.activeTools}
          </p>
          <div className="flex items-center justify-between gap-2 mb-3">
            <input
              ref={searchRef}
              type="search"
              aria-label={t.mcp.searchServers}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              className="flex-1 min-w-0 rounded-md border border-border bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-to"
            />
            <div className="flex items-center gap-2 flex-shrink-0">
              <button
                type="button"
                onClick={() => setImporting(true)}
                className="rounded-md border border-border px-3 py-1.5 text-sm hover:bg-foreground/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-to"
              >
                {t.mcp.importConfig}
              </button>
              <button
                type="button"
                onClick={startCreate}
                className="rounded-md bg-brand-from px-3 py-1.5 text-sm text-brand-foreground hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-to"
              >
                <Plus className="size-3.5 mr-1.5" />
                {t.mcp.addServer}
              </button>
            </div>
          </div>
          <ul
            role="list"
            aria-label="Serveurs MCP"
            className="flex flex-col gap-2 min-h-0 overflow-y-auto"
          >
            {filteredServers.map((server) => (
              <McpServerCard
                key={server.id}
                server={server}
                toolCount={(tools[server.id] ?? []).length}
                canEnable={(
                  ["configured", "not_required"] as McpAuthStatus[]
                ).includes(snapshot.authStatuses[server.id]) && (tools[server.id] ?? []).length > 0}
                status={statusFor(server)}
                onTest={() => void discover(server).catch(() => undefined)}
                onRefresh={() => void discover(server).catch(() => undefined)}
                onEdit={() => setEditing(server)}
                onDelete={() => void removeServer(server)}
                onBrowse={() => setBrowsing(server)}
                onToggle={(enabled) => void toggleServer(server, enabled)}
              />
            ))}
          </ul>
        </div>

        {importing && (
          <McpImportDialog
            existing={serverConfigs}
            onValidate={(servers) => mcp.validateConfigs(servers.map((server) => ({ ...server, tools: [] })))}
            onApply={applyImport}
            onClose={() => setImporting(false)}
          />
        )}
        {editing && (
          <div className="fixed inset-0 z-[60] grid place-items-center bg-black/65 p-4">
            <section
              role="dialog"
              aria-modal="true"
              aria-label={editingIsCreate ? t.mcp.addServer : `${t.mcp.edit} — ${editing.name}`}
              className="w-[640px] max-w-[94vw] rounded-lg border border-border bg-background p-4"
            >
              <McpServerForm
                initial={editing}
                authStatus={snapshot.authStatuses[editing.id] ?? "missing"}
                onSave={async (next) => {
                  await applyImport(diffMcpImport([next], editingIsCreate ? [] : [editing]))
                  setEditing(null)
                }}
                onConfigureSecret={async (next, secret) => {
                  await applyImport(diffMcpImport([next], editingIsCreate ? [] : [editing]))
                  await discover(next, secret)
                  setEditing(next)
                }}
                onDeleteSecret={async () => {
                  await mcp.removeSecret(editing.id)
                  await mcpServers.setEnabled(editing.id, false)
                  await afterChange()
                }}
                onCancel={() => setEditing(null)}
              />
            </section>
          </div>
        )}
        {browsing && (
          <McpToolsDialog
            server={browsing}
            tools={tools[browsing.id] ?? []}
            onToggle={(nativeName, enabled) => void runUi(() => toggleTool(browsing, nativeName, enabled))}
            onApprovalMode={(nativeName, mode) =>
              void runUi(async () => {
                await mcpServers.setApprovalMode(browsing.id, nativeName, mode)
                await afterChange()
              })
            }
            onRun={(nativeName, arguments_) => runManualTool(browsing.id, nativeName, arguments_)}
            onConfirmRisk={() => dialogConfirm(t.mcp.confirmRiskyTool, { title: browsing.name, kind: "warning" })}
            onClose={() => setBrowsing(null)}
          />
        )}
      </section>
    </div>
  )
}
