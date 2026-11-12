import { useState } from "react"
import { t } from "@/i18n/fr"
import { LOCAL_LLM_PRESETS, LOCAL_DUMMY_SECRET } from "@/lib/ai/local"
import { providers, type ProviderRow } from "@/lib/db/providers"

interface Props {
  rows: ProviderRow[]
  onChanged: () => Promise<void> | void
}

// Onglet « Modèles local » : presets un-clic LM Studio / Ollama. La clé
// factice (serveurs locaux l'ignorent) est créée automatiquement pour que
// Test / Récupérer modèles passent la garde "Aucune clé". Les fournisseurs
// locaux vivent dans la même table `providers` que les distants.
export function LocalModelsPanel({ rows, onChanged }: Props) {
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const configuredUrls = new Set(rows.map((r) => r.base_url))

  const add = async (presetName: string, url: string) => {
    setBusy(url)
    setError(null)
    try {
      await providers.create(presetName, "openai", url, LOCAL_DUMMY_SECRET)
      await onChanged()
    } catch (e) {
      setError(`${t.providers.saveFailed} : ${e instanceof Error ? e.message : String(e)}`)
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="space-y-3">
      <p className="text-xs text-muted-foreground">{t.providers.localHint}</p>
      {LOCAL_LLM_PRESETS.map((preset) => {
        const isConfigured = configuredUrls.has(preset.url)
        return (
          <div key={preset.id} className="rounded-md border border-border p-3">
            <div className="flex items-center justify-between gap-2">
              <div className="min-w-0">
                <p className="truncate text-sm font-medium">{preset.name}</p>
                <p className="truncate text-xs text-muted-foreground">{preset.url}</p>
              </div>
              {isConfigured ? (
                <span className="flex-shrink-0 text-xs text-green-600">{t.providers.localConfigured}</span>
              ) : (
                <button
                  disabled={busy !== null}
                  onClick={() => void add(preset.name, preset.url).catch(console.error)}
                  className="flex-shrink-0 rounded-md border border-border bg-foreground/10 px-3 py-1.5 text-xs hover:bg-foreground/20 disabled:opacity-50"
                >
                  {busy === preset.url ? t.providers.saveInProgress : t.providers.localAdd}
                </button>
              )}
            </div>
          </div>
        )
      })}
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  )
}
