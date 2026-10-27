import { useCallback, useEffect, useState } from "react"
import { conversations, type ConversationRow } from "@/lib/db/conversations"

export function useConversations() {
  const [list, setList] = useState<ConversationRow[]>([])
  const refresh = useCallback(async () => setList(await conversations.list()), [])
  useEffect(() => {
    void refresh()
  }, [refresh])
  return { list, refresh }
}
