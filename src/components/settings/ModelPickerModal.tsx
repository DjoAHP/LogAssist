import { useState } from "react"
import { Check, Plus, Search, Star, X } from "lucide-react"
import { t } from "@/i18n/fr"

export interface PickerModel {
  id: string
  label: string
  isDefault: boolean
}

interface ModelPickerModalProps {
  providerName: string
  models: PickerModel[]
  onAddModel: (modelId: string) => Promise<void>
  onSelect: (modelRowId: string) => void
  onClose: () => void
}

// Modal de parcourt du modèle (remplace le menu déroulant) : recherche + ajout
// textuel + liste complète. Clic sur un modèle = activation (rôle du parent via
// onSelect). Composant muet : toute la persistance reste côté SettingsDialog.
export function ModelPickerModal({
  providerName,
  models,
  onAddModel,
  onSelect,
  onClose,
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
      onClick={onClose}
      data-testid="model-picker-modal"
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={`${t.settings.browseModels} — ${providerName}`}
        className="max-h-[80vh] w-[520px] max-w-[92vw] overflow-y-auto rounded-lg border border-border bg-background p-4"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="mb-3 flex items-center justify-between">
          <h3 className="text-sm font-semibold">
            {t.settings.browseModels} — {providerName} <span className="text-muted-foreground">({models.length})</span>
          </h3>
          <button aria-label={t.settings.close} onClick={onClose} className="rounded-md p-1 hover:bg-foreground/5">
            <X className="size-4" />
          </button>
        </header>

        {/* Recherche */}
        <div className="relative mb-2">
          <input
            type="text"
            aria-label={t.settings.searchModels}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t.settings.searchModels}
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
            aria-label={t.settings.addModel}
            placeholder={t.settings.addModelPlaceholder}
            className="flex-1 min-w-0 rounded-md border border-border bg-transparent px-2 py-1 text-xs outline-none"
          />
          <button
            onClick={() => void add().catch(console.error)}
            aria-label={t.settings.addModelSubmit}
            className="flex-shrink-0 rounded-md border border-border px-2 py-1 text-xs hover:bg-foreground/5"
          >
            <Plus className="size-3" />
          </button>
        </div>

        {/* Liste complète */}
        <div className="max-h-60 overflow-y-auto rounded-md border border-border">
          {filtered.length === 0 ? (
            <div className="px-2 py-2 text-xs text-muted-foreground">{t.settings.noModels}</div>
          ) : (
            filtered.map((m) => (
              <button
                key={m.id}
                data-testid={`pick-${m.id}`}
                onClick={() => onSelect(m.id)}
                className="w-full flex items-center justify-between gap-2 border-b border-border/60 px-2 py-1.5 text-xs text-left hover:bg-foreground/5 last:border-b-0"
              >
                <span className="truncate">{m.label}</span>
                <div className="flex flex-shrink-0 items-center gap-1.5">
                  {m.isDefault && (
                    <span aria-label={t.settings.activeModelBadge}>
                      <Star className="size-3 text-amber-500" />
                    </span>
                  )}
                  <Check className={`size-3.5 ${m.isDefault ? "text-green-600" : "text-muted-foreground/40"}`} />
                </div>
              </button>
            ))
          )}
        </div>
      </div>
    </div>
  )
}
