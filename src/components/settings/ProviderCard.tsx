import {
  CircleAlert,
  CircleCheck,
  CloudDownload,
  LoaderCircle,
  RadioTower,
  Trash2,
  Wrench,
  type LucideIcon,
} from "lucide-react"
import { t } from "@/i18n/fr"
import { type ProviderRow } from "@/lib/db/providers"

export type ProviderConnectionStatus =
  | { state: "idle" }
  | { state: "testing" }
  | { state: "ok" }
  | { state: "fail"; message: string }

export type ProviderFetchStatus =
  | { state: "fetching" }
  | { state: "ok"; added: number }
  | { state: "fail"; message: string }

export interface ProviderCardProps {
  provider: ProviderRow
  modelCount: number
  connectionStatus: ProviderConnectionStatus
  fetchStatus: ProviderFetchStatus | undefined
  onTest: () => void
  onFetchModels: () => void
  onEdit: () => void
  onDelete: () => void
  onBrowseModels: () => void
}

type ActionTone = "idle" | "loading" | "success" | "error"

interface ActionFeedback {
  text: string
  tone: ActionTone
}

interface ProviderActionProps {
  action: string
  statusId: string
  label: string
  Icon: LucideIcon
  feedback: ActionFeedback
  disabled: boolean
  onClick: () => void
}

const statusToneClass: Record<ActionTone, string> = {
  idle: "text-muted-foreground",
  loading: "text-muted-foreground",
  success: "text-green-600 dark:text-green-400",
  error: "text-destructive",
}

function ProviderAction({
  action,
  statusId,
  label,
  Icon,
  feedback,
  disabled,
  onClick,
}: ProviderActionProps) {
  const loading = feedback.tone === "loading"
  const StateIcon = loading
    ? LoaderCircle
    : feedback.tone === "success"
      ? CircleCheck
      : feedback.tone === "error"
        ? CircleAlert
        : Icon

  return (
    <div
      data-state={feedback.tone}
      className="relative w-full min-w-0 rounded-lg transition-colors hover:bg-foreground/5 focus-within:ring-2 focus-within:ring-brand-to motion-reduce:transition-none"
    >
      <button
        type="button"
        data-action={action}
        aria-label={label}
        aria-busy={loading}
        aria-describedby={feedback.text ? statusId : undefined}
        disabled={disabled}
        onClick={onClick}
        className="group/action flex min-h-24 w-full flex-col items-center px-1 pb-8 pt-2.5 text-center outline-none disabled:cursor-wait disabled:opacity-70"
      >
        <span
          data-testid={`${action}-icon-frame`}
          className="flex size-6 shrink-0 items-center justify-center"
        >
          <StateIcon
            aria-hidden="true"
            strokeWidth={2}
            className={`size-5 transition-colors motion-reduce:transition-none ${
              loading
                ? "animate-spin text-brand-to motion-reduce:animate-none"
                : feedback.tone === "idle"
                  ? "text-muted-foreground group-hover/action:text-brand-to"
                  : statusToneClass[feedback.tone]
            }`}
          />
        </span>
        <span className="mt-1 text-[11px] font-medium leading-tight">{label}</span>
      </button>
      <span
        id={statusId}
        data-testid={`${action}-status`}
        aria-live="polite"
        className={`pointer-events-none absolute inset-x-1 bottom-1 min-h-6 text-center text-[9px] leading-tight line-clamp-2 ${statusToneClass[feedback.tone]}`}
      >
        {feedback.text}
      </span>
    </div>
  )
}

function connectionFeedback(status: ProviderConnectionStatus): ActionFeedback {
  switch (status.state) {
    case "testing":
      return { text: t.settings.testing, tone: "loading" }
    case "ok":
      return { text: t.settings.ok, tone: "success" }
    case "fail":
      return { text: `${t.settings.fail} — ${status.message}`, tone: "error" }
    case "idle":
      return { text: "", tone: "idle" }
  }
}

