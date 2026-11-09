import type { ToolChoice } from "@/lib/ai/types"

const WEB_URL = /https?:\/\/[^\s<>"'`]+/i
const EXPLICIT_WEB_REQUEST =
  /(?:^|[.!?]\s*)(?:(?:peux-tu|pourrais-tu|merci de)\s+)?(?:cherche(?:r)?|recherche(?:r)?|v[ée]rifie(?:r)?)\b[^.!?]*(?:internet|web|en ligne)\b/i

export type WebIntent = "auto" | "required" | "search" | "fetch_content"

export function resolveWebIntent(text: string, forceOnce: boolean): WebIntent {
  if (forceOnce) return "required"
  if (WEB_URL.test(text)) return "fetch_content"
  if (EXPLICIT_WEB_REQUEST.test(text)) return "search"
  return "auto"
}

/**
 * @deprecated Utiliser resolveWebIntent + firstRoundChoice depuis toolAgent.ts.
 * Conservé pour compatibilité avec l'existant (useChat, webAgent).
 * Retourne un ToolChoice avec les noms d'outils "search" / "fetch_content" codés en dur
 * (correspondant à WEB_TOOL_DEFINITIONS dans webAgent.ts).
 */
export function resolveWebChoice(text: string, forceOnce: boolean): ToolChoice {
  const intent = resolveWebIntent(text, forceOnce)
  if (intent === "auto" || intent === "required") return intent
  return { type: "function", function: { name: intent } }
}