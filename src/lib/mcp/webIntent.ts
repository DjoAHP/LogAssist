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