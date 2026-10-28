import { select } from "./database"
import type { ProviderConfig } from "@/lib/ai/types"

export interface ActiveModel {
  provider: ProviderConfig
  modelId: string
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
    model_id: string
  }>(
    `SELECT p.id, p.name, p.api_family, p.base_url, m.model_id
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
    modelId: r.model_id,
  }
}
