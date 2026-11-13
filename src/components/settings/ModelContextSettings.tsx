import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react"
import { X } from "lucide-react"
import { t } from "@/i18n/fr"

export interface ModelContextOverrides {
  contextWindowOverride: number | null
  maxOutputTokensOverride: number | null
}

interface Props extends ModelContextOverrides {
  modelLabel: string
  onSave(overrides: ModelContextOverrides): Promise<void>
  onClose(): void
}

function optionalInteger(value: string): number | null | undefined {
  const trimmed = value.trim()
  if (trimmed === "") return null
  if (!/^\d+$/.test(trimmed)) return undefined
  const parsed = Number(trimmed)
  return Number.isSafeInteger(parsed) ? parsed : undefined
}

export function ModelContextSettings({
  modelLabel,
  contextWindowOverride,
  maxOutputTokensOverride,
  onSave,
  onClose,
}: Props) {
  const [contextWindow, setContextWindow] = useState(contextWindowOverride?.toString() ?? "")
  const [maxOutput, setMaxOutput] = useState(maxOutputTokensOverride?.toString() ?? "")
  const [error, setError] = useState("")
  const [saving, setSaving] = useState(false)
  const dialogRef = useRef<HTMLDivElement>(null)
  const firstInputRef = useRef<HTMLInputElement>(null)
  const mountedRef = useRef(true)
  const returnFocusRef = useRef<HTMLElement | null>(
    typeof document !== "undefined" && document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null,
  )

  useEffect(() => {
    setContextWindow(contextWindowOverride?.toString() ?? "")
    setMaxOutput(maxOutputTokensOverride?.toString() ?? "")
    setError("")
  }, [modelLabel, contextWindowOverride, maxOutputTokensOverride])

  useEffect(() => {
    mountedRef.current = true
    firstInputRef.current?.focus()
    return () => {
      mountedRef.current = false
      if (returnFocusRef.current?.isConnected) returnFocusRef.current.focus()
    }
  }, [])

  const requestClose = () => {
    if (!saving) onClose()
  }

  const handleDialogKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Escape") {
      event.preventDefault()
      event.stopPropagation()
      requestClose()
      return
    }
    if (event.key !== "Tab") return

    const focusable = Array.from(dialogRef.current?.querySelectorAll<HTMLElement>(
      'button:not([disabled]), input:not([disabled]), [href], [tabindex]:not([tabindex="-1"])',
    ) ?? []).filter((element) => !element.hasAttribute("hidden"))
    if (focusable.length === 0) return
    const first = focusable[0]
    const last = focusable[focusable.length - 1]
    const active = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null
    if (!active || !focusable.includes(active)) {
      event.preventDefault()
      const destination = event.shiftKey ? last : first
      destination.focus()
    } else if (event.shiftKey && active === first) {
      event.preventDefault()
      last.focus()
    } else if (!event.shiftKey && active === last) {
      event.preventDefault()
      first.focus()
    }
  }

  const save = async () => {
    const context = optionalInteger(contextWindow)
    const output = optionalInteger(maxOutput)
    if (context === undefined || (context !== null && (context < 512 || context > 2_000_000))) {
      setError(t.providers.invalidContextWindow)
      return
    }
    if (
      output === undefined ||
      (output !== null && (output < 1 || output > 262_144)) ||
      (context !== null && output !== null && output >= context)
    ) {
      setError(t.providers.invalidOutputTokens)
      return
    }
    setError("")
    setSaving(true)
    try {
      await onSave({
        contextWindowOverride: context,
        maxOutputTokensOverride: output,
      })
    } catch {
      if (mountedRef.current) setError(t.providers.saveFailed)
    } finally {
      if (mountedRef.current) setSaving(false)
    }
  }

  return (
    <div
      className="fixed inset-0 z-[70] flex items-center justify-center bg-black/70"
      onClick={requestClose}
      data-testid="model-context-settings"
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label={`${t.providers.contextSettings} — ${modelLabel}`}
        aria-busy={saving}
        className="w-[460px] max-w-[92vw] rounded-lg border border-border bg-background p-4 shadow-xl"
        onClick={(event) => event.stopPropagation()}
        onKeyDown={handleDialogKeyDown}
      >
        <header className="mb-4 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h3 className="text-sm font-semibold">{t.providers.contextSettings}</h3>
            <p className="mt-0.5 truncate text-xs text-muted-foreground" title={modelLabel}>
              {modelLabel}
            </p>
          </div>
          <button
            type="button"
            aria-label={t.providers.close}
            onClick={requestClose}
            disabled={saving}
            className="rounded-md p-1 text-muted-foreground hover:bg-foreground/5 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-to disabled:opacity-50"
          >
            <X className="size-4" />
          </button>
        </header>

        <p id="model-context-hint" className="mb-3 text-xs text-muted-foreground">
          {t.providers.automaticContext}
        </p>

        <div className="grid gap-3 sm:grid-cols-2">
          <label className="grid gap-1 text-xs font-medium">
            <span>{t.providers.contextWindow}</span>
            <input
              ref={firstInputRef}
              type="number"
              min={512}
              max={2_000_000}
              step={1}
              value={contextWindow}
              onChange={(event) => setContextWindow(event.target.value)}
              aria-describedby="model-context-hint"
              className="rounded-md border border-border bg-transparent px-2 py-1.5 font-mono text-xs outline-none focus-visible:ring-2 focus-visible:ring-brand-to"
            />
          </label>
          <label className="grid gap-1 text-xs font-medium">
            <span>{t.providers.maxOutputTokens}</span>
            <input
              type="number"
              min={1}
              max={262_144}
              step={1}
              value={maxOutput}
              onChange={(event) => setMaxOutput(event.target.value)}
              aria-describedby="model-context-hint"
              className="rounded-md border border-border bg-transparent px-2 py-1.5 font-mono text-xs outline-none focus-visible:ring-2 focus-visible:ring-brand-to"
            />
          </label>
        </div>

        {error && <p role="alert" className="mt-3 text-xs text-destructive">{error}</p>}

        <div className="mt-4 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            className="rounded-md border border-border px-3 py-1.5 text-sm hover:bg-foreground/5 disabled:opacity-50"
          >
            {t.providers.cancel}
          </button>
          <button
            type="button"
            onClick={() => void save()}
            disabled={saving}
            className="rounded-md bg-brand-from px-3 py-1.5 text-sm text-brand-foreground hover:opacity-90 disabled:opacity-50"
          >
            {saving ? t.providers.saveInProgress : t.providers.saveContext}
          </button>
        </div>
      </div>
    </div>
  )
}
