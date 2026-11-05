import { execute, select } from "./database"

export interface ConversationRow {
  id: string
  project_id: string | null
  title: string
  archived: number
  // Colonnes migration V4 : épinglée en haut de liste (tri SQL pinned DESC)
  pinned: number
  created_at: string
  updated_at: string
}

function now(): string {
  return new Date().toISOString().slice(0, 19).replace("T", " ")
}

export const conversations = {
  async create(title = "Nouveau chat"): Promise<ConversationRow> {
    const row: ConversationRow = { id: crypto.randomUUID(), project_id: null, title, archived: 0, pinned: 0, created_at: now(), updated_at: now() }
    await execute(
      "INSERT INTO conversations (id, project_id, title, archived, pinned, created_at, updated_at) VALUES (?,?,?,0,0,?,?)",
      [row.id, row.project_id, row.title, row.created_at, row.updated_at],
    )
    return row
  },
  async list(includeArchived = false): Promise<ConversationRow[]> {
    const sql = includeArchived
      ? "SELECT * FROM conversations ORDER BY pinned DESC, updated_at DESC"
      : "SELECT * FROM conversations WHERE archived = 0 ORDER BY pinned DESC, updated_at DESC"
    return select<ConversationRow>(sql)
  },
  async rename(id: string, title: string): Promise<void> {
    await execute("UPDATE conversations SET title = ?, updated_at = datetime('now') WHERE id = ?", [title, id])
  },
  async setArchived(id: string, archived: boolean): Promise<void> {
    await execute("UPDATE conversations SET archived = ?, updated_at = datetime('now') WHERE id = ?", [archived ? 1 : 0, id])
  },
  // Épinglage : pas de touch() — le tri pinned DESC suffit, updated_at reste signifiant
  async setPinned(id: string, pinned: boolean): Promise<void> {
    await execute("UPDATE conversations SET pinned = ? WHERE id = ?", [pinned ? 1 : 0, id])
  },
  async setProject(id: string, projectId: string | null): Promise<void> {
    await execute("UPDATE conversations SET project_id = ?, updated_at = datetime('now') WHERE id = ?", [projectId, id])
  },
  async touch(id: string): Promise<void> {
    await execute("UPDATE conversations SET updated_at = datetime('now') WHERE id = ?", [id])
  },
  async remove(id: string): Promise<void> {
    await execute("DELETE FROM conversations WHERE id = ?", [id])
  },
}
