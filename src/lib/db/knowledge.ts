import { execute, select } from "./database"

export interface KnowledgeRow {
  id: string
  name: string
  content: string
  enabled: number
  sort_order: number
  created_at: string
}

function now(): string {
  return new Date().toISOString().slice(0, 19).replace("T", " ")
}

// Bibliothèque de connaissances .md injectables dans le prompt système.
// Invariants : SQL 100 % paramétré ; contenu jamais loggué (sensible non, mais
// volumineux — et le garde-fou console.log est global).
export const knowledge = {
  async add(name: string, content: string): Promise<KnowledgeRow> {
    const trimmed = name.trim()
    if (!trimmed) throw new Error("Le nom de la connaissance est obligatoire.")
    // sort_order = max + 1
    const maxRow = await select<{ max: number }>(
      "SELECT COALESCE(MAX(sort_order), -1) as max FROM knowledge",
    )
    const sortOrder = (maxRow[0]?.max ?? -1) + 1
    const row: KnowledgeRow = {
      id: crypto.randomUUID(), name: trimmed, content, enabled: 1, sort_order: sortOrder, created_at: now(),
    }
    await execute(
      "INSERT INTO knowledge (id, name, content, enabled, sort_order, created_at) VALUES (?,?,?,?,?,?)",
      [row.id, row.name, row.content, row.enabled, row.sort_order, row.created_at],
    )
    return row
  },

  async list(): Promise<KnowledgeRow[]> {
    return select<KnowledgeRow>("SELECT * FROM knowledge ORDER BY sort_order ASC, created_at ASC")
  },

  async listEnabled(): Promise<KnowledgeRow[]> {
    return select<KnowledgeRow>("SELECT * FROM knowledge WHERE enabled = ? ORDER BY sort_order ASC, created_at ASC", [1])
  },

  async setEnabled(id: string, enabled: boolean): Promise<void> {
    await execute("UPDATE knowledge SET enabled = ? WHERE id = ?", [enabled ? 1 : 0, id])
  },

  async update(id: string, patch: { name?: string; content?: string }): Promise<void> {
    const sets: string[] = []
    const binds: unknown[] = []
    if (patch.name !== undefined) {
      sets.push("name = ?")
      binds.push(patch.name.trim())
    }
    if (patch.content !== undefined) {
      sets.push("content = ?")
      binds.push(patch.content)
    }
    if (sets.length === 0) return
    await execute(`UPDATE knowledge SET ${sets.join(", ")} WHERE id = ?`, [...binds, id])
  },

  async remove(id: string): Promise<void> {
    await execute("DELETE FROM knowledge WHERE id = ?", [id])
  },

  // Réordonner : swap sort_order avec le voisin adjacent (delta = -1 monter, +1 descendre)
  async move(id: string, delta: -1 | 1): Promise<void> {
    if (delta !== -1 && delta !== 1) return
    const currentRows = await select<{ sort_order: number }>(
      "SELECT sort_order FROM knowledge WHERE id = ?",
      [id],
    )
    if (currentRows.length === 0) return
    const currentOrder = currentRows[0].sort_order

    const neighborRows = await select<{ id: string }>(
      delta === -1
        ? "SELECT id FROM knowledge WHERE sort_order < ? ORDER BY sort_order DESC LIMIT 1"
        : "SELECT id FROM knowledge WHERE sort_order > ? ORDER BY sort_order ASC LIMIT 1",
      [currentOrder],
    )
    if (neighborRows.length === 0) return
    const neighborId = neighborRows[0].id
    const neighborOrder = currentOrder + delta

    // Swap les deux sort_order (voisin d'abord pour éviter conflit UNIQUE si constraint)
    await execute("UPDATE knowledge SET sort_order = ? WHERE id = ?", [currentOrder, neighborId])
    await execute("UPDATE knowledge SET sort_order = ? WHERE id = ?", [neighborOrder, id])
  },
}
