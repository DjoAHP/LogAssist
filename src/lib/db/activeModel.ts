import { select } from "./database"
import type { ProviderConfig } from "@/lib/ai/types"

export interface ActiveModel {
  provider: ProviderConfig
  modelRowId: string
  modelId: string
  contextWindowOverride: number | null
  maxOutputTokensOverride: number | null
}

// Lecture minimale du modèle actif. INVARIANT : is_default est GLOBAL (un seul
// modèle actif pour tout le chat, cf providers.setDefaultModel) → le JOIN +
// LIMIT 1 est déterministe : exactement 0 ou 1 ligne. Convention de secretRef
// identique à secretRefFor() de Task 10 : logassist/provider/<id>.
export async function getActiveModel(): Promise<ActiveModel | null> {
  const rows = await select<{
    id: string
    name: string
    api_family: string
    base_url: string
    model_row_id: string
    model_id: string
    context_window_override: number | null
    max_output_tokens_override: number | null
  }>(
    `SELECT p.id, p.name, p.api_family, p.base_url,
            m.id AS model_row_id, m.model_id,
            m.context_window_override, m.max_output_tokens_override
     FROM providers p
     JOIN models m ON m.provider_id = p.id
     WHERE m.is_default = 1
     LIMIT 1`,
  )
  const r = rows[0]
  if (!r) return null
  return {
    provider: {
      id: r.id,
      name: r.name,
      apiFamily: r.api_family === "gemini" ? "gemini" : "openai",
      baseUrl: r.base_url,
      secretRef: `logassist/provider/${r.id}`,
    },
    modelRowId: r.model_row_id,
    modelId: r.model_id,
    contextWindowOverride: r.context_window_override ?? null,
    maxOutputTokensOverride: r.max_output_tokens_override ?? null,
  }
}
