import type { ToolChoice } from "@/lib/ai/types"

const WEB_URL = /https?:\/\/[^\s<>"'`]+/i
const EXPLICIT_WEB_REQUEST =
  /(?:^|[.!?]\s*)(?:(?:peux-tu|pourrais-tu|merci de)\s+)?(?:cherche(?:r)?|recherche(?:r)?|v[ée]rifie(?:r)?)\b[^.!?]*(?:internet|web|en ligne)\b/i

export function resolveWebChoice(text: string, forceOnce: boolean): ToolChoice {
  if (forceOnce) return "required"
  if (WEB_URL.test(text)) {
    return { type: "function", function: { name: "fetch_content" } }
  }
  if (EXPLICIT_WEB_REQUEST.test(text)) {
    return { type: "function", function: { name: "search" } }
  }
  return "auto"
}
