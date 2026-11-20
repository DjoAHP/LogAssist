// src/components/settings/TinyfishDialog.tsx
// Édition portable : TinyFish est le seul serveur accessible. Aucune notion
// d'ajout, d'import ou de sélection de serveur n'est exposée ici — le panneau
// se limite à la clé, à l'activation et aux outils du serveur intégré.
import { useCallback, useEffect, useRef, useState } from "react"
import { CircleAlert, CircleCheck, LoaderCircle, RadioTower } from "lucide-react"
import { McpIcon } from "@/icons"

import { t } from "@/i18n/fr"
import { mcpUiError } from "@/lib/mcp/errorMessages"
import { mcp } from "@/lib/mcp/client"
import { mcpServers, serverConfigFromRow } from "@/lib/db/mcpServers"
import { buildActiveToolCatalog } from "@/lib/mcp/catalog"
import { logger } from "@/lib/logger"
import { confirm as dialogConfirm } from "@tauri-apps/plugin-dialog"
import type { McpAgentTool, McpServerConfig, McpToolRow } from "@/lib/mcp/types"
import type { McpRuntimeSnapshot } from "@/lib/mcp/runtime"
import { McpToolsDialog } from "./McpToolsDialog"
import { HEADER_TOOL_DIALOG_SIZE_CLASS } from "./headerToolDialog"

const TINYFISH_ID = "tinyfish"

type TinyfishStatusState =
  | "disabled"
  | "not_configured"
  | "ready"
  | "connected"
  | "connecting"
  | "auth"
  | "offline"
  | "timeout"
  | "protocol"

type TinyfishStatus = { state: TinyfishStatusState }

// DESIGN_SYSTEM.md : texte, icône et couleur varient ensemble.
const statusToneClass: Record<TinyfishStatusState, string> = {
  disabled: "text-muted-foreground",
  not_configured: "text-muted-foreground",
  ready: "text-muted-foreground",
  connected: "text-green-600 dark:text-green-400",
  connecting: "text-muted-foreground",
  auth: "text-destructive",
  offline: "text-destructive",
  timeout: "text-destructive",
  protocol: "text-destructive",
}

const ERROR_STATES: TinyfishStatusState[] = ["auth", "offline", "timeout", "protocol"]

function statusLabel(state: TinyfishStatusState): string {
  return t.portableWeb.status[state === "not_configured" ? "notConfigured" : state]
}

// Normalise la nature d'échec du pont Rust : seuls auth/timeout/protocol sont
// distinctifs, tout le reste est traité comme une indisponibilité réseau.
function failureState(cause: unknown): TinyfishStatusState {
  const kind = cause instanceof Error && "kind" in cause ? (cause as { kind: unknown }).kind : "unknown"
  if (kind === "auth") return "auth"
  if (kind === "timeout") return "timeout"
  if (kind === "protocol") return "protocol"
  return "offline"
}

interface Props {
  snapshot: McpRuntimeSnapshot
  onClose(): void
  onChanged(): Promise<void> | void
}

