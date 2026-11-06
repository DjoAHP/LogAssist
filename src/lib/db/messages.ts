import type { UsageSource } from "@/lib/token/types"

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
  first_token_ms: number | null
  input_tokens: number | null
  output_tokens: number | null
  usage_source: UsageSource | null
  cost_microusd: number | null
}

type MetricColumns = Pick<
  MessageRow,
  "first_token_ms" | "input_tokens" | "output_tokens" | "usage_source" | "cost_microusd"
>

type MessageInsert = Omit<MessageRow, "id" | "sources" | keyof MetricColumns> &
  Partial<MetricColumns> & { sources?: string }

export type AssistantUpdate = Pick<
  MessageRow,
  | "content"
  | "model_label"
  | "latency_ms"
  | "error"
  | "sources"
  | "first_token_ms"
  | "input_tokens"
  | "output_tokens"
  | "usage_source"
  | "cost_microusd"
>

export const messages = {
  // rowid = ordre d'insertion physique : garantie l'ordre chronologique sans colonne dédiée.
  async listByConversation(conversationId: string): Promise<MessageRow[]> {
    const rows = await select<MessageRow>(
      "SELECT * FROM messages WHERE conversation_id = ? ORDER BY rowid ASC",
      [conversationId],
    )
    return rows.map((row) => ({
      ...row,
      sources: row.sources ?? "[]",
      first_token_ms: row.first_token_ms ?? null,
      input_tokens: row.input_tokens ?? null,
      output_tokens: row.output_tokens ?? null,
      usage_source: row.usage_source ?? null,
      cost_microusd: row.cost_microusd ?? null,
    }))
  },
  async insert(row: MessageInsert): Promise<string> {
    const id = crypto.randomUUID()
    await execute(
      "INSERT INTO messages (id, conversation_id, role, content, attachments, model_label, latency_ms, error, sources, first_token_ms, input_tokens, output_tokens, usage_source, cost_microusd) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
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
        row.first_token_ms ?? null,
        row.input_tokens ?? null,
        row.output_tokens ?? null,
        row.usage_source ?? null,
        row.cost_microusd ?? null,
      ],
    )
    return id
  },
  async updateAssistant(id: string, row: AssistantUpdate): Promise<void> {
    await execute(
      "UPDATE messages SET content = ?, model_label = ?, latency_ms = ?, error = ?, sources = ?, first_token_ms = ?, input_tokens = ?, output_tokens = ?, usage_source = ?, cost_microusd = ? WHERE id = ? AND role = 'assistant'",
      [
        row.content,
        row.model_label,
        row.latency_ms,
        row.error,
        row.sources,
        row.first_token_ms,
        row.input_tokens,
        row.output_tokens,
        row.usage_source,
        row.cost_microusd,
        id,
      ],
    )
  },
  async updateError(id: string, error: string | null): Promise<void> {
    await execute("UPDATE messages SET error = ? WHERE id = ?", [error, id])
  },
  async removeByConversation(conversationId: string): Promise<void> {
    await execute("DELETE FROM messages WHERE conversation_id = ?", [conversationId])
  },
}
