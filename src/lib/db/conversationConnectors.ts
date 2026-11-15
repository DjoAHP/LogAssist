import { execute, select } from "./database"

export interface ConversationConnectorBinding {
  connectorId: string
  resourceOwner: string
  resourceName: string
  resourceRef: string | null
  createdAt: string
}

interface ConversationConnectorRow {
  connector_id: string
  resource_owner: string
  resource_name: string
  resource_ref: string | null
  created_at: string
}

const OWNER_RE = /^[A-Za-z0-9][A-Za-z0-9-]{0,38}$/
const NAME_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/
const CONTROL_CHAR_RE = /[\u0000-\u001F\u007F]/

function mapRow(row: ConversationConnectorRow): ConversationConnectorBinding {
  return {
    connectorId: row.connector_id,
    resourceOwner: row.resource_owner,
    resourceName: row.resource_name,
    resourceRef: row.resource_ref,
    createdAt: row.created_at,
  }
}

function validateBinding(binding: {
  resourceOwner: string
  resourceName: string
  resourceRef: string | null
}): void {
  if (!OWNER_RE.test(binding.resourceOwner)) {
    throw new Error("owner GitHub invalide")
  }
  if (!NAME_RE.test(binding.resourceName) || binding.resourceName.includes("..")) {
    throw new Error("nom de dépôt GitHub invalide")
  }
  if (
    binding.resourceRef !== null
    && (
      binding.resourceRef.length === 0
      || binding.resourceRef.length > 255
      || binding.resourceRef.includes("..")
      || binding.resourceRef.startsWith("/")
      || binding.resourceRef.endsWith("/")
      || CONTROL_CHAR_RE.test(binding.resourceRef)
    )
  ) {
    throw new Error("ref GitHub invalide")
  }
}

export const conversationConnectors = {
  // Récupère la liaison pour une conversation + connecteur (ou null)
  async get(
    conversationId: string,
    connectorId: string
  ): Promise<ConversationConnectorBinding | null> {
    const rows = await select<ConversationConnectorRow>(
      `SELECT connector_id, resource_owner, resource_name, resource_ref, created_at
       FROM conversation_connectors
       WHERE conversation_id = ? AND connector_id = ?`,
      [conversationId, connectorId],
    )
    return rows[0] ? mapRow(rows[0]) : null
  },

  // Crée ou remplace la liaison (upsert via INSERT OR REPLACE)
  async set(
    conversationId: string,
    connectorId: string,
    binding: { resourceOwner: string; resourceName: string; resourceRef: string | null }
  ): Promise<void> {
    validateBinding(binding)
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
    const rows = await select<ConversationConnectorRow>(
      `SELECT connector_id, resource_owner, resource_name, resource_ref, created_at
       FROM conversation_connectors
       WHERE conversation_id = ?`,
      [conversationId],
    )
    return rows.map(mapRow)
  },
}
