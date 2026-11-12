// Écran de verrouillage au démarrage (verrou de confort) : rendu en lieu et
// place du <main> tant que le mot de passe n'est pas validé. Rien de la
// conversation n'existe dans le DOM tant que la gate est présente. Le mot de
// passe n'est jamais persisté ni loggé ; la vérification passe par la
// commande Rust verify_applock_secret.
import { useCallback, useEffect, useRef, useState } from "react"
import { Lock } from "lucide-react"
import { t } from "@/i18n/fr"
import { applock } from "@/lib/applock/service"
import { logger } from "@/lib/logger"

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
      className="fixed inset-0 z-[60] flex items-center justify-center bg-background/95"
      data-testid="lock-gate"
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={t.lock.title}
        className="w-[320px] rounded-xl border border-border bg-background p-6 shadow-lg"
      >
        <div className="mb-4 flex flex-col items-center gap-1">
          <Lock className="size-8 text-muted-foreground" aria-hidden="true" />
          <h1 className="text-base font-semibold">{t.lock.title}</h1>
          <p className="text-center text-xs text-muted-foreground">{t.lock.subtitle}</p>
        </div>
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
