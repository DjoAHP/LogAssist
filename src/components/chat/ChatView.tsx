import { useEffect, useRef } from "react"
import { AlertTriangle } from "lucide-react"
import { t } from "@/i18n/fr"
import { KIND_TO_KEY } from "@/lib/ai/errors"
import type { ChatMessageVM } from "@/hooks/useChat"

interface ModelSelectorProps {
  options: { rowId: string; label: string; isDefault: boolean }[]
  onSelect: (rowId: string) => void
}

interface Props {
  vm: ChatMessageVM[]
  hasModel: boolean
  showConversation: boolean
  modelSelector?: ModelSelectorProps | null
}

export function ChatView({ vm, hasModel, showConversation, modelSelector }: Props) {
  const bottomRef = useRef<HTMLDivElement>(null)
  const last = vm[vm.length - 1]

  // Auto-scroll à chaque nouveau message ET pendant le streaming du dernier.
  // "auto" partout : "smooth" pendant le streaming (mises à jour ~10 Hz) crée
  // des animations concurrentes qui ratent le bas de page.
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "auto", block: "end" })
  }, [vm.length, last?.content])

  if (!showConversation) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <p className="text-sm text-muted-foreground">{t.chat.noConversation}</p>
      </div>
    )
  }

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <div role="log" aria-live="polite" className="flex-1 space-y-4 overflow-y-auto p-4">
        {vm.length === 0 && !hasModel && (
          <p className="text-sm text-muted-foreground">{t.chat.configureProvider}</p>
        )}
        {vm.map((m, i) => (
          <MessageBubble key={m.id ?? `local-${i}`} m={m} />
        ))}
        <div ref={bottomRef} />
      </div>
      {modelSelector && modelSelector.options.length > 0 && <ModelSelectorFooter {...modelSelector} />}
    </div>
  )
}

// Sélecteur M1 en pied de vue : option value = ModelRow.id (nécessaire à
// providers.setDefaultModel), label « Provider › modèle ». Liste vide → masqué.
function ModelSelectorFooter({ options, onSelect }: ModelSelectorProps) {
  const current = options.find((o) => o.isDefault) ?? options[0]
  return (
    <div className="flex items-center gap-2 border-t border-border px-4 py-2">
      <label htmlFor="model-select" className="text-xs text-muted-foreground">
        {t.chat.selectModel}
      </label>
      <select
        id="model-select"
        value={current?.rowId ?? ""}
        onChange={(e) => onSelect(e.target.value)}
        className="rounded-md border border-border bg-background px-2 py-1 text-xs outline-none"
      >
        {options.map((o) => (
          <option key={o.rowId} value={o.rowId}>
            {o.label}
            {o.isDefault ? " ★" : ""}
          </option>
        ))}
      </select>
    </div>
  )
}

function MessageBubble({ m }: { m: ChatMessageVM }) {
  const isUser = m.role === "user"
  return (
    <div className={`flex ${isUser ? "justify-end" : "justify-start"}`}>
      <div
        className={`max-w-[80%] rounded-lg border px-3 py-2 text-sm ${
          m.apiError ? "border-destructive bg-destructive/10" : "border-border bg-foreground/5"
        }`}
      >
        <pre className="whitespace-pre-wrap font-sans text-sm">{m.content || "…"}</pre>
        {m.apiError && (
          <div className="mt-1 flex items-start gap-1.5 text-destructive">
            <AlertTriangle className="mt-0.5 size-3.5 flex-shrink-0" />
            <div>
              <p className="text-xs font-medium">{t.errors[KIND_TO_KEY[m.apiError.kind] ?? "unknown"]}</p>
              {m.apiError.message && (
                <p className="text-xs text-muted-foreground">{m.apiError.message}</p>
              )}
            </div>
          </div>
        )}
        {m.interrupted && (
          <span className="mt-1 inline-block text-xs text-muted-foreground">{t.chat.interrupted}</span>
        )}
        {(m.modelLabel || m.latencyMs !== undefined) && !isUser && (
          <div className="mt-1 flex items-center gap-2 text-xs text-muted-foreground">
            {m.modelLabel && <span>{m.modelLabel}</span>}
            {m.latencyMs !== undefined && <span>{m.latencyMs} ms</span>}
          </div>
        )}
      </div>
    </div>
  )
}
