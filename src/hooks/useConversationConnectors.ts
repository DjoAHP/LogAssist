// Hook pour gérer les liaisons connecteur ↔ conversation.
// Une seule liaison par (conversation, connecteur).
import { useCallback, useEffect, useState } from "react"
import { conversationConnectors, type ConversationConnectorBinding } from "@/lib/db/conversationConnectors"

export function useConversationConnectors(conversationId: string | null) {
  const [bindings, setBindings] = useState<Record<string, ConversationConnectorBinding>>({})
  const [loading, setLoading] = useState(false)

  const load = useCallback(async () => {
    if (!conversationId) {
      setBindings({})
      return
    }
    setLoading(true)
    try {
      const list = await conversationConnectors.listAll(conversationId)
      const map: Record<string, ConversationConnectorBinding> = {}
      for (const b of list) {
        map[b.connectorId] = b
      }
      setBindings(map)
    } finally {
      setLoading(false)
    }
  }, [conversationId])

  useEffect(() => {
    load()
  }, [load])

  const attach = useCallback(
    async (connectorId: string, binding: { resourceOwner: string; resourceName: string; resourceRef: string | null }) => {
      if (!conversationId) return
      await conversationConnectors.set(conversationId, connectorId, binding)
      await load()
    },
    [conversationId, load],
  )

  const detach = useCallback(
    async (connectorId: string) => {
      if (!conversationId) return
      await conversationConnectors.remove(conversationId, connectorId)
      await load()
    },
    [conversationId, load],
  )

  const getBinding = useCallback(
    (connectorId: string): ConversationConnectorBinding | undefined => {
      return bindings[connectorId]
    },
    [bindings],
  )

  return { bindings, loading, load, attach, detach, getBinding }
}