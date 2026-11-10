// Client IPC MCP générique : un appel = une commande Rust enregistrée dans
// src-tauri/src/commands/mcp.rs. Les erreurs Rust { kind, message } sont
// normalisées en McpClientError ; toute forme inattendue devient "unknown"
// afin que l'UI ne rende jamais un message réseau brut.
import { invoke } from "@tauri-apps/api/core"

import type {
  McpAuthStatus,
  McpDiscoveredTool,
  McpErrorKind,
  McpRuntimeServer,
  McpToolResult,
  WebToolRequest,
} from "./types"

const ERROR_KINDS = new Set<McpErrorKind>([
  "not_configured", "invalid_config", "auth", "offline", "timeout", "rate_limit",
  "tool_not_found", "tool_denied", "invalid_arguments", "protocol",
  "invalid_response", "cancelled", "unknown",
])

export class McpClientError extends Error {
  constructor(readonly kind: McpErrorKind, message: string) {
    super(message)
    this.name = "McpClientError"
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
  validateConfigs: (servers: McpRuntimeServer[]) => invokeMcp<void>("mcp_validate_configs", { servers }),
  syncRegistry: (servers: McpRuntimeServer[]) => invokeMcp<void>("mcp_sync_registry", { servers }),
  authStatus: (serverId: string) => invokeMcp<McpAuthStatus>("mcp_auth_status", { serverId }),
  configureAuth: (serverId: string, secret: string) =>
    invokeMcp<McpDiscoveredTool[]>("mcp_configure_auth", { serverId, secret }),
  connectAndListTools: (serverId: string) =>
    invokeMcp<McpDiscoveredTool[]>("mcp_connect_and_list_tools", { serverId }),
  removeSecret: (serverId: string) => invokeMcp<void>("mcp_delete_secret", { serverId }),
  callTool: (serverId: string, turnId: string, callId: string, nativeName: string, arguments_: Record<string, unknown>) =>
    invokeMcp<McpToolResult>("mcp_call_tool", {
      serverId, turnId, callId, nativeName, arguments: arguments_,
    }),
  testTool: (serverId: string, callId: string, nativeName: string, arguments_: Record<string, unknown>) =>
    invokeMcp<McpToolResult>("mcp_test_tool", { serverId, callId, nativeName, arguments: arguments_ }),
  cancelTurn: (turnId: string) => invokeMcp<void>("mcp_cancel_turn", { turnId }),
  disconnect: (serverId: string) => invokeMcp<void>("mcp_disconnect", { serverId }),
  // Contrat anti-perte : l'orchestrateur Rust est notifié de la fin du tour de
  // chat (purge des pouvoirs temporaires). Le branchement chat est Task 21/23 ;
  // exposer seul le contrat ici.
  finishTurn: (turnId: string) => invokeMcp<void>("mcp_finish_turn", { turnId }),
}

export const tinyfish = {
  hasSecret: async () => (await mcp.authStatus("tinyfish")) === "configured",
  configure: async (secret: string) => {
    await mcp.configureAuth("tinyfish", secret)
  },
  removeSecret: () => mcp.removeSecret("tinyfish"),
  call: (requestId: string, request: WebToolRequest) =>
    mcp.callTool("tinyfish", requestId, requestId, request.tool, request.arguments),
  cancel: (requestId: string) => mcp.cancelTurn(requestId),
}
