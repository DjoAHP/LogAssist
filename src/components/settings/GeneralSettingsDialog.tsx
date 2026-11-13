// Modale « Paramètres généraux » : miniature de l'interface principale —
// en-tête, sidebar de catégories (aujourd'hui : Mot de passe uniquement) et
// panneau de réglages de la catégorie active, à la place du chat. Pas de
// zone de saisie. Taille standard HEADER_TOOL_DIALOG_SIZE_CLASS.
import { useState } from "react"
import { X } from "lucide-react"
import { ParaGenIcon } from "@/icons"
import { t } from "@/i18n/fr"
import { HEADER_TOOL_DIALOG_SIZE_CLASS } from "./headerToolDialog"
import { LockPanel } from "./LockPanel"

type Category = "lock"

// La liste est déclarée au niveau module : ajouter une catégorie = ajouter
// un objet ici + un bloc dans le switch du panneau ci-dessous.
const CATEGORIES: { id: Category; label: string }[] = [
  { id: "lock", label: t.generalSettings.categories.lock },
]

interface Props {
  onClose: () => void
}

export function GeneralSettingsDialog({ onClose }: Props) {
  const [tab, setTab] = useState<Category>("lock")

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
      onClick={onClose}
      data-testid="general-settings-dialog"
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={t.generalSettings.title}
        className={`${HEADER_TOOL_DIALOG_SIZE_CLASS} flex flex-col overflow-hidden rounded-lg border border-border bg-background`}
        onClick={(e) => e.stopPropagation()}
      >
        <header className="flex items-center justify-between border-b border-border px-4 py-3">
          <div className="flex items-center gap-2">
            <ParaGenIcon className="size-4 text-muted-foreground opacity-70" />
            <h2 className="text-base font-semibold">{t.generalSettings.title}</h2>
          </div>
          <button
            aria-label={t.generalSettings.close}
            onClick={onClose}
            className="rounded-md p-1 hover:bg-foreground/5"
          >
            <X className="size-4" />
          </button>
        </header>

        <div className="flex min-h-0 flex-1">
          <nav aria-label={t.generalSettings.title} className="w-52 shrink-0 border-r border-border p-2">
            {CATEGORIES.map((category) => (
              <button
                key={category.id}
                onClick={() => setTab(category.id)}
                aria-current={tab === category.id}
                className={
                  tab === category.id
                    ? "w-full rounded-md bg-foreground/5 px-3 py-2 text-left text-sm font-medium"
                    : "w-full rounded-md px-3 py-2 text-left text-sm text-muted-foreground hover:bg-foreground/5"
                }
              >
                {category.label}
              </button>
            ))}
          </nav>
          <div className="min-h-0 flex-1 overflow-y-auto p-4">
            {tab === "lock" && <LockPanel />}
          </div>
        </div>
      </div>
    </div>
  )
}
