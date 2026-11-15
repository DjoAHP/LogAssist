// Hook pour gérer les liaisons connecteur ↔ conversation.
// Une seule liaison par (conversation, connecteur).
import { useCallback, useEffect, useRef, useState } from "react"
import { conversationConnectors, type ConversationConnectorBinding } from "@/lib/db/conversationConnectors"

export function useConversationConnectors(conversationId: string | null) {
  const [state, setState] = useState<{
    conversationId: string | null
    bindings: Record<string, ConversationConnectorBinding>
  }>({ conversationId: null, bindings: {} })
  const [loading, setLoading] = useState(false)
  const requestSequence = useRef(0)
  const bindings = state.conversationId === conversationId ? state.bindings : {}

  const load = useCallback(async () => {
    const sequence = ++requestSequence.current
    if (!conversationId) {
      setState({ conversationId: null, bindings: {} })
      setLoading(false)
      return
    }
    setLoading(true)
    try {
      const list = await conversationConnectors.listAll(conversationId)
      const map: Record<string, ConversationConnectorBinding> = {}
      for (const b of list) {
        map[b.connectorId] = b
      }
      if (sequence === requestSequence.current) {
        setState({ conversationId, bindings: map })
      }
    } finally {
      if (sequence === requestSequence.current) setLoading(false)
    }
  }, [conversationId])

  useEffect(() => {
    void load()
    return () => {
      requestSequence.current += 1
    }
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
