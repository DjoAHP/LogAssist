import { Check, ChevronDown, Plus, Search, Star } from "lucide-react"
import { t } from "@/i18n/fr"

interface ModelEntry {
  id: string
  label: string
  inDb: boolean
  isDefault: boolean
}

interface ModelDropdownProps {
  models: ModelEntry[]
  search: string
  onSearchChange: (q: string) => void
  fetchOpen: string | null
  onFetchToggle: (open: boolean) => void
  onAddFetched: (modelId: string) => Promise<void>
}

export function ModelDropdown({
  models,
  search,
  onSearchChange,
  fetchOpen,
  onFetchToggle,
  onAddFetched,
}: ModelDropdownProps) {
  const displayLabel = models.length > 0 ? models[0].label : t.settings.noModels

  return (
    <div className="relative">
      {/* Barre de recherche */}
      <div className="relative mb-1">
        <input
          type="text"
          value={search}
          onChange={(e) => onSearchChange(e.target.value)}
          placeholder={t.settings.searchModels}
          className="w-full rounded-md border border-border bg-transparent px-2 py-1.5 text-xs outline-none pr-8"
        />
        <Search className="absolute right-2 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground" />
      </div>

      {/* Dropdown */}
      <div className="relative">
        <button
          onClick={() => onFetchToggle(!fetchOpen)}
          className="w-full flex items-center justify-between gap-2 rounded-md border border-border px-2 py-1.5 text-xs text-left bg-background hover:bg-foreground/5"
        >
          <span className="truncate">{displayLabel}</span>
          <ChevronDown className={`size-3.5 text-muted-foreground flex-shrink-0 transition-transform ${fetchOpen ? "rotate-180" : ""}`} />
        </button>
        {fetchOpen && (
          <div className="absolute top-full left-0 right-0 mt-1 z-10 rounded-md border border-border bg-background shadow-lg max-h-60 overflow-auto">
            {models.length === 0 ? (
              <div className="px-2 py-2 text-xs text-muted-foreground">{t.settings.noModels}</div>
            ) : (
              models.map((m) => (
                <button
                  key={m.id}
                  onClick={() => {
                    if (!m.inDb) {
                      void onAddFetched(m.label)
                    }
                    onFetchToggle(false)
                  }}
                  className="w-full flex items-center justify-between gap-2 px-2 py-1.5 text-xs text-left hover:bg-foreground/5"
                >
                  <span className="truncate">{m.label}</span>
                  <div className="flex items-center gap-1.5">
                    {m.inDb && m.isDefault && <Star className="size-3 text-amber-500" />}
                    {m.inDb ? <Check className="size-3.5 text-green-600" /> : <Plus className="size-3.5 text-green-600" />}
                  </div>
                </button>
              ))
            )}
          </div>
        )}
      </div>
    </div>
  )
}