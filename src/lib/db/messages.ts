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
  sources: string
}

type MessageInsert = Omit<MessageRow, "id" | "sources"> & { sources?: string }

export const messages = {
  // rowid = ordre d'insertion physique : garantie l'ordre chronologique sans colonne dédiée.
  async listByConversation(conversationId: string): Promise<MessageRow[]> {
    const rows = await select<MessageRow>(
      "SELECT * FROM messages WHERE conversation_id = ? ORDER BY rowid ASC",
      [conversationId],
    )
    return rows.map((row) => ({ ...row, sources: row.sources ?? "[]" }))
  },
  async insert(row: MessageInsert): Promise<string> {
    const id = crypto.randomUUID()
    await execute(
      "INSERT INTO messages (id, conversation_id, role, content, attachments, model_label, latency_ms, error, sources) VALUES (?,?,?,?,?,?,?,?,?)",
      [
        id,
        row.conversation_id,
        row.role,
        row.content,
        row.attachments,
        row.model_label,
        row.latency_ms,
        row.error,
        row.sources ?? "[]",
      ],
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
