import { connectorGithub } from "./client"
import type { GithubConnectorToolContext } from "./tools"
import type {
  McpToolClient,
  ToolAgentLimits,
} from "@/lib/mcp/toolAgent"

export interface CompositeToolClientInput {
  github: GithubConnectorToolContext
  mcpClient: McpToolClient
}

export function createCompositeToolClient(
  input: CompositeToolClientInput,
): McpToolClient {
  return {
    async call(serverId, turnId, _callId, nativeName, arguments_) {
      if (serverId !== "connector_github") {
        return input.mcpClient.call(serverId, turnId, _callId, nativeName, arguments_)
      }
      if (!input.github.binding || !input.github.configured) {
        throw new Error("La liaison GitHub n’est plus disponible.")
      }
      const result = await connectorGithub.callTool(
        input.github.binding,
        nativeName,
        arguments_,
        turnId,
      )
      return {
        content: result.truncated
          ? `${result.text}\n\n[Résultat GitHub tronqué par les limites de sécurité.]`
          : result.text,
        media: [],
        resourceLinks: [],
        sources: [],
        isError: false,
      }
    },
  }
}

export function connectorToolLimits(
  github: GithubConnectorToolContext,
): ToolAgentLimits | undefined {
  return github.binding && github.configured
    ? { toolRounds: 6, mcpCalls: 12 }
    : undefined
}

export async function cancelConnectorTurn(
  github: GithubConnectorToolContext,
  turnId: string,
): Promise<void> {
  if (!github.binding || !github.configured) return
  await connectorGithub.cancelTurn(turnId)
}
