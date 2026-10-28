import { execute, select } from "./database"
import { secrets } from "@/lib/secrets/service"

export interface ProviderRow {
  id: string
  name: string
  api_family: "openai" | "gemini"
  base_url: string
  created_at: string
}

export interface ModelRow {
  id: string
  provider_id: string
  model_id: string
  supports_images: number
  is_default: number
}

// Convention de secretRef partagée avec activeModel.ts : identifiant Credential
// Manager, jamais la clé elle-même (la clé ne vit qu'en base de registre).
export function secretRefFor(providerId: string): string {
  return `logassist/provider/${providerId}`
}

// Compromis boundary cf errors.ts : (?:\b|_) étend \b aux snake_case
// (o1_preview, gemini_flash…). Heuristique M1 : pas d'appel API de vérification.
const IMAGE_MODEL_HINT = /(?:\b|_)(?:gpt-4|gpt-5|vision|claude|gemini|o1|o3)(?:\b|_)/i

function now(): string {
  return new Date().toISOString().slice(0, 19).replace("T", " ")
}

export const providers = {
  async create(name: string, apiFamily: "openai" | "gemini", baseUrl: string, secret?: string): Promise<ProviderRow> {
    const row: ProviderRow = { id: crypto.randomUUID(), name, api_family: apiFamily, base_url: baseUrl, created_at: now() }
    await execute("INSERT INTO providers (id, name, api_family, base_url, created_at) VALUES (?,?,?,?,?)", [
      row.id, row.name, row.api_family, row.base_url, row.created_at,
    ])
    if (secret) await secrets.set(secretRefFor(row.id), secret)
    return row
  },

  async list(): Promise<ProviderRow[]> {
    return select<ProviderRow>("SELECT * FROM providers ORDER BY created_at ASC")
  },

  async update(id: string, patch: { name?: string; apiFamily?: "openai" | "gemini"; baseUrl?: string }, secret?: string): Promise<void> {
    // Construction dynamique minimale : au plus 3 champs mutables en M1.
    const sets: string[] = []
    const bind: unknown[] = []
    if (patch.name !== undefined) { sets.push("name = ?"); bind.push(patch.name) }
    if (patch.apiFamily !== undefined) { sets.push("api_family = ?"); bind.push(patch.apiFamily) }
    if (patch.baseUrl !== undefined) { sets.push("base_url = ?"); bind.push(patch.baseUrl) }
    if (sets.length > 0) {
      bind.push(id)
      await execute(`UPDATE providers SET ${sets.join(", ")} WHERE id = ?`, bind)
    }
    if (secret) await secrets.set(secretRefFor(id), secret)
  },

  async remove(id: string): Promise<void> {
    // Le secret d'abord (secretRef dérivé de l'id) : si la DB échoue après, la
    // clé orpheline est réécrite à la prochaine update ; l'inverse laisserait
    // une cléCredential Manager pointant vers un provider disparu.
    await secrets.remove(secretRefFor(id))
    await execute("DELETE FROM providers WHERE id = ?", [id]) // cascade models via FK
  },

  // --- Modèles ---

  async addModel(providerId: string, modelId: string): Promise<ModelRow> {
    const row: ModelRow = {
      id: crypto.randomUUID(),
      provider_id: providerId,
      model_id: modelId,
      supports_images: IMAGE_MODEL_HINT.test(modelId) ? 1 : 0,
      is_default: 0,
    }
    await execute(
      "INSERT INTO models (id, provider_id, model_id, supports_images, is_default) VALUES (?,?,?,?,0)",
      [row.id, row.provider_id, row.model_id, row.supports_images],
    )
    return row
  },

  async listModels(providerId: string): Promise<ModelRow[]> {
    return select<ModelRow>("SELECT * FROM models WHERE provider_id = ? ORDER BY model_id ASC", [providerId])
  },

  async removeModel(id: string): Promise<void> {
    await execute("DELETE FROM models WHERE id = ?", [id])
  },

  async setDefaultModel(id: string): Promise<void> {
    // Un seul default par provider : on éteint les autres d'abord, puis on
    // allume la cible (l'ordre évite un instant sans default si le target
    // était déjà le seul).
    const rows = await select<{ provider_id: string }>("SELECT provider_id FROM models WHERE id = ?", [id])
    const providerId = rows[0]?.provider_id
    if (!providerId) return
    await execute("UPDATE models SET is_default = 0 WHERE provider_id = ? AND id != ?", [providerId, id])
    await execute("UPDATE models SET is_default = 1 WHERE id = ?", [id])
  },
}