function fetchFeedback(status: ProviderFetchStatus | undefined): ActionFeedback {
  if (!status) return { text: "", tone: "idle" }
  switch (status.state) {
    case "fetching":
      return { text: t.settings.fetchingModels, tone: "loading" }
    case "ok":
      return { text: `${status.added} ${t.settings.fetchOkAdded}`, tone: "success" }
    case "fail":
      return { text: `${t.settings.fetchFail} — ${status.message}`, tone: "error" }
  }
}

export function ProviderCard({
  provider,
  modelCount,
  connectionStatus,
  fetchStatus,
  onTest,
  onFetchModels,
  onEdit,
  onDelete,
  onBrowseModels,
}: ProviderCardProps) {
  const connection = connectionFeedback(connectionStatus)
  const fetch = fetchFeedback(fetchStatus)
  const testStatusId = `${provider.id}-test-status`
  const fetchStatusId = `${provider.id}-fetch-status`

  return (
    <article
      data-testid="provider-card"
      className="
        relative rounded-lg border border-border bg-background p-2.5
        flex flex-col min-h-56
        hover:border-brand-from/50 hover:shadow-md
        transition-colors duration-200
        motion-reduce:transition-none
      "
    >
      {/* En-tête : nom + URL, poubelle en haut à droite */}
      <header className="mb-2 flex items-start justify-between gap-1.5">
        <div className="min-w-0 flex-1">
          <h3 className="truncate text-[13px] font-semibold text-foreground">{provider.name}</h3>
          <p
            className="mt-0.5 truncate text-[11px] text-muted-foreground"
            title={provider.base_url}
          >
            {provider.base_url}
          </p>
        </div>
        <button
          type="button"
          onClick={onDelete}
          data-action="delete"
          aria-label={t.settings.delete}
          title={t.settings.delete}
          className="
            flex-shrink-0 rounded-md p-1 text-muted-foreground
            hover:bg-destructive/10 hover:text-destructive
            focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-destructive
            transition-colors
            motion-reduce:transition-none
          "
        >
          <Trash2 className="size-3.5" />
        </button>
      </header>

      {/* Séparateur */}
      <hr className="my-1.5 border-border" aria-hidden="true" />

      {/* 3 actions égales avec états : RadioTower (test), CloudDownload (fetch), Wrench (edit) */}
      <div
        data-testid="provider-actions"
        className="mb-1 grid grid-cols-3 gap-1"
        role="group"
        aria-label="Actions du fournisseur"
      >
        <ProviderAction
          action="test-connection"
          statusId={testStatusId}
          label={t.settings.test}
          Icon={RadioTower}
          feedback={connection}
          disabled={connectionStatus.state === "testing"}
          onClick={onTest}
        />
        <ProviderAction
          action="fetch-models"
          statusId={fetchStatusId}
          label={t.settings.fetchModels}
          Icon={CloudDownload}
          feedback={fetch}
          disabled={fetchStatus?.state === "fetching"}
          onClick={onFetchModels}
        />
        <ProviderAction
          action="edit-provider"
          statusId={`${provider.id}-edit-status`}
          label={t.settings.edit}
          Icon={Wrench}
          feedback={{ text: "", tone: "idle" }}
          disabled={false}
          onClick={onEdit}
        />
      </div>

      {/* Bouton principal : "Parcourir les modèles (n)" pleine largeur */}
      <button
        type="button"
        onClick={onBrowseModels}
        data-action="browse-models"
        aria-label={`${t.settings.browseModels} (${modelCount})`}
        className="
          w-full flex items-center justify-center gap-1 rounded-md border border-border px-2 py-1.5
          text-xs font-medium text-foreground
          hover:bg-foreground/5 hover:text-brand-to hover:border-brand-to
          focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-to
          transition-colors
          motion-reduce:transition-none
        "
      >
        {t.settings.browseModels}
        <span className="text-muted-foreground">({modelCount})</span>
      </button>
    </article>
  )
}
