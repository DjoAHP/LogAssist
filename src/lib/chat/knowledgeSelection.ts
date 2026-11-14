import { knowledge, type KnowledgeRow } from "@/lib/db/knowledge"
import { conversationKnowledge } from "@/lib/db/conversationKnowledge"

export interface KnowledgeSelectionDeps {
  listOverrideIds(conversationId: string): Promise<string[]>
  listAll(): Promise<KnowledgeRow[]>
  listEnabled(): Promise<KnowledgeRow[]>
}

const defaultDeps: KnowledgeSelectionDeps = {
  listOverrideIds: (conversationId) => conversationKnowledge.listOn(conversationId),
  listAll: () => knowledge.list(),
  listEnabled: () => knowledge.listEnabled(),
}

export async function loadEligibleKnowledge(
  conversationId: string,
  deps: KnowledgeSelectionDeps = defaultDeps,
): Promise<KnowledgeRow[]> {
  const overrideIds = await deps.listOverrideIds(conversationId)
  if (overrideIds.length === 0) return deps.listEnabled()
  const rows = await deps.listAll()
  const byId = new Map(rows.map((row) => [row.id, row]))
  return overrideIds
    .map((id) => byId.get(id))
    .filter((row): row is KnowledgeRow => row !== undefined && row.enabled === 1)
}
