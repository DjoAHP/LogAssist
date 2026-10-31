import { execute, select } from "./database"

export const conversationKnowledge = {
  // Liste des knowledge_id actifs pour une conversation (overrides)
  async listOn(conversationId: string): Promise<string[]> {
    const rows = await select<{ knowledge_id: string }>(
      "SELECT knowledge_id FROM conversation_knowledge WHERE conversation_id = ?",
      [conversationId],
    )
    return rows.map((r) => r.knowledge_id)
  },

  // Remplace entièrement la liste (transaction implicite via execute multiples)
  async setOn(conversationId: string, knowledgeIds: string[]): Promise<void> {
    await execute("DELETE FROM conversation_knowledge WHERE conversation_id = ?", [conversationId])
    if (knowledgeIds.length > 0) {
      const placeholders = knowledgeIds.map(() => "(?,?)").join(",")
      const binds = knowledgeIds.flatMap((kid) => [conversationId, kid])
      await execute(
        `INSERT INTO conversation_knowledge (conversation_id, knowledge_id) VALUES ${placeholders}`,
        binds,
      )
    }
  },
}