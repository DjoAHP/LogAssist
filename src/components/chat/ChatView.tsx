import { useEffect, useRef, useState } from "react"
import { AlertTriangle, ExternalLink, FileText, Maximize2, Search, X } from "lucide-react"
import { t } from "@/i18n/fr"
import { logger } from "@/lib/logger"
import { KIND_TO_KEY } from "@/lib/ai/errors"
import type { ChatMessageVM } from "@/hooks/useChat"
import { useTokenCount, formatCost, formatTokens } from "@/lib/token"
import { knowledge as knowledgeDb } from "@/lib/db/knowledge"
import { conversationKnowledge } from "@/lib/db/conversationKnowledge"
import { MarkdownMessage } from "./MarkdownMessage"

// Latence en secondes (format français : virgule décimale) — les ms
// brutes sont peu lisibles au-dessus de la seconde.
function formatLatency(ms: number): string {
  return `${(ms / 1000).toFixed(1).replace(".", ",")} s`
}

interface ModelSelectorProps {
  options: { rowId: string; label: string; isDefault: boolean; supportsImages: boolean }[]
  onSelect: (rowId: string) => void
}

interface Props {
  vm: ChatMessageVM[]
  hasModel: boolean
  showConversation: boolean
  modelSelector?: ModelSelectorProps | null
  // Token counting
  activeModel?: { provider: string; modelId: string; modelLabel: string } | null
  systemPrompt: string
  conversationId?: string | null
}

export function ChatView({
  vm,
  hasModel,
  showConversation,
  modelSelector,
  activeModel,
  systemPrompt,
  conversationId,
}: Props) {
  const bottomRef = useRef<HTMLDivElement>(null)
  const last = vm[vm.length - 1]
  const [expandedImage, setExpandedImage] = useState<{ src: string; alt: string } | null>(null)

  // Chargement des connaissances pour le comptage de tokens
  const [knowledgeContent, setKnowledgeContent] = useState("")
  useEffect(() => {
    if (!conversationId) return
    void (async () => {
      const knowledgeIds = await conversationKnowledge.listOn(conversationId)
      if (knowledgeIds.length === 0) {
        setKnowledgeContent("")
        return
      }
      const allKnowledge = await knowledgeDb.list()
      const activeKnowledge = allKnowledge
        .filter((k) => knowledgeIds.includes(k.id))
        .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0))
      const combined = activeKnowledge.map((k) => k.content).join("\n\n---\n\n")
      setKnowledgeContent(combined)
    })()
  }, [conversationId])

  // Comptage tokens + coût
  const activeProvider = activeModel?.provider ?? ""
  const activeModelId = activeModel?.modelId ?? ""
  const tokenInfo = useTokenCount(
    activeProvider,
    activeModelId,
    vm.map((m) => ({ role: m.role, content: m.content })),
    systemPrompt,
    knowledgeContent
  )

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
          <MessageBubble
            key={m.id ?? `local-${i}`}
            m={m}
            onImageClick={setExpandedImage}
            tokenInfo={tokenInfo}
            activeModel={activeModel}
          />
        ))}
        <div ref={bottomRef} />
      </div>
      {modelSelector && modelSelector.options.length > 0 && <ModelSelectorFooter {...modelSelector} />}

      {expandedImage && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/90"
          onClick={() => setExpandedImage(null)}
          role="dialog"
          aria-modal="true"
          aria-label="Image agrandie"
        >
          <div className="relative max-w-[90vw] max-h-[90vh]">
            <button
              onClick={() => setExpandedImage(null)}
              className="absolute -top-10 right-0 text-white/80 hover:text-white p-2"
              aria-label="Fermer"
            >
              <X className="size-6" />
            </button>
            <img
              src={expandedImage.src}
              alt={expandedImage.alt}
              className="max-w-[90vw] max-h-[90vh] object-contain"
            />
          </div>
        </div>
      )}
    </div>
  )
}

// Sélecteur M1 en pied de vue : option value = ModelRow.id (nécessaire à
// providers.setDefaultModel), label « Provider › modèle ». Liste vide → masqué.
function ModelSelectorFooter({ options, onSelect }: ModelSelectorProps) {
  const current = options.find((o) => o.isDefault) ?? options[0]
  logger.debug("[ModelSelector] options:", options.map((o) => ({ label: o.label, isDefault: o.isDefault, supportsImages: o.supportsImages })))
  logger.debug("[ModelSelector] current (default):", current)
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
            {o.supportsImages && " 🖼️"}
          </option>
        ))}
      </select>
    </div>
  )
}

