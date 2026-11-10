"use client"

import { openUrl } from "@tauri-apps/plugin-opener"
import { ExternalLink } from "lucide-react"
import { logger } from "@/lib/logger"

interface TauriLinkProps extends React.AnchorHTMLAttributes<HTMLAnchorElement> {
  /** Force l'ouverture externe même si le href est relatif (défaut: true pour http/https) */
  external?: boolean
}

/**
 * Lien qui s'ouvre dans le navigateur par défaut via Tauri Opener.
 * Utilisé pour tous les liens externes dans l'application (réponses assistant, sources, etc.).
 * Évite l'ouverture dans la webview Tauri.
 * Compatible avec ReactMarkdown (accepte toutes les props d'ancre HTML).
 */
export function TauriLink({
  href,
  children,
  className = "",
  external = true,
  ...rest
}: TauriLinkProps) {
  const handleClick = async (event: React.MouseEvent<HTMLAnchorElement>) => {
    // Si ce n'est pas un lien externe ou pas de href, laisser le comportement natif
    if (!external || !href) return

    // Validation : seuls http/https autorisés pour l'ouverture externe
    try {
      const url = new URL(href)
      if (url.protocol !== "http:" && url.protocol !== "https:") return
    } catch {
      return
    }

    event.preventDefault()
    event.stopPropagation()

    try {
      await openUrl(href)
    } catch (error) {
      logger.error(`[TauriLink] Échec ouverture: ${error}`)
      // Fallback : ouverture classique si Tauri indisponible (dev web)
      window.open(href, "_blank", "noopener,noreferrer")
    }
  }

  return (
    <a
      href={href}
      onClick={handleClick}
      target="_blank"
      rel="noopener noreferrer"
      className={`inline-flex items-center gap-1 text-[var(--brand-to)] underline underline-offset-2 hover:no-underline transition-colors ${className}`}
      {...rest}
    >
      {children}
      <ExternalLink data-testid="external-link-icon" className="size-3.5 shrink-0 opacity-70" aria-hidden="true" />
    </a>
  )
}