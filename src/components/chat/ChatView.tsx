import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react"
import { AlertTriangle, Check, Copy, FileText, Maximize2, RefreshCw, RotateCcw, Search, X } from "lucide-react"
import { t } from "@/i18n/fr"
import { logger } from "@/lib/logger"
import { KIND_TO_KEY } from "@/lib/ai/errors"
import type { ChatMessageVM } from "@/hooks/useChat"
import { formatCostMicrousd, formatTokens } from "@/lib/token"
import { isNearChatBottom } from "@/lib/chat/scrollPolicy"
import { MarkdownMessage } from "./MarkdownMessage"
import { MediaContent } from "./MediaContent"
import { ToolApprovalCard } from "./ToolApprovalCard"
import { TauriLink } from "./TauriLink"

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
  conversationId?: string | null
  isGenerating?: boolean
  onRetry?: (messageId: string) => Promise<boolean>
  onRegenerate?: (messageId: string) => Promise<boolean>
  modelSelector?: ModelSelectorProps | null
  onAllowTool?: () => void
  onDenyTool?: () => void
}

function createRenderSignature(vm: ChatMessageVM[]): string {
  return JSON.stringify(vm.map((message) => ({
    role: message.role,
    content: message.content,
    apiError: message.apiError
      ? { kind: message.apiError.kind, message: message.apiError.message }
      : null,
    interrupted: message.interrupted ?? false,
    webStatus: message.webStatus ?? null,
    webWarning: message.webWarning ?? null,
    toolApproval: message.toolApproval ?? null,
    sources: (message.sources ?? []).map((source) => ({
      url: source.url,
      title: source.title,
      origin: source.origin,
    })),
    media: (message.media ?? []).map((m) => ({
      id: m.id,
      type: m.type,
      mimeType: m.mimeType,
      toolLabel: m.toolLabel,
    })),
    attachments: (message.attachments ?? []).map((attachment) => ({
      kind: attachment.kind,
      name: attachment.name,
      mimeType: attachment.mimeType,
      hasBase64: Boolean(attachment.base64),
    })),
    modelLabel: message.modelLabel ?? null,
    firstTokenMs: message.firstTokenMs ?? null,
    latencyMs: message.latencyMs ?? null,
    inputTokens: message.inputTokens ?? null,
    outputTokens: message.outputTokens ?? null,
    usageSource: message.usageSource ?? null,
    costMicrousd: message.costMicrousd ?? null,
    recoveryMode: message.recoveryMode ?? null,
    recoveryFailed: message.recoveryFailed ?? false,
  })))
}

const PROGRAMMATIC_RETURN_CANCEL_KEYS = new Set([
  "ArrowUp",
  "ArrowDown",
  "PageUp",
  "PageDown",
  "Home",
  "End",
  " ",
  "Space",
])

