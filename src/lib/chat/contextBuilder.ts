import type { ChatMessage } from "@/lib/ai/types"

type ChatImage = NonNullable<ChatMessage["images"]>[number]

interface HistoryMessage {
  readonly role: "user" | "assistant"
  readonly content: string
}

interface BuildChatMessagesInput {
  readonly system: string
  readonly history: readonly HistoryMessage[]
  readonly currentImages: readonly ChatImage[]
}

export function buildChatMessages(input: BuildChatMessagesInput): ChatMessage[] {
  const messages: ChatMessage[] = [
    ...(input.system.trim()
      ? [{ role: "system" as const, content: input.system }]
      : []),
    ...input.history.map(({ role, content }) => ({ role, content })),
  ]
  if (input.currentImages.length === 0) return messages

  for (let index = messages.length - 1; index >= 0; index--) {
    const message = messages[index]
    if (message.role !== "user") continue
    messages[index] = {
      ...message,
      images: input.currentImages.map((image) => ({ ...image })),
    }
    break
  }
  return messages
}
