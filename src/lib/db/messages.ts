import { execute, select } from "./database"

export interface MessageRow {
  id: string
  conversation_id: string
  role: "user" | "assistant"
  content: string
  attachments: string
  model_label: string | null
  latency_ms: number | null
  error: string | null
}

export const messages = {
  // rowid = ordre d'insertion physique : garantie l'ordre chronologique sans colonne dédiée.
  async listByConversation(conversationId: string): Promise<MessageRow[]> {
    return select<MessageRow>(
      "SELECT * FROM messages WHERE conversation_id = ? ORDER BY rowid ASC",
      [conversationId],
    )
  },
  async insert(row: Omit<MessageRow, "id">): Promise<string> {
    const id = crypto.randomUUID()
    await execute(
      "INSERT INTO messages (id, conversation_id, role, content, attachments, model_label, latency_ms, error) VALUES (?,?,?,?,?,?,?,?)",
      [id, row.conversation_id, row.role, row.content, row.attachments, row.model_label, row.latency_ms, row.error],
    )
    return id
  },
  async updateError(id: string, error: string | null): Promise<void> {
    await execute("UPDATE messages SET error = ? WHERE id = ?", [error, id])
  },
  async removeByConversation(conversationId: string): Promise<void> {
    await execute("DELETE FROM messages WHERE conversation_id = ?", [conversationId])
  },
}
