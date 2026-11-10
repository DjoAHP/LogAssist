import { CircleAlert, CircleCheck, LoaderCircle, RadioTower, RefreshCw, Trash2, Wrench } from "lucide-react"
import { t } from "@/i18n/fr"
import type { McpServerConfig } from "@/lib/mcp/types"

export type McpServerStatus =
  | { state: "disabled" | "not_configured" | "ready" | "connected" }
  | { state: "connecting" }
  | { state: "auth" | "offline" | "timeout" | "protocol" }

interface Props {
  server: McpServerConfig
  toolCount: number
  canEnable: boolean
  status: McpServerStatus
  onTest(): void
  onRefresh(): void
  onEdit(): void
  onDelete(): void
  onBrowse(): void
  onToggle(enabled: boolean): void
}

function statusLabel(status: McpServerStatus): string {
  const labels = {
    disabled: t.mcp.disabled,
    not_configured: t.mcp.notConfigured,
    ready: t.mcp.ready,
    connected: t.mcp.connected,
    connecting: t.mcp.connecting,
    auth: t.mcp.authRejected,
    offline: t.mcp.offline,
    timeout: t.mcp.timeout,
    protocol: t.mcp.protocolError,
  }
  return labels[status.state]
}

// Méthode — DESIGN_SYSTEM.md : chaque état réseau associe texte, icône ET couleur.
// Tonalité par état, même motif/tokens que ProviderCard (statusToneClass) :
// neutre → muted, succès → vert discret, échec → destructive. La couleur n'est
// jamais le seul canal : le libellé et l'icône varient déjà par état.
const statusToneClass: Record<McpServerStatus["state"], string> = {
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


export function McpServerCard({
  server,
  toolCount,
  canEnable,
  status,
  onTest,
  onRefresh,
  onEdit,
  onDelete,
  onBrowse,
  onToggle,
}: Props) {
  const busy = status.state === "connecting"
  const StatusIcon = busy
    ? LoaderCircle
    : status.state === "connected"
      ? CircleCheck
      : status.state === "auth" || status.state === "offline" || status.state === "timeout" || status.state === "protocol"
        ? CircleAlert
        : RadioTower

  return (
    <li
      data-testid="mcp-server-card"
      className="relative flex items-center gap-3 rounded-lg border border-border bg-background p-2 transition-colors hover:border-brand-from/50 focus-within:ring-2 focus-within:ring-brand-to motion-reduce:transition-none"
    >
      <div className="min-w-0 flex-1 min-h-10">
        <div className="flex items-center gap-1.5">
          <h3 className="truncate text-sm font-semibold">{server.name}</h3>
          {server.builtin && (
            <span className="rounded-full border border-brand-to/40 px-1.5 text-[9px] text-brand-to">{t.mcp.integrated}</span>
          )}
        </div>
        <p className="truncate text-xs text-muted-foreground" title={server.endpoint}>
          {server.endpoint}
        </p>
      </div>

      <span
        role="status"
        className={`inline-flex min-w-[120px] min-h-8 items-center gap-1 text-xs shrink-0 ${statusToneClass[status.state]}`}
      >
        <StatusIcon
          className={`size-3.5 shrink-0 ${busy ? "animate-spin motion-reduce:animate-none" : ""}`}
        />
        {statusLabel(status)}
      </span>

      <div className="flex items-center gap-1 shrink-0">
        <button
          type="button"
          onClick={onTest}
          disabled={busy}
          aria-label={t.mcp.test}
          className="rounded-md p-1.5 text-muted-foreground hover:bg-foreground/5 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-to"
        >
          <RadioTower className="size-4" />
        </button>
        <button
          type="button"
          onClick={onRefresh}
          disabled={busy}
          aria-label={t.mcp.refreshTools}
          className="rounded-md p-1.5 text-muted-foreground hover:bg-foreground/5 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-to"
        >
          <RefreshCw className="size-4" />
        </button>
        <button
          type="button"
          onClick={onEdit}
          aria-label={t.mcp.edit}
          className="rounded-md p-1.5 text-muted-foreground hover:bg-foreground/5 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-to"
        >
          <Wrench className="size-4" />
        </button>
        {!server.builtin && (
          <button
            type="button"
            aria-label={t.mcp.delete}
            onClick={onDelete}
            className="rounded-md p-1.5 text-muted-foreground hover:bg-destructive/10 hover:text-destructive focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-destructive"
          >
            <Trash2 className="size-4" />
          </button>
        )}
      </div>

      <button
        type="button"
        onClick={onBrowse}
        aria-label={`Parcourir les ${toolCount} outils disponibles`}
        className="rounded-md border border-border px-2 py-1 text-xs font-medium hover:border-brand-to hover:text-brand-to focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-to shrink-0"
      >
        {t.mcp.browseTools} <span className="text-muted-foreground">({toolCount})</span>
      </button>

      <label className="flex items-center justify-between gap-2 text-xs shrink-0">
        <span id={`mcp-toggle-label-${server.id}`}>{server.enabled ? t.mcp.disableServer : t.mcp.enableServer}</span>
        <input
          type="checkbox"
          id={`mcp-toggle-${server.id}`}
          checked={server.enabled}
          disabled={!server.enabled && !canEnable}
          onChange={(event) => onToggle(event.target.checked)}
          className="size-4 accent-brand-from disabled:opacity-40"
          aria-labelledby={`mcp-toggle-label-${server.id}`}
        />
      </label>
    </li>
  )
}