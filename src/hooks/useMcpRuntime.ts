import { useCallback, useEffect, useRef, useState } from "react"
import { logger } from "@/lib/logger"
import { EMPTY_MCP_RUNTIME, loadMcpRuntime, type McpRuntimeSnapshot } from "@/lib/mcp/runtime"

export function useMcpRuntime() {
  const [snapshot, setSnapshot] = useState<McpRuntimeSnapshot>(EMPTY_MCP_RUNTIME)
  const [ready, setReady] = useState(false)
  const sequence = useRef(0)

  const refresh = useCallback(async () => {
    const current = ++sequence.current
    try {
      const next = await loadMcpRuntime()
      if (current === sequence.current) {
        setSnapshot(next)
      }
    } catch (error) {
      logger.error({
        context: "mcp.runtime",
        message: error instanceof Error ? error.message : "Erreur MCP",
      })
      if (current === sequence.current) {
        setSnapshot(EMPTY_MCP_RUNTIME)
      }
    } finally {
      if (current === sequence.current) {
        setReady(true)
      }
    }
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  return { snapshot, ready, refresh }
}