import { select } from "@/lib/db/database"

export async function conversationToMarkdown(conversationId: string): Promise<string> {
  const rows = await select<{ role: string; content: string }>(
    `SELECT role, content FROM messages WHERE conversation_id = ? ORDER BY created_at ASC`,
    [conversationId],
  )
  if (rows.length === 0) return ""
  const lines = rows
    .filter((r) => r.role !== "system")
    .map((r) => `${r.role}: ${r.content}`)
  return lines.join("\n\n")
}

export async function exportConversation(conversationId: string): Promise<string> {
  return conversationToMarkdown(conversationId)
}