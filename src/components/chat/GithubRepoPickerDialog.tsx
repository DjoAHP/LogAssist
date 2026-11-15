// Modal de sélection du dépôt GitHub à attacher à la conversation.
// Recherche filtrante, badge « Privé », pagination, choix de branche.
import { useEffect, useRef, useState } from "react"
import { X, Loader2, ChevronDown, Lock, ChevronRight } from "lucide-react"
import { t } from "@/i18n/fr"
import { connectorGithub, type GithubRepoSummary } from "@/lib/connectors/client"
import { logger } from "@/lib/logger"
import { TauriLink } from "./TauriLink"

interface GithubRepoPickerDialogProps {
  isOpen: boolean
  onClose: () => void
  onAttach: (binding: { owner: string; name: string; ref: string }) => void
}

type ConnectorErrorKey = keyof typeof t.connectors.errors

function connectorErrorKind(error: unknown): ConnectorErrorKey {
  if (typeof error === "object" && error !== null && "kind" in error) {
    const kind = (error as { kind?: unknown }).kind
    if (typeof kind === "string" && kind in t.connectors.errors) {
      return kind as ConnectorErrorKey
    }
  }
  return "unknown"
}

function connectorErrorMessage(kind: ConnectorErrorKey): string {
  return t.connectors.errors[kind]
}

