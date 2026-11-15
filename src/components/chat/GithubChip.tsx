// Puce « owner/name@ref » pour le dépôt GitHub attaché.
// Affichée dans la barre de saisie quand un dépôt est attaché.
import { X } from "lucide-react"
import { t } from "@/i18n/fr"

interface GithubChipProps {
  owner: string
  name: string
  ref: string | null
  onDetach: () => void
  disabled?: boolean
  available?: boolean
}

export function GithubChip({ owner, name, ref, onDetach, disabled, available = true }: GithubChipProps) {
  const displayRef = ref ?? "main"
  const label = `${owner}/${name}@${displayRef}`

  return (
    <span
      className={available
        ? "inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-medium bg-brand-from/15 text-brand-from border border-brand-from/30"
        : "inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-medium bg-foreground/5 text-muted-foreground border border-border"}
      data-testid="github-chip"
    >
      <span className="truncate max-w-[200px]">{label}</span>
      {!available && (
        <>
          <span aria-hidden="true">·</span>
          <span>{t.chat.githubRepoUnavailable}</span>
        </>
      )}
      <button
        type="button"
        onClick={onDetach}
        disabled={disabled}
        aria-label={t.chat.detachGitHubRepo}
        className="flex items-center justify-center size-4 rounded-full hover:bg-foreground/10 disabled:opacity-50"
      >
        <X className="size-3" aria-hidden="true" />
      </button>
    </span>
  )
}
