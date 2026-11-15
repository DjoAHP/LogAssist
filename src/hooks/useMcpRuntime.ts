import { useCallback, useEffect, useRef, useState } from "react"
import { logger } from "@/lib/logger"
import {
  EMPTY_CONNECTOR_RUNTIME,
  EMPTY_MCP_RUNTIME,
  loadMcpRuntime,
  type ConnectorRuntimeContext,
  type McpRuntimeSnapshot,
} from "@/lib/mcp/runtime"

function sameConnectorContext(
  left: ConnectorRuntimeContext,
  right: ConnectorRuntimeContext,
): boolean {
  const leftBinding = left.github.binding
  const rightBinding = right.github.binding
  return left.github.configured === right.github.configured
    && leftBinding?.owner === rightBinding?.owner
    && leftBinding?.name === rightBinding?.name
    && leftBinding?.ref === rightBinding?.ref
}

export function useMcpRuntime(
  connectors: ConnectorRuntimeContext = EMPTY_CONNECTOR_RUNTIME,
) {
  const [snapshot, setSnapshot] = useState<McpRuntimeSnapshot>({
    ...EMPTY_MCP_RUNTIME,
    connectors,
  })
  const [ready, setReady] = useState(false)
  const sequence = useRef(0)

  const refresh = useCallback(async () => {
    const current = ++sequence.current
    try {
      const next = await loadMcpRuntime(connectors)
      if (current === sequence.current) {
        setSnapshot(next)
      }
    } catch (error) {
      logger.error({
        context: "mcp.runtime",
        message: error instanceof Error ? error.message : "Erreur MCP",
      })
      if (current === sequence.current) {
        setSnapshot({ ...EMPTY_MCP_RUNTIME, connectors })
      }
    } finally {
      if (current === sequence.current) {
        setReady(true)
      }
    }
  }, [connectors])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const current = sameConnectorContext(snapshot.connectors, connectors)
  const visibleSnapshot = current
    ? snapshot
    : {
        ...snapshot,
        activeTools: snapshot.activeTools.filter((tool) => tool.kind !== "connector"),
        connectors,
      }

  return { snapshot: visibleSnapshot, ready: ready && current, refresh }
}