export function TinyfishDialog({ snapshot, onClose, onChanged }: Props) {
  const [server, setServer] = useState<McpServerConfig | null>(null)
  const [tools, setTools] = useState<McpToolRow[]>([])
  const [secret, setSecret] = useState("")
  const [busy, setBusy] = useState(false)
  const [actionBusy, setActionBusy] = useState(false)
  const [status, setStatus] = useState<TinyfishStatus | null>(null)
  const [error, setError] = useState<string>()
  const [browsing, setBrowsing] = useState(false)
  const keyRef = useRef<HTMLInputElement>(null)
  const returnFocusRef = useRef<HTMLElement | null>(null)

  // Filtre volontaire : même si une autre ligne subsistait en base, l'édition
  // portable ne peut afficher ni configurer un autre serveur.
  const refresh = useCallback(async () => {
    const rows = await mcpServers.list()
    const row = rows.find((candidate) => candidate.id === TINYFISH_ID)
    if (!row) {
      setServer(null)
      setTools([])
      return
    }
    setServer(serverConfigFromRow(row))
    setTools(await mcpServers.listTools(TINYFISH_ID))
  }, [])

  const afterChange = useCallback(async () => {
    await refresh()
    await onChanged()
  }, [onChanged, refresh])

  useEffect(() => {
    void refresh().catch((cause) => {
      logger.error({ context: "portable.web.refresh", message: String(cause) })
    })
  }, [refresh])

  useEffect(() => {
    returnFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
    keyRef.current?.focus()
    return () => returnFocusRef.current?.focus()
  }, [])

  // Échap : sous-modale des outils d'abord, panneau ensuite.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return
      if (browsing) setBrowsing(false)
      else onClose()
    }
    window.addEventListener("keydown", onKeyDown)
    return () => window.removeEventListener("keydown", onKeyDown)
  }, [browsing, onClose])

  const serverName = server?.name ?? t.portableWeb.provider

  const discover = async (key?: string) => {
    if (!server) return
    setBusy(true)
    setError(undefined)
    setStatus({ state: "connecting" })
    try {
      const discovered = key === undefined
        ? await mcp.connectAndListTools(TINYFISH_ID)
        : await mcp.configureAuth(TINYFISH_ID, key)
      // Le catalogue n'est écrit qu'après une découverte réussie : une clé
      // refusée ne doit jamais laisser un état partiel en base.
      await mcpServers.replaceCatalog(server, discovered)
      setStatus({ state: "connected" })
      setSecret("")
      await afterChange()
    } catch (cause) {
      setStatus({ state: failureState(cause) })
      setError(mcpUiError(cause))
    } finally {
      setBusy(false)
    }
  }

  const submitKey = async () => {
    const trimmed = secret.trim()
    if (!trimmed) return
    await discover(trimmed)
  }

  const removeKey = async () => {
    const confirmed = await dialogConfirm(t.portableWeb.deleteConfirm, { title: serverName, kind: "warning" })
    if (!confirmed) return
    setActionBusy(true)
    setError(undefined)
    try {
      await mcp.removeSecret(TINYFISH_ID)
      // Sans identifiant, le serveur ne peut plus être actif : on retombe sur
      // l'état « non configuré » plutôt que de laisser un accès Web fantôme.
      await mcpServers.setEnabled(TINYFISH_ID, false)
      setStatus(null)
      await afterChange()
    } catch (cause) {
      setError(mcpUiError(cause))
    } finally {
      setActionBusy(false)
    }
  }

  const toggleWeb = async (enabled: boolean) => {
    setActionBusy(true)
    setError(undefined)
    try {
      await mcpServers.setEnabled(TINYFISH_ID, enabled)
      await afterChange()
    } catch (cause) {
      setError(mcpUiError(cause))
    } finally {
      setActionBusy(false)
    }
  }

  const toggleTool = async (nativeName: string, enabled: boolean) => {
    const row = tools.find((candidate) => candidate.native_name === nativeName)
    if (!row) return
    if (enabled) {
      const candidate: McpAgentTool = {
        serverId: TINYFISH_ID,
        serverName,
        nativeName: row.native_name,
        llmName: row.llm_name,
        title: row.title ?? undefined,
        description: row.description ?? undefined,
        inputSchema: JSON.parse(row.input_schema) as Record<string, unknown>,
        approvalMode: row.approval_mode,
        kind: "tinyfish_web",
      }
      // Catalogue validé AVANT persistance (64 outils / 256 Kio).
      await buildActiveToolCatalog([...snapshot.activeTools, candidate])
    }
    await mcpServers.setToolEnabled(TINYFISH_ID, nativeName, enabled)
    await afterChange()
  }

  const toggleAllTools = async (enabled: boolean, nativeNames: string[]) => {
    if (enabled) {
      const active = new Set(snapshot.activeTools.map((tool) => tool.llmName))
      const additions: McpAgentTool[] = tools
        .filter((row) => nativeNames.includes(row.native_name) && !active.has(row.llm_name))
        .map((row) => ({
          serverId: TINYFISH_ID,
          serverName,
          nativeName: row.native_name,
          llmName: row.llm_name,
          title: row.title ?? undefined,
          description: row.description ?? undefined,
          inputSchema: JSON.parse(row.input_schema) as Record<string, unknown>,
          approvalMode: row.approval_mode,
          kind: "tinyfish_web" as const,
        }))
      await buildActiveToolCatalog([...snapshot.activeTools, ...additions])
    }
    await mcpServers.setAllToolsEnabled(TINYFISH_ID, enabled, nativeNames)
    await afterChange()
  }

  const auth = snapshot.authStatuses[TINYFISH_ID]
  const configured = auth === "configured" || auth === "not_required"
  // Même règle que la galerie bureau : on n'active pas un serveur sans outil
  // découvert, sinon le tour suivant partirait avec un accès Web inutilisable.
  const canToggle = configured && tools.length > 0
  const derived: TinyfishStatus =
    auth === "missing" ? { state: "not_configured" }
      : auth === "stale" ? { state: "auth" }
        : server && !server.enabled ? { state: "disabled" }
          : { state: "ready" }
  const current = status ?? derived

  const spinning = busy || current.state === "connecting"
  const StatusIcon = spinning
    ? LoaderCircle
    : current.state === "connected"
      ? CircleCheck
      : ERROR_STATES.includes(current.state)
        ? CircleAlert
        : RadioTower

  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-black/55 p-4"
      role="presentation"
      onClick={onClose}
    >
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="portable-web-title"
        className={`${HEADER_TOOL_DIALOG_SIZE_CLASS} flex flex-col overflow-hidden rounded-lg border border-border bg-background shadow-2xl`}
        onClick={(event) => event.stopPropagation()}
      >
        <header className="flex items-start justify-between border-b border-border px-5 py-4">
          <div>
            <div className="flex items-center gap-2">
              <h2 id="portable-web-title" className="text-base font-semibold">{t.portableWeb.title}</h2>
              <McpIcon className="size-4 text-muted-foreground opacity-70" />
            </div>
            <p className="mt-1 text-sm text-muted-foreground">{t.portableWeb.description}</p>
          </div>
          <button
            type="button"
            aria-label={t.portableWeb.close}
            onClick={onClose}
            className="rounded-md p-1.5 hover:bg-foreground/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-to"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto p-5">
          {error && <p role="alert" className="mb-3 text-xs text-destructive">{error}</p>}
          <p className="mb-3 text-xs text-muted-foreground">
            {snapshot.activeTools.length} {t.portableWeb.activeTools}
          </p>

          <div className="rounded-lg border border-border bg-background p-3">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="text-sm font-semibold">{serverName}</h3>
              <span className="rounded-full border border-brand-to/40 px-1.5 text-[9px] text-brand-to">
                {t.portableWeb.integrated}
              </span>
              <span
                className={`inline-flex items-center gap-1 text-sm ${statusToneClass[current.state]}`}
                role="status"
                aria-live="polite"
              >
                <StatusIcon className={`size-3.5 ${spinning ? "animate-spin motion-reduce:animate-none" : ""}`} />
                {statusLabel(current.state)}
              </span>
            </div>
            <p className="mt-1 truncate text-xs text-muted-foreground">{server?.endpoint ?? ""}</p>
            <p className="mt-2 text-xs text-muted-foreground">{t.portableWeb.allowedTools}</p>

            <div className="mt-3 flex flex-wrap items-end gap-2">
              <div className="min-w-0 flex-1">
                <label htmlFor="tinyfish-key" className="mb-1 block text-xs font-medium">
                  {t.portableWeb.apiKey}
                </label>
                <input
                  ref={keyRef}
                  id="tinyfish-key"
                  type="password"
                  autoComplete="off"
                  value={secret}
                  placeholder={t.portableWeb.apiKeyPlaceholder}
                  onChange={(event) => setSecret(event.target.value)}
                  className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-to"
                />
              </div>
              <button
                type="button"
                onClick={() => void submitKey()}
                disabled={busy || secret.trim().length === 0}
                className="rounded-md bg-brand-from px-3 py-2 text-sm text-brand-foreground hover:opacity-90 disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-to"
              >
                {busy ? t.portableWeb.testing : t.portableWeb.testAndSave}
              </button>
            </div>

            <div className="mt-3 flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => void discover()}
                disabled={busy || !configured}
                className="inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-sm hover:bg-foreground/5 disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-to"
              >
                <RadioTower className="size-4" />
                {t.portableWeb.refreshTools}
              </button>
              <button
                type="button"
                onClick={() => setBrowsing(true)}
                disabled={tools.length === 0}
                className="rounded-md border border-border px-3 py-1.5 text-sm hover:border-brand-to hover:text-brand-to disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-to"
              >
                {t.portableWeb.browseTools} <span className="text-muted-foreground">({tools.length})</span>
              </button>
              <button
                type="button"
                onClick={() => void removeKey()}
                disabled={actionBusy || !configured}
                className="rounded-md px-3 py-1.5 text-sm text-destructive hover:bg-destructive/10 disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-destructive"
              >
                {t.portableWeb.deleteKey}
              </button>
              <label className="ml-auto flex items-center gap-2 text-xs">
                <span>{t.portableWeb.webEnabled}</span>
                <input
                  type="checkbox"
                  aria-label={t.portableWeb.webEnabled}
                  checked={server?.enabled ?? false}
                  disabled={actionBusy || (!server?.enabled && !canToggle)}
                  onChange={(event) => void toggleWeb(event.target.checked)}
                  className="size-4 accent-brand-from disabled:opacity-40"
                />
              </label>
            </div>
            {configured && tools.length === 0 && (
              <p className="mt-2 text-xs text-muted-foreground">{t.portableWeb.noTools}</p>
            )}
          </div>
        </div>

        {browsing && server && (
          <McpToolsDialog
            server={server}
            tools={tools}
            onToggle={(nativeName, enabled) => void toggleTool(nativeName, enabled)}
            onToggleAll={(enabled, nativeNames) => void toggleAllTools(enabled, nativeNames)}
            onApprovalMode={(nativeName, mode) => {
              void mcpServers.setApprovalMode(TINYFISH_ID, nativeName, mode)
                .then(afterChange)
                .catch((cause) => setError(mcpUiError(cause)))
            }}
            onRun={(nativeName, arguments_) =>
              mcp.testTool(TINYFISH_ID, crypto.randomUUID(), nativeName, arguments_)
            }
            onConfirmRisk={() => dialogConfirm(t.mcp.confirmRiskyTool, { title: serverName, kind: "warning" })}
            onClose={() => setBrowsing(false)}
          />
        )}
      </section>
    </div>
  )
}
