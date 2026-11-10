import { execute, select } from "./database"

export interface MessageMediaRow {
  id: string
  message_id: string
  kind: "image" | "audio"
  mime_type: string
  tool_label: string
  base64: string
  created_at: string
}

export interface MessageMediaInsert {
  id: string
  message_id: string
  kind: MessageMediaRow["kind"]
  mime_type: string
  tool_label: string
  base64: string
}

// SQL 100 % paramétré : les placeholders IN (?,…) sont générés depuis le
// NOMBRE d'ids (jamais depuis leur contenu) — les valeurs restent bindées.
export const messageMedia = {
  async insertRows(rows: MessageMediaInsert[]): Promise<void> {
    for (const row of rows) {
      await execute(
        "INSERT INTO message_media (id, message_id, kind, mime_type, tool_label, base64, created_at) VALUES (?,?,?,?,?,?,datetime('now'))",
        [row.id, row.message_id, row.kind, row.mime_type, row.tool_label, row.base64],
      )
    }
  },
  async listByMessageIds(messageIds: string[]): Promise<MessageMediaRow[]> {
    if (messageIds.length === 0) return []
    const placeholders = messageIds.map(() => "?").join(",")
    return select<MessageMediaRow>(
      `SELECT id, message_id, kind, mime_type, tool_label, base64, created_at FROM message_media WHERE message_id IN (${placeholders})`,
      messageIds,
    )
  },
  // Hydratation des refs messages.media : les refs sont des IDS de médias
  // (colonne id), jamais des message_id — requête distincte pour éviter toute
  // confusion sémantique.
  async listByIds(mediaIds: string[]): Promise<MessageMediaRow[]> {
    if (mediaIds.length === 0) return []
    const placeholders = mediaIds.map(() => "?").join(",")
    return select<MessageMediaRow>(
      `SELECT id, message_id, kind, mime_type, tool_label, base64, created_at FROM message_media WHERE id IN (${placeholders})`,
      mediaIds,
    )
  },
  async removeByMessageIds(messageIds: string[]): Promise<void> {
    if (messageIds.length === 0) return
    const placeholders = messageIds.map(() => "?").join(",")
    await execute(`DELETE FROM message_media WHERE message_id IN (${placeholders})`, messageIds)
  },
}
