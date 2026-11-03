import { settings } from "@/lib/db/settings"
import { tinyfish } from "@/lib/mcp/client"
import type { WebAccessConfig } from "@/lib/mcp/types"

const WEB_ENABLED_KEY = "web.enabled"

export async function loadWebAccess(): Promise<WebAccessConfig> {
  const [storedEnabled, configured] = await Promise.all([
    settings.get(WEB_ENABLED_KEY),
    tinyfish.hasSecret(),
  ])

  return {
    enabled: configured && storedEnabled === "true",
    configured,
  }
}

export async function setWebEnabled(enabled: boolean): Promise<void> {
  await settings.set(WEB_ENABLED_KEY, String(enabled))
}