export function ChatView({
  vm,
  hasModel,
  showConversation,
  conversationId,
  isGenerating = false,
  onRetry,
  onRegenerate,
  modelSelector,
  onAllowTool,
  onDenyTool,
}: Props) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const contentRef = useRef<HTMLDivElement>(null)
  const shouldFollowRef = useRef(true)
  const returningToBottomRef = useRef(false)
  const [hasUnreadContent, setHasUnreadContent] = useState(false)
  const [expandedImage, setExpandedImage] = useState<{ src: string; alt: string } | null>(null)
  const renderSignature = useMemo(() => createRenderSignature(vm), [vm])
  const latestAssistantId = useMemo(() => {
    for (let index = vm.length - 1; index >= 0; index--) {
      if (vm[index].role === "assistant") return vm[index].id
    }
    return undefined
  }, [vm])

  const scrollToBottom = (behavior: ScrollBehavior): void => {
    const element = scrollRef.current
    if (!element) return
    element.scrollTo({ top: element.scrollHeight, behavior })
  }

  const onScroll = (): void => {
    const element = scrollRef.current
    if (!element) return
    const follows = isNearChatBottom(element)

    if (returningToBottomRef.current) {
      if (follows) {
        returningToBottomRef.current = false
        shouldFollowRef.current = true
        setHasUnreadContent(false)
      }
      return
    }

    shouldFollowRef.current = follows
    if (follows) setHasUnreadContent(false)
  }

  const jumpToBottom = (): void => {
    const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false
    const behavior: ScrollBehavior = reduced || isGenerating ? "auto" : "smooth"
    returningToBottomRef.current = behavior === "smooth"
    shouldFollowRef.current = true
    setHasUnreadContent(false)
    scrollToBottom(behavior)
    scrollRef.current?.focus({ preventScroll: true })
  }

  const cancelProgrammaticReturn = (): void => {
    if (!returningToBottomRef.current) return
    returningToBottomRef.current = false
    const element = scrollRef.current
    if (!element) return
    element.scrollTo({ top: element.scrollTop, behavior: "auto" })
    const follows = isNearChatBottom(element)
    shouldFollowRef.current = follows
    if (follows) setHasUnreadContent(false)
  }

  // Le reset précède volontairement la synchronisation VM : lors d'un
  // changement de conversation, l'ancienne VM transitoire repart déjà du bas.
  useLayoutEffect(() => {
    returningToBottomRef.current = false
    shouldFollowRef.current = true
    setHasUnreadContent(false)
  }, [conversationId])

  // La signature ne réagit qu'aux données rendues : un reload SQLite composé
  // de nouveaux objets identiques ne doit pas interrompre un scroll smooth.
  useLayoutEffect(() => {
    if (shouldFollowRef.current) scrollToBottom("auto")
    else if (vm.length > 0) setHasUnreadContent(true)
  }, [conversationId, renderSignature])

  useEffect(() => {
    if (typeof ResizeObserver === "undefined") return
    const element = contentRef.current
    const viewport = scrollRef.current
    if (!element || !viewport) return

    let previousHeight = element.scrollHeight
    const observer = new ResizeObserver((entries) => {
      const viewportChanged = entries.some((entry) => entry.target === viewport)
      let contentGrew = false

      for (const entry of entries) {
        if (entry.target !== element) continue

        const nextHeight = entry.contentRect.height || element.scrollHeight
        if (nextHeight > previousHeight) contentGrew = true
        previousHeight = nextHeight
      }

      // Un lot viewport + contenu correspond à un reflow. En lecture figée,
      // il ne représente pas une nouvelle réponse et ne crée donc pas d'unread.
      if (contentGrew && returningToBottomRef.current) {
        returningToBottomRef.current = false
        shouldFollowRef.current = true
        setHasUnreadContent(false)
        scrollToBottom("auto")
        return
      }

      if (viewportChanged) {
        if (shouldFollowRef.current) scrollToBottom("auto")
        return
      }

      if (!contentGrew) return
      if (shouldFollowRef.current) scrollToBottom("auto")
      else setHasUnreadContent(true)
    })
    observer.observe(element)
    observer.observe(viewport)
    return () => observer.disconnect()
  }, [showConversation])

  if (!showConversation) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <p className="text-sm text-muted-foreground">{t.chat.noConversation}</p>
      </div>
    )
  }

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <div className="relative flex-1 overflow-hidden">
        <div
          ref={scrollRef}
          role="log"
          tabIndex={-1}
          aria-live="polite"
          onScroll={onScroll}
          onWheel={cancelProgrammaticReturn}
          onTouchStart={cancelProgrammaticReturn}
          onPointerDown={cancelProgrammaticReturn}
          onKeyDown={(event) => {
            if (PROGRAMMATIC_RETURN_CANCEL_KEYS.has(event.key)) cancelProgrammaticReturn()
          }}
          className={`h-full overflow-y-auto p-4${hasUnreadContent ? " pb-16" : ""}`}
        >
          <div ref={contentRef} className="mx-auto w-full max-w-[90rem] space-y-4">
            {vm.length === 0 && !hasModel && (
              <p className="text-sm text-muted-foreground">{t.chat.configureProvider}</p>
            )}
            {vm.map((m, i) => (
              <MessageBubble
                key={m.id ?? `local-${i}`}
                m={m}
                onImageClick={setExpandedImage}
                isLatestAssistant={m.role === "assistant" && m.id === latestAssistantId}
                isGenerating={isGenerating}
                onRetry={onRetry}
                onRegenerate={onRegenerate}
                onAllowTool={onAllowTool}
                onDenyTool={onDenyTool}
              />
            ))}
          </div>
        </div>
        <span className="sr-only" role="status" aria-live="polite">
          {hasUnreadContent ? t.chat.newResponse : ""}
        </span>
        {hasUnreadContent && (
          <button
            type="button"
            onClick={jumpToBottom}
            aria-label={t.chat.backToBottom}
            className="absolute bottom-3 left-1/2 -translate-x-1/2 rounded-full border border-[var(--brand-to)] bg-background/95 px-3 py-1.5 text-xs text-foreground shadow-lg hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-foreground focus-visible:ring-offset-2 focus-visible:ring-offset-background"
          >
            ↓ {t.chat.newResponse}
          </button>
        )}
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
  isLatestAssistant,
  isGenerating,
  onRetry,
  onRegenerate,
  onAllowTool,
  onDenyTool,
}: {
  m: ChatMessageVM
  onImageClick: (img: { src: string; alt: string }) => void
  isLatestAssistant: boolean
  isGenerating: boolean
  onRetry?: (messageId: string) => Promise<boolean>
  onRegenerate?: (messageId: string) => Promise<boolean>
  onAllowTool?: () => void
  onDenyTool?: () => void
}) {
  const isUser = m.role === "user"
  const attachments = m.attachments ?? []
  // Bouton copier : mêmes morphologies et délais que CodeBlock (MarkdownMessage).
  // Le texte copié est m.content — markdown SOURCE pour l'assistant, texte
  // brut pour l'utilisateur ; jamais le HTML rendu.
  const [copied, setCopied] = useState(false)
  const copyTimer = useRef<number | undefined>(undefined)
  const mountedRef = useRef(true)
  // Nettoyage du timer : pas de setState sur composant démonté
  // (changement de conversation pendant le feedback).
  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      window.clearTimeout(copyTimer.current)
    }
  }, [])

  const onCopyMessage = () => {
    navigator.clipboard
      .writeText(m.content)
      .then(() => {
        if (!mountedRef.current) return
        // Second clic rapproché : annule le timer du premier — le feedback
        // reste plein 1,5 s après le DERNIER clic, jamais expiré en avance.
        if (copyTimer.current !== undefined) window.clearTimeout(copyTimer.current)
        setCopied(true)
        copyTimer.current = window.setTimeout(() => setCopied(false), 1500)
      })
      .catch((e: unknown) => logger.error(["[ChatView] copie du message impossible:", e]))
  }

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
  const totalTokens = m.inputTokens !== undefined && m.outputTokens !== undefined
    ? m.inputTokens + m.outputTokens
    : undefined
  const tokenLabel = totalTokens === undefined
    ? undefined
    : `${m.usageSource === "estimated" ? "≈ " : ""}${formatTokens(totalTokens)} ${t.chat.tokens}`
  const hasPersistedId = Boolean(m.id && !m.persistenceFailed)
  const canRetry = isLatestAssistant && hasPersistedId &&
    Boolean(m.apiError) && m.apiError?.kind !== "persistence" && !m.interrupted && Boolean(onRetry)
  const canRegenerate = isLatestAssistant && hasPersistedId &&
    Boolean(m.content) && !m.apiError && !m.interrupted && Boolean(onRegenerate)
  const recoveryDisabled = isGenerating || Boolean(m.recoveryMode)
  const showAssistantActions = !isUser && (Boolean(m.content) || canRetry || Boolean(m.recoveryMode))
  const glassSurfaceClass = "rounded-xl border border-border/50 bg-background/40 backdrop-blur-sm"
  const bubbleClass = m.apiError
    ? "max-w-[88%] rounded-xl border border-destructive bg-destructive/10 px-3 py-2"
    : isUser
      ? `max-w-[80%] px-3 py-2 ${glassSurfaceClass}`
      : `w-full max-w-[56rem] border-l-2 border-l-[var(--brand-to)] px-4 py-2 ${glassSurfaceClass}`

  return (
    <div className={`flex ${isUser ? "justify-end" : "justify-start"}`}>
      <div data-testid={`message-${m.role}`} className={`text-sm ${bubbleClass}`}>
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
        ) : !isUser && m.toolApproval && onAllowTool && onDenyTool ? (
          // Carte d'approbation d'outil : rend null pour le contenu vide,
          // puis la carte ToolApprovalCard sera rendue après ce bloc.
          null
        ) : !isUser && !m.apiError && !m.interrupted && !m.toolApproval && webStatusLabel ? (
          <span role="status" className="inline-flex items-center gap-2 text-xs text-muted-foreground">
            <Search className="size-3.5 animate-pulse" />
            {webStatusLabel}
          </span>
        ) : !isUser && !m.apiError && !m.interrupted && !m.toolApproval ? (
          // Attente du 1er token : anneau de réflexion au lieu du « … »
          <span role="status" aria-label={t.chat.thinking}>
            <span className="thinking-spinner" />
          </span>
        ) : (
          <pre className="whitespace-pre-wrap font-sans text-sm">{m.content}</pre>
        )}
        {!isUser && m.media && m.media.length > 0 && (
          <MediaContent media={m.media} onImageClick={onImageClick} />
        )}
        {!isUser && m.toolApproval && onAllowTool && onDenyTool && (
          <ToolApprovalCard request={m.toolApproval} onAllow={onAllowTool} onDeny={onDenyTool} />
        )}
        {m.content && isUser && (
          // Le bouton utilisateur reste autonome et toujours visible.
          <div className="mt-1 flex justify-end">
            <button
              type="button"
              onClick={onCopyMessage}
              aria-label={copied ? t.chat.messageCopied : t.chat.copyMessage}
              className="rounded-md p-1 text-muted-foreground hover:text-foreground focus-visible:text-foreground"
            >
              {copied ? (
                <Check className="size-3.5 text-[var(--brand-to)]" aria-hidden="true" />
              ) : (
                <Copy className="size-3.5" aria-hidden="true" />
              )}
            </button>
          </div>
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
        {m.recoveryMode && (
          <span
            role="status"
            aria-label={m.recoveryMode === "retry" ? t.chat.retrying : t.chat.regenerating}
            className="mt-2 inline-flex items-center gap-2 text-xs text-muted-foreground"
          >
            <span className="thinking-spinner" aria-hidden="true" />
            {m.recoveryMode === "retry" ? t.chat.retrying : t.chat.regenerating}
          </span>
        )}
        {m.recoveryFailed && (
          <p role="note" className="mt-2 text-xs text-destructive">
            {t.chat.recoveryFailed}
          </p>
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
                <TauriLink
                  key={source.url}
                  href={source.url}
                  className="inline-flex max-w-full items-center gap-1 rounded-md border border-border bg-background/60 px-2 py-1 text-xs hover:bg-foreground/5"
                >
                  <span className="truncate">{source.title || source.url}</span>
                </TauriLink>
              ))}
            </div>
          </div>
        )}
        {showAssistantActions && (
          <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            {m.modelLabel && <span>{m.modelLabel}</span>}
            {m.firstTokenMs !== undefined && <span>{formatLatency(m.firstTokenMs)} {t.chat.firstToken}</span>}
            {m.latencyMs !== undefined && <span>{formatLatency(m.latencyMs)}</span>}
            {tokenLabel && (
              <span title={m.usageSource === "estimated" ? t.chat.estimatedUsage : undefined}>
                <span>{tokenLabel}</span>
                {m.usageSource === "estimated" && (
                  <span className="sr-only"> {t.chat.estimatedUsage}</span>
                )}
              </span>
            )}
            {m.costMicrousd !== undefined && <span>{formatCostMicrousd(m.costMicrousd)}</span>}
            {m.inputTokens !== undefined && m.outputTokens !== undefined && (
              <span className="text-[10px] opacity-60">
                ({t.chat.inputShort}: {formatTokens(m.inputTokens)} / {t.chat.outputShort}: {formatTokens(m.outputTokens)})
              </span>
            )}
            {canRetry && (
              <button
                type="button"
                disabled={recoveryDisabled}
                onClick={() => void onRetry?.(m.id!)}
                aria-label={t.chat.retry}
                title={t.chat.retry}
                className="ml-auto shrink-0 rounded-md p-1 text-muted-foreground hover:text-foreground focus-visible:text-foreground disabled:cursor-not-allowed disabled:opacity-40"
              >
                <RefreshCw className="size-3.5" aria-hidden="true" />
              </button>
            )}
            {canRegenerate && (
              <button
                type="button"
                disabled={recoveryDisabled}
                onClick={() => void onRegenerate?.(m.id!)}
                aria-label={t.chat.regenerate}
                title={t.chat.regenerate}
                className={`${canRetry ? "" : "ml-auto "}shrink-0 rounded-md p-1 text-muted-foreground hover:text-foreground focus-visible:text-foreground disabled:cursor-not-allowed disabled:opacity-40`}
              >
                <RotateCcw className="size-3.5" aria-hidden="true" />
              </button>
            )}
            {m.content && (
              <button
                type="button"
                onClick={onCopyMessage}
                aria-label={copied ? t.chat.messageCopied : t.chat.copyMessage}
                className={`${canRetry || canRegenerate ? "" : "ml-auto "}shrink-0 rounded-md p-1 text-muted-foreground hover:text-foreground focus-visible:text-foreground`}
              >
                {copied ? (
                  <Check className="size-3.5 text-[var(--brand-to)]" aria-hidden="true" />
                ) : (
                  <Copy className="size-3.5" aria-hidden="true" />
                )}
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
