// Écran de verrouillage au démarrage (verrou de confort) : calque assombri
// au-dessus de l'interface qui reste visible en arrière-plan (compromis
// assumé du verrou de confort — l'interface n'est ni cliquable ni lisible).
// Carte minimale : logo au-dessus du champ, puis le bouton. Le mot de passe
// n'est jamais persisté ni loggé ; la vérification passe par la commande
// Rust verify_applock_secret.
import { useCallback, useEffect, useRef, useState } from "react"
import { t } from "@/i18n/fr"
import { applock } from "@/lib/applock/service"
import { logger } from "@/lib/logger"
import logoSrc from "@/assets/logo.png"

interface Props {
  onUnlock: () => void
}

export function LockGate({ onUnlock }: Props) {
  const [password, setPassword] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  // Focus auto : l'utilisateur n'a qu'une action possible.
  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  const submit = useCallback(async () => {
    if (busy || password.length === 0) return
    setBusy(true)
    setError(null)
    try {
      if (await applock.verify(password)) {
        onUnlock()
      } else {
        setError(t.lock.wrongPassword)
      }
    } catch (e) {
      logger.error({
        context: "lockgate.verify",
        message: e instanceof Error ? e.message : String(e),
      })
      setError(t.lock.verifyFailed)
    } finally {
      setBusy(false)
    }
  }, [busy, password, onUnlock])

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/80"
      data-testid="lock-gate"
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={t.lock.title}
        className="w-[300px] rounded-xl border border-border bg-background/95 p-6 shadow-lg"
      >
        <img
          src={logoSrc}
          alt=""
          data-testid="lock-logo"
          className="mx-auto mb-5 h-12 object-contain"
        />
        <input
          ref={inputRef}
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") void submit()
          }}
          aria-label={t.lock.passwordField}
          placeholder={t.lock.passwordField}
          disabled={busy}
          className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-brand-to"
        />
        {error !== null && (
          <p role="alert" className="mt-2 text-xs text-red-500">
            {error}
          </p>
        )}
        <button
          type="button"
          onClick={() => void submit()}
          disabled={busy || password.length === 0}
          className="mt-3 w-full rounded-md bg-brand-from px-3 py-2 text-sm font-medium text-brand-foreground transition-colors hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {busy ? t.lock.verifying : t.lock.unlock}
        </button>
      </div>
    </div>
  )
}
