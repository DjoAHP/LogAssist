import { mcpServers } from "@/lib/db/mcpServers"
import { loadMcpRuntime } from "@/lib/mcp/runtime"
import type { WebAccessConfig } from "@/lib/mcp/types"

export async function loadWebAccess(): Promise<WebAccessConfig> {
  const runtime = await loadMcpRuntime()
  return runtime.webAccess
}

export async function setWebEnabled(enabled: boolean): Promise<void> {
  await mcpServers.setEnabled("tinyfish", enabled)
}