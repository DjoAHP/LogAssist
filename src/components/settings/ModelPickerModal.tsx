import { useState } from "react"
import { Check, Plus, Search, Settings2, Star, X } from "lucide-react"
import { t } from "@/i18n/fr"

export interface PickerModel {
  id: string
  label: string
  isDefault: boolean
  contextWindowOverride: number | null
  maxOutputTokensOverride: number | null
}

interface ModelPickerModalProps {
  providerName: string
  models: PickerModel[]
  onAddModel: (modelId: string) => Promise<void>
  onSelect: (modelRowId: string) => void
  onConfigure: (model: PickerModel) => void
  onClose: () => void
  inactive?: boolean
}

// Modal de parcourt du modèle (remplace le menu déroulant) : recherche + ajout
// textuel + liste complète. Clic sur un modèle = activation (rôle du parent via
// onSelect). Composant muet : toute la persistance reste côté ProvidersDialog.
export function ModelPickerModal({
  providerName,
  models,
  onAddModel,
  onSelect,
  onConfigure,
  onClose,
  inactive = false,
}: ModelPickerModalProps) {
  const [search, setSearch] = useState("")
  const [newModel, setNewModel] = useState("")

  const filtered = models.filter((m) => m.label.toLowerCase().includes(search.toLowerCase()))

  const add = async () => {
    const modelId = newModel.trim()
    if (!modelId) return
    await onAddModel(modelId)
    setNewModel("")
  }

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60"
      onClick={() => {
        if (!inactive) onClose()
      }}
      data-testid="model-picker-modal"
      aria-hidden={inactive || undefined}
      inert={inactive || undefined}
    >
      <div
        role="dialog"
        aria-modal={inactive ? undefined : "true"}
        aria-label={`${t.providers.browseModels} — ${providerName}`}
        className="max-h-[80vh] w-[520px] max-w-[92vw] overflow-y-auto rounded-lg border border-border bg-background p-4"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="mb-3 flex items-center justify-between">
          <h3 className="text-sm font-semibold">
            {t.providers.browseModels} — {providerName} <span className="text-muted-foreground">({models.length})</span>
          </h3>
          <button aria-label={t.providers.close} onClick={onClose} className="rounded-md p-1 hover:bg-foreground/5">
            <X className="size-4" />
          </button>
        </header>

        {/* Recherche */}
        <div className="relative mb-2">
          <input
            type="text"
            aria-label={t.providers.searchModels}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t.providers.searchModels}
            className="w-full rounded-md border border-border bg-transparent px-2 py-1.5 text-xs outline-none pr-8"
          />
          <Search className="absolute right-2 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground" />
        </div>

        {/* Ajout textuel */}
        <div className="mb-2 flex gap-1.5">
          <input
            value={newModel}
            onChange={(e) => setNewModel(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault()
                void add().catch(console.error)
              }
            }}
            aria-label={t.providers.addModel}
            placeholder={t.providers.addModelPlaceholder}
            className="flex-1 min-w-0 rounded-md border border-border bg-transparent px-2 py-1 text-xs outline-none"
          />
          <button
            onClick={() => void add().catch(console.error)}
            aria-label={t.providers.addModelSubmit}
            className="flex-shrink-0 rounded-md border border-border px-2 py-1 text-xs hover:bg-foreground/5"
          >
            <Plus className="size-3" />
          </button>
        </div>

        {/* Liste complète */}
        <div className="max-h-60 overflow-y-auto rounded-md border border-border">
          {filtered.length === 0 ? (
            <div className="px-2 py-2 text-xs text-muted-foreground">{t.providers.noModels}</div>
          ) : (
            filtered.map((m) => (
              <div
                key={m.id}
                className="flex items-center border-b border-border/60 last:border-b-0"
              >
                <button
                  type="button"
                  data-testid={`pick-${m.id}`}
                  onClick={() => onSelect(m.id)}
                  className="flex min-w-0 flex-1 items-center justify-between gap-2 px-2 py-1.5 text-left text-xs hover:bg-foreground/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand-to"
                >
                  <span className="truncate">{m.label}</span>
                  <span className="flex flex-shrink-0 items-center gap-1.5">
                    {m.isDefault && (
                      <span aria-label={t.providers.activeModelBadge}>
                        <Star className="size-3 text-amber-500" />
                      </span>
                    )}
                    <Check className={`size-3.5 ${m.isDefault ? "text-green-600" : "text-muted-foreground/40"}`} />
                  </span>
                </button>
                <button
                  type="button"
                  aria-label={`${t.providers.contextSettings} — ${m.label}`}
                  title={t.providers.contextSettings}
                  onClick={() => onConfigure(m)}
                  className="mr-1 rounded-md p-1.5 text-muted-foreground hover:bg-foreground/5 hover:text-brand-to focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-to"
                >
                  <Settings2 className="size-3.5" />
                </button>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  )
}
