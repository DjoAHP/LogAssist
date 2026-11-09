import { useEffect, useRef, useState } from "react"
import { Upload, X } from "lucide-react"
import { t } from "@/i18n/fr"
import { diffMcpImport, parseMcpImport, type McpImportDiff } from "@/lib/mcp/importConfig"
import type { McpServerConfig } from "@/lib/mcp/types"
import { HEADER_TOOL_DIALOG_SIZE_CLASS } from "@/components/settings/headerToolDialog"

interface Props {
  existing: McpServerConfig[]
  onValidate(servers: McpServerConfig[]): Promise<void>
  onApply(diff: McpImportDiff[]): Promise<void>
  onClose(): void
}

export function McpImportDialog({ existing, onValidate, onApply, onClose }: Props) {
  const dialogRef = useRef<HTMLDivElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [diff, setDiff] = useState<McpImportDiff[]>([])
  const [error, setError] = useState<string>()
  const [applying, setApplying] = useState(false)
  const [hintId] = useState("mcp-import-hint")

  // Focus trap + initial focus + Escape
  useEffect(() => {
    const dialog = dialogRef.current
    if (!dialog) return

    const focusableSelector =
      'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
    const focusableElements = dialog.querySelectorAll<HTMLElement>(focusableSelector)
    const firstElement = focusableElements[0]
    const lastElement = focusableElements[focusableElements.length - 1]

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault()
        onClose()
        return
      }
      if (event.key === "Tab") {
        if (event.shiftKey) {
          if (document.activeElement === firstElement) {
            event.preventDefault()
            lastElement?.focus()
          }
        } else {
          if (document.activeElement === lastElement) {
            event.preventDefault()
            firstElement?.focus()
          }
        }
      }
    }

    document.addEventListener("keydown", handleKeyDown)
    // Initial focus on file input (or first focusable)
    fileInputRef.current?.focus()

    return () => document.removeEventListener("keydown", handleKeyDown)
  }, [onClose])

  const pick = async (file?: File) => {
    if (!file) return
    setError(undefined)
    try {
      if (file.size > 256 * 1024) throw new Error("TOO_LARGE")
      const parsed = parseMcpImport(await file.text())
      await onValidate(parsed.servers)
      setDiff(diffMcpImport(parsed.servers, existing))
    } catch (cause: unknown) {
      setDiff([])
      if (cause instanceof Error) {
        if (cause.message === "TOO_LARGE") {
          setError(t.mcp.importTooLarge)
        } else if (cause.message === "Le document JSON MCP est invalide") {
          setError(t.mcp.importParseError)
        } else {
          setError(t.mcp.importValidationError)
        }
      } else {
        setError(t.mcp.importValidationError)
      }
    }
  }

  const apply = async () => {
    setApplying(true)
    try {
      await onApply(diff)
      onClose()
    } catch (cause: unknown) {
      setError(t.mcp.importValidationError)
    } finally {
      setApplying(false)
    }
  }

  const actionable = diff.filter((item) => item.kind !== "unchanged")
  return (
    <div className="fixed inset-0 z-[60] grid place-items-center bg-black/65 p-4" onClick={onClose}>
      <section
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="mcp-import-title"
        aria-describedby={error ? undefined : hintId}
        className={`${HEADER_TOOL_DIALOG_SIZE_CLASS} rounded-lg border border-border bg-background p-4`}
        onClick={(event) => event.stopPropagation()}
      >
        <header className="mb-3 flex items-center justify-between">
          <h3 id="mcp-import-title" className="text-sm font-semibold">
            {t.mcp.importConfig}
          </h3>
          <button type="button" aria-label={t.mcp.close} onClick={onClose}>
            <X className="size-4" />
          </button>
        </header>
        <label
          className="flex cursor-pointer items-center gap-2 rounded-md border border-dashed border-border p-3 text-sm text-muted-foreground hover:bg-foreground/5 focus-within:ring-2 focus-within:ring-brand-to"
        >
          <Upload className="size-4" />
          {t.mcp.importFile}
          <input
            ref={fileInputRef}
            className="sr-only"
            type="file"
            accept=".json,application/json"
            aria-label={t.mcp.importFile}
            onChange={(event) => void pick(event.target.files?.[0])}
          />
        </label>
        {error && <p id="mcp-import-error" role="alert" className="mt-3 text-sm text-destructive">{error}</p>}
        {diff.length > 0 && (
          <div className="mt-3">
            <h4 className="text-xs font-medium">{t.mcp.importPreview}</h4>
            <ul className="mt-2 max-h-64 space-y-1 overflow-y-auto">
              {diff.map((item) => (
                <li
                  key={item.incoming.id}
                  className="flex justify-between rounded-md border border-border px-2 py-1.5 text-xs"
                >
                  <span>{item.incoming.name}</span>
                  <span className="text-muted-foreground">
                    {item.kind === "create"
                      ? t.mcp.importCreate
                      : item.kind === "update"
                        ? t.mcp.importUpdate
                        : t.mcp.importUnchanged}
                  </span>
                </li>
              ))}
            </ul>
            <p id={hintId} className="mt-2 text-xs text-muted-foreground">
              {t.mcp.importHint}
            </p>
          </div>
        )}
        <footer className="mt-4 flex justify-end gap-2">
          <button type="button" onClick={onClose} className="rounded-md border border-border px-3 py-1.5 text-sm">
            {t.mcp.cancel}
          </button>
          <button
            type="button"
            disabled={actionable.length === 0 || applying}
            onClick={() => void apply()}
            className="rounded-md bg-brand-from px-3 py-1.5 text-sm text-brand-foreground disabled:opacity-50"
          >
            {actionable.length === 1
              ? t.mcp.importOneServer
              : `${t.mcp.importManyServers} (${actionable.length})`}
          </button>
        </footer>
      </section>
    </div>
  )
}