function MessageBubble({
  m,
  onImageClick,
  tokenInfo,
  activeModel,
}: {
  m: ChatMessageVM
  onImageClick: (img: { src: string; alt: string }) => void
  tokenInfo: { inputTokens: number; outputTokens: number; totalTokens: number; estimatedCost: number }
  activeModel: { provider: string; modelId: string; modelLabel: string } | null | undefined
}) {
  const isUser = m.role === "user"
  const attachments = m.attachments ?? []
  const seenSourceUrls = new Set<string>()
  const sources = (m.sources ?? []).filter((source) => {
    try {
      const protocol = new URL(source.url).protocol
      if (protocol !== "http:" && protocol !== "https:") return false
    } catch {
      return false
    }
    if (seenSourceUrls.has(source.url)) return false
    seenSourceUrls.add(source.url)
    return true
  })
  const webStatusLabel = m.webStatus === "searching"
    ? t.chat.webSearching
    : m.webStatus === "fetching"
      ? t.chat.webFetching
      : undefined

  return (
    <div className={`flex ${isUser ? "justify-end" : "justify-start"}`}>
      <div
        className={`max-w-[80%] rounded-lg border px-3 py-2 text-sm ${
          m.apiError ? "border-destructive bg-destructive/10" : "border-border bg-foreground/5"
        }`}
      >
        {attachments.length > 0 && (
          <div className="flex flex-wrap gap-1.5 mb-2">
            {attachments.map((a) =>
              // Texte (ou légat sans base64) : chip fichier — JAMAIS de <img src="">
              a.kind === "text" || !a.base64 ? (
                <div
                  key={a.id}
                  className="flex items-center gap-1 rounded-md border border-border px-2 py-1 text-xs"
                >
                  <FileText className="size-3.5" />
                  <span>{a.name}</span>
                </div>
              ) : (
                <div key={a.id} className="relative group">
                  <img
                    src={`data:${a.mimeType};base64,${a.base64}`}
                    alt={a.name}
                    className="max-w-[200px] max-h-[200px] rounded-lg border border-border cursor-zoom-in object-cover"
                    onClick={() => onImageClick({ src: `data:${a.mimeType};base64,${a.base64}`, alt: a.name })}
                    title={a.name}
                  />
                  <div className="absolute inset-0 bg-black/50 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity rounded-lg">
                    <Maximize2 className="size-6 text-white" />
                  </div>
                </div>
              ),
            )}
          </div>
        )}
        {m.content ? (
          // Assistant : markdown rendu (GFM + coloration). Utilisateur :
          // texte brut — ses « ## » ne doivent pas devenir des titres.
          isUser ? (
            <pre className="whitespace-pre-wrap font-sans text-sm">{m.content}</pre>
          ) : (
            <MarkdownMessage content={m.content} />
          )
        ) : !isUser && !m.apiError && !m.interrupted && webStatusLabel ? (
          <span role="status" className="inline-flex items-center gap-2 text-xs text-muted-foreground">
            <Search className="size-3.5 animate-pulse" />
            {webStatusLabel}
          </span>
        ) : !isUser && !m.apiError && !m.interrupted ? (
          // Attente du 1er token : anneau de réflexion au lieu du « … »
          <span role="status" aria-label={t.chat.thinking}>
            <span className="thinking-spinner" />
          </span>
        ) : (
          <pre className="whitespace-pre-wrap font-sans text-sm">{m.content}</pre>
        )}
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
        {m.webWarning && !isUser && (
          <div role="note" className="mt-2 flex items-start gap-1.5 rounded-md border border-amber-500/25 bg-amber-500/10 px-2 py-1.5 text-xs text-amber-700 dark:text-amber-300">
            <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
            <span>{m.webWarning}</span>
          </div>
        )}
        {sources.length > 0 && !isUser && (
          <div className="mt-3 border-t border-border pt-2">
            <p className="mb-1.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{t.chat.sources}</p>
            <div className="flex flex-wrap gap-1.5">
              {sources.map((source) => (
                <a
                  key={source.url}
                  href={source.url}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex max-w-full items-center gap-1 rounded-md border border-border bg-background/60 px-2 py-1 text-xs text-[var(--brand-to)] hover:bg-foreground/5"
                >
                  <span className="truncate">{source.title || source.url}</span>
                  <ExternalLink className="size-3 shrink-0" />
                </a>
              ))}
            </div>
          </div>
        )}
        {(m.modelLabel || m.latencyMs !== undefined) && !isUser && (
          <div className="mt-1 flex items-center gap-2 text-xs text-muted-foreground">
            {m.modelLabel && <span>{m.modelLabel}</span>}
            {m.latencyMs !== undefined && <span>{formatLatency(m.latencyMs)}</span>}
          </div>
        )}

{/* Token count + cost pour les messages assistant (si modèle actif) */}
        {!isUser && activeModel && m.content && (
          <div className="mt-1 flex items-center gap-2 text-xs text-muted-foreground">
            <span>{formatTokens(tokenInfo.totalTokens)} tokens</span>
            <span>·</span>
            <span>{formatCost(tokenInfo.estimatedCost)}</span>
            <span className="text-[10px] opacity-60">(in: {formatTokens(tokenInfo.inputTokens)} / out: {formatTokens(tokenInfo.outputTokens)})</span>
          </div>
        )}
      </div>
    </div>
  )
}
