// Panneau « Mises à jour » des paramètres généraux.
// Consommateur du moteur useUpdater (App.tsx) : aucune logique réseau ici.
import { RefreshCw } from "lucide-react"
import { t } from "@/i18n/fr"
import type { UpdaterState } from "@/hooks/useUpdater"

interface Props {
  state: UpdaterState
  onCheck: () => void
  onInstall: () => void
}

function statusLine(state: UpdaterState): string | null {
  switch (state.phase) {
    case "upToDate":
      return t.updater.upToDate
    case "available":
      return t.updater.available.replace("{version}", state.version)
    case "downloading":
      return t.updater.downloading
    case "ready":
      return t.updater.readyToInstall
    case "error":
      return t.updater.checkFailed
    default:
      return null
  }
}

export function UpdaterPanel({ state, onCheck, onInstall }: Props) {
  const status = statusLine(state)

  return (
    <section aria-label={t.generalSettings.categories.updates} className="space-y-3">
      <h3 className="text-sm font-semibold">{t.generalSettings.categories.updates}</h3>
      <p className="text-xs text-muted-foreground">
        {t.updater.currentVersion.replace("{version}", __APP_VERSION__)}
      </p>
      {status !== null && (
        <p role="status" className="text-sm">
          {status}
        </p>
      )}
      <div className="flex items-center gap-2">
        <button
          onClick={onCheck}
          disabled={state.phase === "downloading"}
          className="flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-sm transition-colors hover:bg-foreground/5 disabled:cursor-not-allowed disabled:opacity-50"
        >
          <RefreshCw className="size-3.5" aria-hidden="true" />
          {t.updater.checkNow}
        </button>
        {state.phase === "available" && (
          <button
            onClick={onInstall}
            className="rounded-md bg-brand-from px-3 py-1.5 text-sm font-medium text-brand-foreground transition-opacity hover:opacity-90"
          >
            {t.updater.install}
          </button>
        )}
      </div>
    </section>
  )
}
