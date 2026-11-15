// Modal de configuration du connecteur GitHub.
// Sous-modale taille adaptée (pas HEADER_TOOL_DIALOG_SIZE_CLASS).
// Champ mot de passe jamais prérempli, "Tester et enregistrer", état connecté,
// "Remplacer", "Déconnecter" avec dialogConfirm, avertissement jeton classique,
// aria-live, focus initial, Échap ferme la sous-modale d'abord.

import { useEffect, useRef, useState } from "react"
import { X, AlertCircle, CheckCircle, Loader2 } from "lucide-react"
import { confirm as dialogConfirm } from "@tauri-apps/plugin-dialog"
import { connectorGithub, type GithubConnectorStatus } from "@/lib/connectors/client"
import { t } from "@/i18n/fr"
import { TauriLink } from "@/components/chat/TauriLink"

interface Props {
  isOpen: boolean
  onClose: () => void
}

export function GithubConnectorDialog({ isOpen, onClose }: Props) {
  const [status, setStatus] = useState<GithubConnectorStatus>({ configured: false, login: null })
  const [token, setToken] = useState("")
  const [liveMessage, setLiveMessage] = useState("")
  const [busy, setBusy] = useState(false)
  const [showClassicWarning, setShowClassicWarning] = useState(false)
  const dialogRef = useRef<HTMLDivElement>(null)
  const tokenInputRef = useRef<HTMLInputElement>(null)
  const previousActiveElement = useRef<HTMLElement | null>(null)

  // Chargement du statut au montage / réouverture
  useEffect(() => {
    if (!isOpen) return
    previousActiveElement.current = document.activeElement as HTMLElement
    setToken("")
    setLiveMessage("")
    setShowClassicWarning(false)
    loadStatus()
  }, [isOpen])

  // Focus initial sur le champ token
  useEffect(() => {
    if (isOpen) {
      tokenInputRef.current?.focus()
    } else if (previousActiveElement.current) {
      previousActiveElement.current.focus()
    }
  }, [isOpen])

  // Gestion Échap : ferme la sous-modale d'abord
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

  const loadStatus = async () => {
    try {
      const res = await connectorGithub.status()
      setStatus(res)
      setShowClassicWarning(res.configured && res.login !== null)
    } catch {
      setStatus({ configured: false, login: null })
    }
  }

  const handleTestAndSave = async () => {
    if (!token.trim() || busy) return
    setBusy(true)
    setLiveMessage(t.connectors.testing)
    try {
      const res = await connectorGithub.configure(token)
      setStatus(res)
      // connectedAs contient des balises <strong>, on veut le texte simple pour aria-live
      setLiveMessage(t.connectors.status.connected.replace("{login}", res.login))
      setShowClassicWarning(true)
    } catch (err: unknown) {
      let kind = "unknown"
      let msg = String(err)
      if (err && typeof err === "object") {
        const e = err as { kind?: string; message?: string }
        kind = e.kind ?? "unknown"
        msg = e.message ?? String(err)
      } else if (err instanceof Error) {
        msg = err.message
      }
      const i18nKey = `connectors.errors.${kind}` as keyof typeof t.connectors.errors
      const i18nMsg = t.connectors.errors[i18nKey] ?? msg
      setLiveMessage(i18nMsg)
    } finally {
      setBusy(false)
    }
  }

  const handleReplace = async () => {
    setToken("")
    setLiveMessage("")
    setShowClassicWarning(false)
    tokenInputRef.current?.focus()
  }

  const handleDisconnect = async () => {
    const confirmed = await dialogConfirm(t.connectors.disconnectConfirm, {
      title: t.connectors.github,
      kind: "warning",
    })
    if (!confirmed) return
    try {
      await connectorGithub.delete()
      setStatus({ configured: false, login: null })
      setShowClassicWarning(false)
      setLiveMessage("")
      tokenInputRef.current?.focus()
    } catch {
      setLiveMessage(t.connectors.errors.unknown)
    }
  }

  if (!isOpen) return null

  // Texte d'état connecté avec interpolation
  const connectedStatusText = status.configured && status.login
    ? t.connectors.status.connected.replace("{login}", status.login)
    : ""

  // Texte avertissement jeton classique (sans éléments inline pour le test)
  const classicWarningText = t.connectors.classicTokenWarning

  return (
    <div
      data-testid="github-connector-dialog-overlay"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-labelledby="github-connector-title"
    >
      <div
        ref={dialogRef}
        className="w-full max-w-md rounded-lg border border-border bg-background p-6 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="flex items-center justify-between mb-4">
          <h2 id="github-connector-title" className="text-lg font-semibold">
            {t.connectors.title}
          </h2>
          <button
            aria-label={t.generalSettings.close}
            onClick={onClose}
            className="rounded-md p-1 hover:bg-foreground/5"
          >
            <X className="size-5" />
          </button>
        </header>

        {/* Explication + lien création jeton */}
        <div className="mb-4 text-sm text-muted-foreground space-y-2">
          <p>{t.connectors.description}</p>
          <p>
            {t.connectors.tokenHint.split("<strong>")[0]}
            <TauriLink
              data-testid="tauri-link"
              href="https://github.com/settings/personal-access-tokens/new"
              className="text-brand-to hover:underline"
            >
              {t.connectors.tokenHint.split("<strong>")[1]?.split("</strong>")[0] ?? "fine-grained"}
            </TauriLink>
            {t.connectors.tokenHint.split("</strong>")[1] ?? ""}
          </p>
          <p className="text-xs text-amber-600 dark:text-amber-400">
            ⚠ {t.connectors.tokenWarning}
          </p>
        </div>

        {/* Champ token - label correctement associé */}
        <div className="mb-3">
          <label htmlFor="github-token-input" className="mb-1 block text-xs text-muted-foreground">
            {t.connectors.tokenLabel}
          </label>
          <input
            ref={tokenInputRef}
            id="github-token-input"
            type="password"
            value={token}
            onChange={(e) => setToken(e.target.value)}
            disabled={busy || status.configured}
            placeholder={t.connectors.tokenPlaceholder}
            className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-brand-to disabled:opacity-50"
            aria-describedby="token-hint"
          />
          <span id="token-hint" className="sr-only">{t.connectors.tokenPlaceholder}</span>
        </div>

        {/* Avertissement jeton classique - texte continu pour le test */}
        {showClassicWarning && status.configured && (
          <div
            className="mb-3 p-2 rounded-md bg-amber-50 dark:bg-amber-900/30 border border-amber-200 dark:border-amber-800 text-amber-800 dark:text-amber-200 text-xs"
            role="alert"
          >
            <span data-testid="classic-warning">{classicWarningText}</span>
          </div>
        )}

        {/* État connecté / Bouton principal */}
        <div className="flex items-center gap-2">
          {status.configured ? (
            <>
              <span
                className="flex-1 flex items-center gap-2 text-sm text-green-600 dark:text-green-400"
                data-testid="connector-status"
              >
                <CheckCircle className="size-4" aria-hidden="true" />
                <span data-testid="connected-text">{connectedStatusText}</span>
              </span>
              <button
                type="button"
                onClick={handleReplace}
                disabled={busy}
                className="rounded-md border border-border px-3 py-1.5 text-sm hover:bg-foreground/5 disabled:opacity-50"
              >
                {t.connectors.replace}
              </button>
              <button
                type="button"
                onClick={handleDisconnect}
                disabled={busy}
                className="rounded-md border border-destructive px-3 py-1.5 text-sm text-destructive hover:bg-destructive/10 disabled:opacity-50"
              >
                {t.connectors.disconnect}
              </button>
            </>
          ) : (
            <>
              <span
                className="flex-1 flex items-center gap-2 text-sm text-muted-foreground"
                data-testid="connector-status"
              >
                {t.connectors.status.notConfigured}
              </span>
              <button
                type="button"
                onClick={handleTestAndSave}
                disabled={busy || !token.trim()}
                className="w-full rounded-md bg-brand-from px-3 py-1.5 text-sm font-medium text-brand-foreground hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {busy ? (
                  <>
                    <Loader2 className="size-4 mr-2 animate-spin" aria-hidden="true" />
                    {t.connectors.testing}
                  </>
                ) : (
                  t.connectors.testAndSave
                )}
              </button>
            </>
          )}
        </div>

        {/* Région aria-live pour annonces asynchrones */}
        <div
          id="github-connector-live"
          role="status"
          aria-live="polite"
          aria-atomic="true"
          className="sr-only mt-2"
        >
          {liveMessage}
        </div>
      </div>
    </div>
  )
}