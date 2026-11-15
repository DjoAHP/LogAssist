import { useCallback, useEffect, useRef, useState } from "react"
import {
  connectorGithub,
  type GithubConnectorStatus,
} from "@/lib/connectors/client"

const EMPTY_STATUS: GithubConnectorStatus = { configured: false, login: null }

export function useGithubConnectorStatus() {
  const [status, setStatus] = useState<GithubConnectorStatus>(EMPTY_STATUS)
  const [loading, setLoading] = useState(true)
  const requestSequence = useRef(0)

  const refresh = useCallback(async (): Promise<void> => {
    const sequence = ++requestSequence.current
    setLoading(true)
    try {
      const nextStatus = await connectorGithub.status()
      if (sequence === requestSequence.current) setStatus(nextStatus)
    } catch {
      if (sequence === requestSequence.current) setStatus(EMPTY_STATUS)
    } finally {
      if (sequence === requestSequence.current) setLoading(false)
    }
  }, [])

  useEffect(() => {
    void refresh()
    return () => {
      requestSequence.current += 1
    }
  }, [refresh])

  return { status, loading, refresh }
}
