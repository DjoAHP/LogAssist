// Panneau « Mot de passe » des Paramètres généraux : activation, désactivation
// (exige le mot de passe actuel — décision de design : personne de passage ne
// doit pouvoir couper le verrou) et changement de mot de passe (exige aussi
// l'actuel). Toutes les vérifications passent par les commandes Rust ; le mot
// de passe n'est jamais persisté ni loggé.
import { useCallback, useEffect, useState } from "react"
import { t } from "@/i18n/fr"
import { applock } from "@/lib/applock/service"
import { logger } from "@/lib/logger"

type Mode = "view" | "enable" | "disable" | "change"

function Field({
  label,
  value,
  onChange,
}: {
  label: string
  value: string
  onChange: (value: string) => void
}) {
  return (
    <label className="mb-3 block">
      <span className="mb-1 block text-xs text-muted-foreground">{label}</span>
      <input
        type="password"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-brand-to"
      />
    </label>
  )
}

function FormActions({
  onCancel,
  onSubmit,
  busy,
}: {
  onCancel: () => void
  onSubmit: () => void
  busy: boolean
}) {
  return (
    <div className="flex items-center gap-2">
      <button
        type="button"
        onClick={onCancel}
        disabled={busy}
        className="rounded-md border border-border px-3 py-1.5 text-sm hover:bg-foreground/5 disabled:opacity-50"
      >
        {t.lockSettings.cancel}
      </button>
      <button
        type="button"
        onClick={onSubmit}
        disabled={busy}
        className="rounded-md bg-brand-from px-3 py-1.5 text-sm font-medium text-brand-foreground hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {t.lockSettings.validate}
      </button>
    </div>
  )
}

function logError(context: string, error: unknown): void {
  logger.error({ context, message: error instanceof Error ? error.message : String(error) })
}

export function LockPanel() {
  const [enabled, setEnabled] = useState<boolean | null>(null)
  const [mode, setMode] = useState<Mode>("view")
  const [current, setCurrent] = useState("")
  const [next, setNext] = useState("")
  const [confirmValue, setConfirmValue] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const refresh = useCallback(() => {
    void applock
      .isEnabled()
      .then(setEnabled)
      .catch((e) => {
        logError("lockpanel.isEnabled", e)
        setEnabled(false)
      })
  }, [])

  useEffect(() => {
    refresh()
  }, [refresh])

  const resetForm = useCallback(() => {
    setMode("view")
    setCurrent("")
    setNext("")
    setConfirmValue("")
    setError(null)
  }, [])

  const submitEnable = useCallback(async () => {
    if (next !== confirmValue) {
      setError(t.lockSettings.mismatch)
      return
    }
    if (next.trim().length < 4) {
      setError(t.lockSettings.tooShort)
      return
    }
    setBusy(true)
    setError(null)
    try {
      await applock.set(next)
      await applock.setEnabled(true)
      resetForm()
      refresh()
    } catch (e) {
      logError("lockpanel.enable", e)
      setError(t.lockSettings.saveFailed)
    } finally {
      setBusy(false)
    }
  }, [next, confirmValue, resetForm, refresh])

  const submitDisable = useCallback(async () => {
    setBusy(true)
    setError(null)
    try {
      if (!(await applock.verify(current))) {
        setError(t.lockSettings.verifyCurrentFailed)
        return
      }
      await applock.remove()
      await applock.setEnabled(false)
      resetForm()
      refresh()
    } catch (e) {
      logError("lockpanel.disable", e)
      setError(t.lockSettings.saveFailed)
    } finally {
      setBusy(false)
    }
  }, [current, resetForm, refresh])

  const submitChange = useCallback(async () => {
    if (next !== confirmValue) {
      setError(t.lockSettings.mismatch)
      return
    }
    if (next.trim().length < 4) {
      setError(t.lockSettings.tooShort)
      return
    }
    setBusy(true)
    setError(null)
    try {
      if (!(await applock.verify(current))) {
        setError(t.lockSettings.verifyCurrentFailed)
        return
      }
      await applock.set(next)
      resetForm()
      refresh()
    } catch (e) {
      logError("lockpanel.change", e)
      setError(t.lockSettings.saveFailed)
    } finally {
      setBusy(false)
    }
  }, [next, confirmValue, current, resetForm, refresh])

  // État inconnu (lecture du flag en cours) : rien, la modale reste stable.
  if (enabled === null) return null

  return (
    <div data-testid="lock-panel">
      <div className="mb-4 flex items-center justify-between gap-4">
        <div>
          <p className="text-sm font-medium">{t.lockSettings.sectionTitle}</p>
          <p className="text-xs text-muted-foreground">{t.lockSettings.description}</p>
        </div>
        <button
          role="switch"
          aria-checked={enabled}
          aria-label={enabled ? t.lockSettings.enabled : t.lockSettings.disabled}
          onClick={() => (enabled ? setMode("disable") : setMode("enable"))}
          disabled={busy}
          className={`relative h-6 w-11 shrink-0 rounded-full transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
            enabled ? "bg-brand-to" : "bg-foreground/20"
          }`}
        >
          <span
            className={`absolute top-0.5 size-5 rounded-full bg-background shadow transition-all ${
              enabled ? "left-[22px]" : "left-0.5"
            }`}
          />
        </button>
      </div>

      {error !== null && (
        <p role="alert" className="mb-3 text-xs text-red-500">
          {error}
        </p>
      )}

      {mode === "enable" && (
        <div data-testid="lock-form-enable">
          <Field label={t.lockSettings.newPassword} value={next} onChange={setNext} />
          <Field
            label={t.lockSettings.confirmPassword}
            value={confirmValue}
            onChange={setConfirmValue}
          />
          <FormActions onCancel={resetForm} onSubmit={() => void submitEnable()} busy={busy} />
        </div>
      )}

      {mode === "disable" && (
        <div data-testid="lock-form-disable">
          <Field label={t.lockSettings.currentPassword} value={current} onChange={setCurrent} />
          <FormActions onCancel={resetForm} onSubmit={() => void submitDisable()} busy={busy} />
        </div>
      )}

      {enabled && mode === "view" && (
        <button
          type="button"
          onClick={() => setMode("change")}
          className="rounded-md border border-border px-3 py-1.5 text-sm hover:bg-foreground/5"
        >
          {t.lockSettings.change}
        </button>
      )}

      {mode === "change" && (
        <div data-testid="lock-form-change">
          <Field label={t.lockSettings.currentPassword} value={current} onChange={setCurrent} />
          <Field label={t.lockSettings.newPassword} value={next} onChange={setNext} />
          <Field
            label={t.lockSettings.confirmPassword}
            value={confirmValue}
            onChange={setConfirmValue}
          />
          <FormActions onCancel={resetForm} onSubmit={() => void submitChange()} busy={busy} />
        </div>
      )}
    </div>
  )
}
