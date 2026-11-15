import { execute, select } from "./database"

export interface ConversationConnectorBinding {
  connectorId: string
  resourceOwner: string
  resourceName: string
  resourceRef: string | null
  createdAt: string
}

export const conversationConnectors = {
  // Récupère la liaison pour une conversation + connecteur (ou null)
  async get(
    conversationId: string,
    connectorId: string
  ): Promise<ConversationConnectorBinding | null> {
    const rows = await select<ConversationConnectorBinding>(
      `SELECT connector_id, resource_owner, resource_name, resource_ref, created_at
       FROM conversation_connectors
       WHERE conversation_id = ? AND connector_id = ?`,
      [conversationId, connectorId],
    )
    return rows[0] ?? null
  },

  // Crée ou remplace la liaison (upsert via INSERT OR REPLACE)
  async set(
    conversationId: string,
    connectorId: string,
    binding: { resourceOwner: string; resourceName: string; resourceRef: string | null }
  ): Promise<void> {
    await execute(
      `INSERT OR REPLACE INTO conversation_connectors
       (conversation_id, connector_id, resource_owner, resource_name, resource_ref, created_at)
       VALUES (?, ?, ?, ?, ?, datetime('now'))`,
      [conversationId, connectorId, binding.resourceOwner, binding.resourceName, binding.resourceRef],
    )
  },

  // Supprime la liaison
  async remove(conversationId: string, connectorId: string): Promise<void> {
    await execute(
      "DELETE FROM conversation_connectors WHERE conversation_id = ? AND connector_id = ?",
      [conversationId, connectorId],
    )
  },

  // Liste toutes les liaisons d'une conversation
  async listAll(conversationId: string): Promise<ConversationConnectorBinding[]> {
    return select<ConversationConnectorBinding>(
      `SELECT connector_id, resource_owner, resource_name, resource_ref, created_at
       FROM conversation_connectors
       WHERE conversation_id = ?`,
      [conversationId],
    )
  },
}