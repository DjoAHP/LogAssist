import { RadioTower, CloudDownload, Wrench, Trash2 } from "lucide-react"
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

function ActionButton({
  children,
  onClick,
  disabled = false,
  "data-action": dataAction,
  "aria-label": ariaLabel,
  title,
  className = "",
}: {
  children: React.ReactNode
  onClick: () => void
  disabled?: boolean
  "data-action": string
  "aria-label"?: string
  title?: string
  className?: string
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      data-action={dataAction}
      aria-label={ariaLabel}
      title={title}
      className={`
        flex-1 flex items-center justify-center gap-1.5 rounded-md border border-border px-2 py-2
        text-xs font-medium transition-colors
        hover:bg-brand-from/10 hover:text-brand-to
        focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-to
        disabled:opacity-50 disabled:cursor-not-allowed
        motion-reduce:transition-none
        ${className}
      `}
    >
      {children}
    </button>
  )
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
  const isTesting = connectionStatus.state === "testing"
  const isFetching = fetchStatus?.state === "fetching"

  return (
    <article
      data-testid="provider-card"
      className="
        relative rounded-lg border border-border bg-background p-3
        flex flex-col
        hover:border-brand-from/50 hover:shadow-md
        transition-colors duration-200
        motion-reduce:transition-none
      "
    >
      {/* En-tête : nom + URL, poubelle en haut à droite */}
      <header className="flex items-start justify-between gap-2 mb-3">
        <div className="min-w-0 flex-1">
          <h3 className="truncate text-sm font-semibold text-foreground">{provider.name}</h3>
          <p
            className="truncate text-xs text-muted-foreground mt-0.5"
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
            flex-shrink-0 rounded-md p-1.5 text-muted-foreground
            hover:bg-destructive/10 hover:text-destructive
            focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-destructive
            transition-colors
            motion-reduce:transition-none
          "
        >
          <Trash2 className="size-4" />
        </button>
      </header>

      {/* Séparateur */}
      <hr className="border-border my-2" aria-hidden="true" />

      {/* 3 actions égales : RadioTower (test), CloudDownload (fetch), Wrench (edit) */}
      <div className="flex gap-1.5 mb-3" role="group" aria-label="Actions du fournisseur">
        <ActionButton
          onClick={onTest}
          disabled={isTesting}
          data-action="test"
          aria-label={t.settings.test}
          title={t.settings.test}
        >
          <RadioTower className="size-4" aria-hidden="true" />
          <span>{isTesting ? t.settings.testing : t.settings.test}</span>
        </ActionButton>

        <ActionButton
          onClick={onFetchModels}
          disabled={isFetching}
          data-action="fetch-models"
          aria-label={t.settings.fetchModels}
          title={t.settings.fetchModels}
        >
          <CloudDownload className="size-4" aria-hidden="true" />
          <span>{isFetching ? t.settings.fetchingModels : t.settings.fetchModels}</span>
        </ActionButton>

        <ActionButton
          onClick={onEdit}
          data-action="edit"
          aria-label={t.settings.edit}
          title={t.settings.edit}
        >
          <Wrench className="size-4" aria-hidden="true" />
          <span>{t.settings.edit}</span>
        </ActionButton>
      </div>

      {/* Bouton principal : "Parcourir les modèles (n)" pleine largeur */}
      <button
        type="button"
        onClick={onBrowseModels}
        data-action="browse-models"
        aria-label={`${t.settings.browseModels} (${modelCount})`}
        className="
          w-full flex items-center justify-center gap-1.5 rounded-md border border-border px-3 py-2
          text-sm font-medium text-foreground
          hover:bg-brand-from/10 hover:text-brand-to hover:border-brand-from/50
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