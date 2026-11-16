// Bannière discrète de mise à jour, montée dans le header de App.
// Vue pure : l'état vient du moteur useUpdater possédé par App.tsx.
// Accent de marque : bg-brand-from exige text-brand-foreground (texte noir).
import { useState } from "react"
import { Download } from "lucide-react"
import { t } from "@/i18n/fr"
import type { UpdaterState } from "@/hooks/useUpdater"

interface Props {
  state: UpdaterState
  onInstall: () => void
}

function describe(state: UpdaterState): string {
  switch (state.phase) {
    case "available":
      return t.updater.available.replace("{version}", state.version)
    case "downloading":
      if (state.total === null || state.total <= 0) return t.updater.downloading
      return `${t.updater.downloading} ${Math.min(100, Math.round((state.received / state.total) * 100))} %`
    case "ready":
      return t.updater.readyToInstall
    case "error":
      return state.operation === "install" ? t.updater.installFailed : t.updater.checkFailed
    default:
      return ""
  }
}

export function UpdateBanner({ state, onInstall }: Props) {
  const [dismissed, setDismissed] = useState(false)
  if (dismissed) return null

  const label = describe(state)
  if (!label) return null

  return (
    <div
      data-testid="update-banner"
      role="status"
      aria-live="polite"
      className="flex items-center gap-2 rounded-md border border-border bg-foreground/5 px-2.5 py-1.5"
    >
      <span className="text-xs text-muted-foreground">{label}</span>
      {state.phase === "available" && (
        <button
          onClick={onInstall}
          className="flex items-center gap-1 rounded-md bg-brand-from px-2 py-0.5 text-xs font-medium text-brand-foreground transition-opacity hover:opacity-90"
        >
          <Download className="size-3" aria-hidden="true" />
          {t.updater.install}
        </button>
      )}
      <button
        aria-label={t.updater.dismiss}
        title={t.updater.dismiss}
        onClick={() => setDismissed(true)}
        className="rounded-md px-1 text-xs text-muted-foreground transition-colors hover:text-foreground"
      >
        ×
      </button>
    </div>
  )
}
