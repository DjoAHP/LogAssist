import { useEffect, useRef, useState } from "react"
import { X } from "lucide-react"

import { t } from "@/i18n/fr"
import { mcpUiError } from "@/lib/mcp/errorMessages"
import type { McpApprovalMode, McpServerConfig, McpToolResult, McpToolRow } from "@/lib/mcp/types"

interface Props {
  server: McpServerConfig
  tools: McpToolRow[]
  onToggle(nativeName: string, enabled: boolean): void
  // nativeNames = les outils affichés au moment du clic (filtre vide = tout
  // le serveur) ; la décision « affichés seulement » vient de l'utilisateur.
  onToggleAll(enabled: boolean, nativeNames: string[]): void
  onApprovalMode(nativeName: string, mode: McpApprovalMode): void
  onRun(nativeName: string, arguments_: Record<string, unknown>): Promise<McpToolResult>
  onConfirmRisk(): Promise<boolean>
  onClose(): void
}

interface McpToolAnnotations {
  readOnlyHint?: boolean
  destructiveHint?: boolean
}

function parseJsonSafe(jsonString: string): string {
  try {
    return JSON.stringify(JSON.parse(jsonString), null, 2)
  } catch {
    return "(schéma invalide)"
  }
}

function riskFor(tool: McpToolRow): "read_only" | "destructive" | "unknown" {
  const annotations = tool.annotations ? (JSON.parse(tool.annotations) as McpToolAnnotations) : {}
  if (annotations.readOnlyHint === true && annotations.destructiveHint !== true) return "read_only"
  if (annotations.destructiveHint === true) return "destructive"
  return "unknown"
}

function ToolRow({
  tool,
  selected,
  onSelect,
  onToggle,
  onApprovalMode,
}: {
  tool: McpToolRow
  selected: boolean
  onSelect(): void
  onToggle(enabled: boolean): void
  onApprovalMode(mode: McpApprovalMode): void
}) {
  const risk = riskFor(tool)
  const riskLabel = risk === "read_only" ? t.mcp.readOnly : risk === "destructive" ? t.mcp.destructive : t.mcp.unknownRisk
  return (
    <li className={`rounded-md border p-2 ${selected ? "border-brand-to" : "border-border"}`}>
      <div className="flex items-center gap-2">
        <input
          type="checkbox"
          checked={tool.enabled === 1}
          aria-label={`Activer ${tool.native_name}`}
          onChange={(event) => onToggle(event.target.checked)}
          className="size-4 accent-brand-from"
        />
        <button
          type="button"
          onClick={onSelect}
          className="min-w-0 flex-1 truncate text-left text-xs font-medium focus-visible:ring-2 focus-visible:ring-brand-to"
        >
          {tool.native_name}
        </button>
        <span className="rounded-full border border-border px-1.5 text-[9px] text-muted-foreground">{riskLabel}</span>
        <select
          aria-label={`Politique ${tool.native_name}`}
          value={tool.approval_mode}
          disabled={risk !== "read_only"}
          onChange={(event) => onApprovalMode(event.target.value as McpApprovalMode)}
          className="rounded-md border border-border bg-background px-1.5 py-1 text-[10px] disabled:opacity-50"
        >
          <option value="confirm">{t.mcp.confirmAlways}</option>
          <option value="auto">{t.mcp.automatic}</option>
        </select>
      </div>
      {tool.description && <p className="mt-1 line-clamp-2 text-[10px] text-muted-foreground">{tool.description}</p>}
    </li>
  )
}