export function GithubRepoPickerDialog({ isOpen, onClose, onAttach }: GithubRepoPickerDialogProps) {
  const [repos, setRepos] = useState<GithubRepoSummary[]>([])
  const [filteredRepos, setFilteredRepos] = useState<GithubRepoSummary[]>([])
  const [searchQuery, setSearchQuery] = useState("")
  const [page, setPage] = useState(1)
  const [hasMore, setHasMore] = useState(true)
  const [loading, setLoading] = useState(false)
  const [loadingBranches, setLoadingBranches] = useState<string | null>(null)
  const [branches, setBranches] = useState<Record<string, string[]>>({})
  const [selectedRepo, setSelectedRepo] = useState<GithubRepoSummary | null>(null)
  const [selectedBranch, setSelectedBranch] = useState<string>("main")
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const previousActiveElement = useRef<HTMLElement | null>(null)
  const searchInputRef = useRef<HTMLInputElement>(null)

  // Chargement initial / réouverture
  useEffect(() => {
    if (!isOpen) return
    previousActiveElement.current = document.activeElement as HTMLElement
    setRepos([])
    setFilteredRepos([])
    setSearchQuery("")
    setPage(1)
    setHasMore(true)
    setSelectedRepo(null)
    setSelectedBranch("main")
    setErrorMessage(null)
    loadRepos()
  }, [isOpen])

  // Focus initial sur le champ de recherche
  useEffect(() => {
    if (isOpen) {
      searchInputRef.current?.focus()
    } else if (previousActiveElement.current) {
      previousActiveElement.current.focus()
    }
  }, [isOpen])

  // Fermeture Échap
  useEffect(() => {
    if (!isOpen) return
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation()
        onClose()
      }
    }
    document.addEventListener("keydown", handleKeyDown)
    return () => document.removeEventListener("keydown", handleKeyDown)
  }, [isOpen, onClose])

  // Filtrage client-side
  useEffect(() => {
    const q = searchQuery.toLowerCase()
    const nextFilteredRepos = repos.filter((repo) =>
      repo.fullName.toLowerCase().includes(q),
    )
    setFilteredRepos(nextFilteredRepos)
    // Réinitialiser la sélection si le repo filtré n'est plus visible
    if (selectedRepo && !nextFilteredRepos.some((repo) => repo.fullName === selectedRepo.fullName)) {
      setSelectedRepo(null)
      setSelectedBranch("main")
    }
  }, [searchQuery, repos, selectedRepo])

  const loadRepos = async (pageNum = 1) => {
    setLoading(true)
    setErrorMessage(null)
    try {
      const res = await connectorGithub.listRepos(pageNum)
      if (pageNum === 1) {
        setRepos(res.repos)
      } else {
        setRepos((prev) => [...prev, ...res.repos])
      }
      setHasMore(res.hasMore)
      setPage(res.page)
    } catch (err) {
      const kind = connectorErrorKind(err)
      setErrorMessage(connectorErrorMessage(kind))
      logger.error({ context: "github.repo_picker.list", kind })
    } finally {
      setLoading(false)
    }
  }

  const loadBranches = async (repo: GithubRepoSummary) => {
    if (branches[repo.fullName]) return
    setLoadingBranches(repo.fullName)
    try {
      const list = await connectorGithub.listBranches(repo.fullName.split("/")[0], repo.fullName.split("/")[1])
      setBranches((prev) => ({ ...prev, [repo.fullName]: list }))
      if (!selectedBranch || !list.includes(selectedBranch)) {
        setSelectedBranch(repo.defaultBranch ?? "main")
      }
    } catch (err) {
      const kind = connectorErrorKind(err)
      setErrorMessage(connectorErrorMessage(kind))
      logger.error({ context: "github.repo_picker.branches", kind })
    } finally {
      setLoadingBranches(null)
    }
  }

  const handleAttach = () => {
    if (!selectedRepo) return
    onAttach({
      owner: selectedRepo.fullName.split("/")[0],
      name: selectedRepo.fullName.split("/")[1],
      ref: selectedBranch,
    })
    onClose()
  }

  if (!isOpen) return null

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-labelledby="github-picker-title"
    >
      <div
        className="w-full max-w-2xl rounded-lg border border-border bg-background shadow-xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="flex items-center justify-between border-b border-border px-4 py-3">
          <h2 id="github-picker-title" className="text-base font-semibold">
            {t.connectors.repoPicker.title}
          </h2>
          <button
            aria-label={t.generalSettings.close}
            onClick={onClose}
            className="rounded-md p-1 hover:bg-foreground/5"
          >
            <X className="size-5" />
          </button>
        </header>

        <div className="flex flex-col h-[70vh] overflow-hidden">
          {/* Barre de recherche */}
          <div className="p-4 border-b border-border">
            <label htmlFor="repo-search" className="sr-only">
              {t.connectors.repoPicker.search}
            </label>
            <div className="relative">
              <input
                ref={searchInputRef}
                id="repo-search"
                type="search"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder={t.connectors.repoPicker.search}
                className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-brand-to pl-10"
              />
              <svg className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" /></svg>
            </div>
          </div>

          {errorMessage && (
            <p role="alert" className="mx-4 mt-3 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {errorMessage}
            </p>
          )}

          {/* Liste des dépôts */}
          <div className="flex-1 overflow-y-auto p-4 space-y-2">
            {filteredRepos.length === 0 && !loading ? (
              <p className="text-center text-muted-foreground py-8">
                {t.connectors.repoPicker.noRepos}
              </p>
            ) : (
              <>
                {filteredRepos.map((repo) => (
                  <button
                    key={repo.fullName}
                    onClick={() => {
                      setSelectedRepo(repo)
                      setSelectedBranch(repo.defaultBranch ?? "main")
                      if (!branches[repo.fullName]) loadBranches(repo)
                    }}
                    className={`w-full flex items-center justify-between gap-2 p-3 rounded-lg border transition-colors ${
                      selectedRepo?.fullName === repo.fullName
                        ? "border-brand-from bg-brand-from/5"
                        : "border-border hover:border-brand-from/50 hover:bg-foreground/5"
                    }`}
                  >
                    <div className="flex items-center gap-2 min-w-0 flex-1">
                      <span className="font-medium truncate">{repo.fullName}</span>
                      {repo.isPrivate && (
                        <Lock className="size-3.5 text-muted-foreground" aria-label={t.connectors.repoPicker.private} />
                      )}
                    </div>
                    <ChevronRight className="size-4 text-muted-foreground shrink-0" aria-hidden="true" />
                  </button>
                ))}
                {loading && (
                  <div className="flex items-center justify-center py-4">
                    <Loader2 className="size-5 animate-spin text-brand-from" aria-hidden="true" />
                  </div>
                )}
                {hasMore && !loading && (
                  <button
                    onClick={() => loadRepos(page + 1)}
                    disabled={loading}
                    className="w-full rounded-md border border-border px-3 py-2 text-sm text-muted-foreground hover:bg-foreground/5"
                  >
                    {t.connectors.repoPicker.loadMore}
                  </button>
                )}
              </>
            )}
          </div>

          {/* Sélecteur de branche (quand un repo est sélectionné) */}
          {selectedRepo && (
            <div className="border-t border-border p-4 space-y-3 bg-background/50">
              <div>
                <label htmlFor="github-repo-branch" className="block text-xs text-muted-foreground mb-1">
                  {t.connectors.repoPicker.branch}
                </label>
                <div className="relative">
                  <select
                    id="github-repo-branch"
                    value={selectedBranch}
                    onChange={(e) => setSelectedBranch(e.target.value)}
                    disabled={loadingBranches === selectedRepo.fullName}
                    className="w-full appearance-none rounded-md border border-border bg-background px-3 py-2 text-sm pr-8 outline-none focus-visible:ring-2 focus-visible:ring-brand-to disabled:opacity-50"
                  >
                    {(branches[selectedRepo.fullName] ?? []).map((b) => (
                      <option key={b} value={b}>
                        {b} {b === selectedRepo.defaultBranch ? ` (${t.connectors.repoPicker.defaultBranch})` : ""}
                      </option>
                    ))}
                    {loadingBranches === selectedRepo.fullName && (
                      <option disabled>Chargement…</option>
                    )}
                  </select>
                  <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground pointer-events-none" aria-hidden="true" />
                </div>
              </div>
              <div className="flex justify-end">
                <button
                  type="button"
                  onClick={handleAttach}
                  disabled={loadingBranches === selectedRepo.fullName}
                  className="rounded-md bg-brand-from px-4 py-2 text-sm font-medium text-brand-foreground hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {t.connectors.repoPicker.attach}
                </button>
              </div>
            </div>
          )}

          {/* Liens d'aide */}
          <div className="border-t border-border p-4 text-xs text-muted-foreground space-y-1">
            <p>{t.connectors.tokenHint.split("<strong>")[0]} <TauriLink href="https://github.com/settings/personal-access-tokens/new" className="text-brand-to hover:underline">{t.connectors.tokenHint.split("<strong>")[1]?.split("</strong>")[0] ?? "fine-grained"}</TauriLink> {t.connectors.tokenHint.split("</strong>")[1] ?? ""}</p>
            <p className="text-destructive">{t.connectors.tokenWarning}</p>
          </div>
        </div>
      </div>
    </div>
  )
}
