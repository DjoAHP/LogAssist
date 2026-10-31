import { execute, select } from "./database"

export interface KnowledgeRow {
  id: string
  name: string
  content: string
  enabled: number
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
    const row: KnowledgeRow = {
      id: crypto.randomUUID(), name: trimmed, content, enabled: 1, created_at: now(),
    }
    await execute(
      "INSERT INTO knowledge (id, name, content, enabled, created_at) VALUES (?,?,?,?,?)",
      [row.id, row.name, row.content, row.enabled, row.created_at],
    )
    return row
  },

  async list(): Promise<KnowledgeRow[]> {
    return select<KnowledgeRow>("SELECT * FROM knowledge ORDER BY created_at ASC")
  },

  async listEnabled(): Promise<KnowledgeRow[]> {
    return select<KnowledgeRow>("SELECT * FROM knowledge WHERE enabled = ? ORDER BY created_at ASC", [1])
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
}