export function McpToolsDialog({ server, tools, onToggle, onToggleAll, onApprovalMode, onRun, onConfirmRisk, onClose }: Props) {
  const searchInputRef = useRef<HTMLInputElement>(null)
  const dialogSectionRef = useRef<HTMLElement>(null)
  const allCheckboxRef = useRef<HTMLInputElement>(null)
  const [search, setSearch] = useState("")
  const [selected, setSelected] = useState(tools[0]?.native_name ?? "")
  const [argumentsText, setArgumentsText] = useState("{}")
  const [result, setResult] = useState<McpToolResult>()
  const [error, setError] = useState<string>()
  const [running, setRunning] = useState(false)

  // Initial focus on search input
  useEffect(() => {
    searchInputRef.current?.focus()
  }, [])

  // Escape key + focus trap (Tab/Shift+Tab loop within dialog)
  useEffect(() => {
    const section = dialogSectionRef.current
    if (!section) return

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose()
        return
      }

      if (event.key === "Tab") {
        const focusableElements = section.querySelectorAll<HTMLElement>(
          'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
        )
        const focusableArray = Array.from(focusableElements).filter((el: HTMLElement) => {
        const hasDisabledAttr = el.hasAttribute("disabled")
        const isDisabledProp = (el as HTMLButtonElement | HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement).disabled
        return !hasDisabledAttr && !isDisabledProp && el.offsetParent !== null
      })
        if (focusableArray.length === 0) return

        const firstElement: HTMLElement = focusableArray[0]
        const lastElement: HTMLElement = focusableArray[focusableArray.length - 1]
        const activeElement = document.activeElement as HTMLElement

        if (event.shiftKey) {
          if (activeElement === firstElement) {
            event.preventDefault()
            lastElement.focus()
          }
        } else {
          if (activeElement === lastElement) {
            event.preventDefault()
            firstElement.focus()
          }
        }
      }
    }

    document.addEventListener("keydown", handleKeyDown)
    return () => document.removeEventListener("keydown", handleKeyDown)
  }, [onClose])

  const filtered = tools.filter((tool) =>
    tool.native_name.toLocaleLowerCase("fr").includes(search.trim().toLocaleLowerCase("fr"))
  )
  const selectedTool = tools.find((tool) => tool.native_name === selected)
  const shownEnabled = filtered.filter((tool) => tool.enabled === 1).length
  const allShownEnabled = filtered.length > 0 && shownEnabled === filtered.length

  // Le tri-état indéterminé n'est pas exprimable en JSX : reflété par effet.
  useEffect(() => {
    if (allCheckboxRef.current) {
      allCheckboxRef.current.indeterminate = shownEnabled > 0 && !allShownEnabled
    }
  }, [shownEnabled, allShownEnabled])

  const run = async () => {
    setError(undefined)
    let arguments_: unknown
    try {
      arguments_ = JSON.parse(argumentsText)
    } catch {
      setError(t.mcp.invalidJson)
      return
    }
    if (typeof arguments_ !== "object" || arguments_ === null || Array.isArray(arguments_)) {
      setError(t.mcp.invalidJson)
      return
    }
    const tool = tools.find((candidate) => candidate.native_name === selected)
    if (!tool) return
    if (riskFor(tool) !== "read_only" && !(await onConfirmRisk())) return
    setRunning(true)
    try {
      setResult(await onRun(selected, arguments_ as Record<string, unknown>))
    } catch (cause) {
      setError(mcpUiError(cause))
    } finally {
      setRunning(false)
    }
  }

  return (
    <div className="fixed inset-0 z-[60] grid place-items-center bg-black/65 p-4" onClick={onClose}>
      <section
        ref={dialogSectionRef}
        role="dialog"
        aria-modal="true"
        aria-label={`${t.mcp.browseTools} — ${server.name}`}
        className="grid max-h-[82vh] w-[900px] max-w-[94vw] grid-cols-2 overflow-hidden rounded-lg border border-border bg-background"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="min-h-0 border-r border-border p-4">
          <input
            ref={searchInputRef}
            type="search"
            aria-label={t.mcp.searchTools}
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            className="mb-2 w-full rounded-md border border-border bg-background px-2 py-1.5 text-xs focus-visible:ring-2 focus-visible:ring-brand-to"
          />
          <label className="mb-3 flex w-fit items-center gap-2 text-[11px] text-muted-foreground">
            <input
              ref={allCheckboxRef}
              type="checkbox"
              aria-label={`${t.mcp.allTools} (${shownEnabled}/${filtered.length})`}
              checked={allShownEnabled}
              disabled={filtered.length === 0}
              onChange={(event) => onToggleAll(event.target.checked, filtered.map((tool) => tool.native_name))}
              className="size-3.5 accent-brand-from"
            />
            {t.mcp.allTools} ({shownEnabled}/{filtered.length})
          </label>
          <ul className="max-h-[60vh] space-y-2 overflow-y-auto">
            {filtered.map((tool) => (
              <ToolRow
                key={tool.native_name}
                tool={tool}
                selected={tool.native_name === selected}
                onSelect={() => setSelected(tool.native_name)}
                onToggle={(enabled) => onToggle(tool.native_name, enabled)}
                onApprovalMode={(mode) => onApprovalMode(tool.native_name, mode)}
              />
            ))}
          </ul>
        </div>
        <div className="min-h-0 overflow-y-auto p-4">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold">{selectedTool?.title ?? selectedTool?.native_name ?? t.mcp.toolResult}</h3>
            <button type="button" aria-label={t.mcp.close} onClick={onClose} className="rounded-md p-1.5 hover:bg-foreground/5">
              <X className="size-4" />
            </button>
          </div>
          {selectedTool && (
            <>
              <p className="mt-3 text-[10px] font-medium text-muted-foreground">{t.mcp.inputSchema}</p>
              <pre className="mt-1 max-h-48 overflow-auto rounded-md border border-border p-2 text-[10px] whitespace-pre-wrap">
                {parseJsonSafe(selectedTool.input_schema)}
              </pre>
              {selectedTool.output_schema && (
                <>
                  <p className="mt-3 text-[10px] font-medium text-muted-foreground">{t.mcp.outputSchema}</p>
                  <pre className="mt-1 max-h-32 overflow-auto rounded-md border border-border p-2 text-[10px] whitespace-pre-wrap">
                    {parseJsonSafe(selectedTool.output_schema)}
                  </pre>
                </>
              )}
              <label className="mt-3 block text-xs">
                {t.mcp.argumentsJson}
                <textarea
                  aria-label={t.mcp.argumentsJson}
                  rows={7}
                  value={argumentsText}
                  onChange={(event) => setArgumentsText(event.target.value)}
                  className="mt-1 w-full rounded-md border border-border bg-background p-2 font-mono text-xs focus-visible:ring-2 focus-visible:ring-brand-to"
                />
              </label>
              <button
                type="button"
                disabled={!selected || running}
                onClick={() => void run()}
                className="mt-2 rounded-md bg-brand-from px-3 py-1.5 text-xs text-brand-foreground disabled:opacity-50"
              >
                {running ? t.mcp.runningTool : t.mcp.runTool}
              </button>
              {error && <p role="alert" className="mt-2 text-xs text-destructive">{error}</p>}
              {result && (
                <pre className="mt-3 max-h-56 overflow-auto rounded-md border border-border p-2 text-xs whitespace-pre-wrap">
                  {[
                    result.content,
                    result.structuredContent === undefined ? "" : JSON.stringify(result.structuredContent, null, 2),
                    result.resourceLinks.length === 0 ? "" : JSON.stringify({ resourceLinks: result.resourceLinks }, null, 2),
                  ]
                    .filter(Boolean)
                    .join("\n")}
                </pre>
              )}
            </>
          )}
        </div>
      </section>
    </div>
  )
}