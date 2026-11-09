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
    <article
      data-testid="mcp-server-card"
      className="relative flex min-h-56 flex-col rounded-lg border border-border bg-background p-2.5 transition-colors hover:border-brand-from/50 focus-within:ring-2 focus-within:ring-brand-to motion-reduce:transition-none"
    >
      <header className="mb-2 flex items-start justify-between gap-1.5">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <h3 className="truncate text-[13px] font-semibold">{server.name}</h3>
            {server.builtin && (
              <span className="rounded-full border border-brand-to/40 px-1.5 text-[9px] text-brand-to">{t.mcp.integrated}</span>
            )}
          </div>
          <p className="mt-0.5 truncate text-[11px] text-muted-foreground" title={server.endpoint}>
            {server.endpoint}
          </p>
        </div>
        {!server.builtin && (
          <button
            type="button"
            aria-label={t.mcp.delete}
            onClick={onDelete}
            className="rounded-md p-1 text-muted-foreground hover:bg-destructive/10 hover:text-destructive focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-destructive"
          >
            <Trash2 className="size-3.5" />
          </button>
        )}
      </header>
      <span
        role="status"
        className="mb-1 inline-flex min-h-8 items-start gap-1 text-[10px] text-muted-foreground"
      >
        <StatusIcon
          className={`mt-0.5 size-3.5 shrink-0 ${busy ? "animate-spin motion-reduce:animate-none" : ""}`}
        />
        {statusLabel(status)}
      </span>
      <div className="grid grid-cols-3 gap-1 border-t border-border pt-1.5">
        <button
          type="button"
          onClick={onTest}
          disabled={busy}
          aria-label={t.mcp.test}
          className="flex min-h-16 flex-col items-center justify-center gap-1 rounded-md text-[11px] hover:bg-foreground/5 focus-visible:ring-2 focus-visible:ring-brand-to"
        >
          <RadioTower className="size-5" />
          {t.mcp.test}
        </button>
        <button
          type="button"
          onClick={onRefresh}
          disabled={busy}
          aria-label={t.mcp.refreshTools}
          className="flex min-h-16 flex-col items-center justify-center gap-1 rounded-md text-[11px] hover:bg-foreground/5 focus-visible:ring-2 focus-visible:ring-brand-to"
        >
          <RefreshCw className="size-5" />
          {t.mcp.refreshTools}
        </button>
        <button
          type="button"
          onClick={onEdit}
          aria-label={t.mcp.edit}
          className="flex min-h-16 flex-col items-center justify-center gap-1 rounded-md text-[11px] hover:bg-foreground/5 focus-visible:ring-2 focus-visible:ring-brand-to"
        >
          <Wrench className="size-5" />
          {t.mcp.edit}
        </button>
      </div>
      <button
        type="button"
        onClick={onBrowse}
        aria-label={`Parcourir les ${toolCount} outils disponibles`}
        className="mt-1.5 rounded-md border border-border px-2 py-1.5 text-xs font-medium hover:border-brand-to hover:text-brand-to focus-visible:ring-2 focus-visible:ring-brand-to"
      >
        {t.mcp.browseTools} <span className="text-muted-foreground">({toolCount})</span>
      </button>
      <label className="mt-2 flex items-center justify-between gap-2 text-xs">
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
    </article>
  )
}
