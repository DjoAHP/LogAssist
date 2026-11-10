// Rendu markdown des réponses assistant.
// Invariants :
//  - PAS de rehype-raw : le HTML brut d'un LLM reste échappé par React
//    (invariant sécurité n°3 — aucun innerHTML/dangerouslySetInnerHTML).
//  - memo(content) : pendant le streaming, seule la bulle en cours est
//    re-parsée à chaque token ; les bulles antérieures gardent leur référence.
//  - Liens externes : ouverts via Tauri Opener (navigateur par défaut).
import { memo, useRef, useState, useEffect, type ReactNode } from "react"
import ReactMarkdown from "react-markdown"
import remarkGfm from "remark-gfm"
import rehypeHighlight from "rehype-highlight"
import { t } from "@/i18n/fr"
import { logger } from "@/lib/logger"
import { TauriLink } from "./TauriLink"

// Bloc de code : fond distinct + bouton Copier (feedback « Copié » 1,5 s).
// Le texte copié vient du textContent du <pre> — robuste quelle que soit
// la coloration syntaxique injectée par rehype-highlight.
function CodeBlock({ children }: { children?: ReactNode }) {
  const preRef = useRef<HTMLPreElement>(null)
  const [copied, setCopied] = useState(false)
  const timerRef = useRef<number | undefined>(undefined)

  // Nettoyage du timer : évite un setState sur composant démonté
  // (bulle retirée pendant le feedback, ex. changement de conversation).
  useEffect(() => () => window.clearTimeout(timerRef.current), [])

  const onCopy = () => {
    const text = preRef.current?.textContent ?? ""
    navigator.clipboard
      .writeText(text)
      .then(() => {
        setCopied(true)
        timerRef.current = window.setTimeout(() => setCopied(false), 1500)
      })
      .catch((e: unknown) => logger.error(["[MarkdownMessage] copie impossible:", e]))
  }

  return (
    <div className="group relative my-2">
      <button
        type="button"
        onClick={onCopy}
        className="absolute right-2 top-2 z-10 rounded-md border border-border bg-background px-2 py-0.5 text-xs text-muted-foreground opacity-0 transition-opacity hover:text-foreground focus-visible:opacity-100 group-hover:opacity-100"
      >
        {copied ? t.chat.copied : t.chat.copy}
      </button>
      <pre
        ref={preRef}
        className="overflow-x-auto rounded-lg border border-border bg-background p-3 text-xs leading-relaxed"
      >
        {children}
      </pre>
    </div>
  )
}

function MarkdownMessageInner({ content }: { content: string }) {
  return (
    <div className="md-body text-sm">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[rehypeHighlight]}
        components={{
          pre: CodeBlock,
          // Liens externes : ouverture dans le navigateur par défaut via Tauri
          a: TauriLink,
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  )
}

export const MarkdownMessage = memo(MarkdownMessageInner)
