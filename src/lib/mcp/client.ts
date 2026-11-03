import { invoke } from "@tauri-apps/api/core"

import type {
  McpErrorKind,
  McpServerId,
  WebToolRequest,
  WebToolResult,
} from "@/lib/mcp/types"

const ERROR_KINDS = new Set<McpErrorKind>([
  "not_configured",
  "auth",
  "rate_limit",
  "timeout",
  "network",
  "tool_denied",
  "invalid_response",
  "unknown",
])

export class McpClientError extends Error {
  readonly kind: McpErrorKind

  constructor(kind: McpErrorKind, message: string) {
    super(message)
    this.name = "McpClientError"
    this.kind = kind
  }
}

function normalizeError(cause: unknown): McpClientError {
  if (typeof cause === "object" && cause !== null) {
    const candidate = cause as { kind?: unknown; message?: unknown }
    if (
      typeof candidate.kind === "string" &&
      ERROR_KINDS.has(candidate.kind as McpErrorKind) &&
      typeof candidate.message === "string"
    ) {
      return new McpClientError(candidate.kind as McpErrorKind, candidate.message)
    }
  }
  return new McpClientError("unknown", "Erreur MCP inconnue")
}

async function invokeMcp<T>(command: string, args: Record<string, unknown>): Promise<T> {
  try {
    return await invoke<T>(command, args)
  } catch (cause) {
    throw normalizeError(cause)
  }
}

export const mcp = {
  hasSecret: (serverId: McpServerId): Promise<boolean> =>
    invokeMcp("mcp_has_secret", { serverId }),
  configure: (serverId: McpServerId, apiKey: string): Promise<void> =>
    invokeMcp("mcp_configure", { serverId, apiKey }),
  removeSecret: (serverId: McpServerId): Promise<void> =>
    invokeMcp("mcp_delete_secret", { serverId }),
  call: (
    serverId: McpServerId,
    requestId: string,
    request: WebToolRequest,
  ): Promise<WebToolResult> => invokeMcp("mcp_call", { serverId, requestId, request }),
  cancel: (requestId: string): Promise<void> => invokeMcp("mcp_cancel", { requestId }),
}

const TINYFISH_SERVER_ID: McpServerId = "tinyfish"

export const tinyfish = {
  hasSecret: (): Promise<boolean> => mcp.hasSecret(TINYFISH_SERVER_ID),
  configure: (apiKey: string): Promise<void> => mcp.configure(TINYFISH_SERVER_ID, apiKey),
  removeSecret: (): Promise<void> => mcp.removeSecret(TINYFISH_SERVER_ID),
  call: (requestId: string, request: WebToolRequest): Promise<WebToolResult> =>
    mcp.call(TINYFISH_SERVER_ID, requestId, request),
  cancel: (requestId: string): Promise<void> => mcp.cancel(requestId),
}
