import type { GithubBinding } from "./client"
import type { McpAgentTool } from "@/lib/mcp/types"

export interface GithubConnectorToolContext {
  binding: GithubBinding | null
  configured: boolean
}

const COMMON_TOOL_FIELDS = {
  serverId: "connector_github",
  serverName: "GitHub",
  approvalMode: "auto" as const,
  kind: "connector" as const,
}

export function buildConnectorTools(
  context: GithubConnectorToolContext,
): McpAgentTool[] {
  if (!context.binding || !context.configured) return []

  return [
    {
      ...COMMON_TOOL_FIELDS,
      nativeName: "repo_map",
      llmName: "connector_github__repo_map",
      title: "Cartographie du dépôt GitHub",
      description: "Liste l’arborescence bornée du dépôt attaché, éventuellement sous un chemin et à une profondeur donnée.",
      inputSchema: {
        type: "object",
        additionalProperties: false,
        properties: {
          path: { type: "string", maxLength: 512 },
          depth: { type: "integer", minimum: 1, maximum: 20 },
        },
      },
    },
    {
      ...COMMON_TOOL_FIELDS,
      nativeName: "read_file",
      llmName: "connector_github__read_file",
      title: "Lecture d’un fichier GitHub",
      description: "Lit une plage de lignes d’un fichier texte autorisé dans le dépôt attaché.",
      inputSchema: {
        type: "object",
        additionalProperties: false,
        required: ["path"],
        properties: {
          path: { type: "string", minLength: 1, maxLength: 512 },
          start_line: { type: "integer", minimum: 1, maximum: 1_000_000 },
          end_line: { type: "integer", minimum: 1, maximum: 1_000_000 },
        },
      },
    },
    {
      ...COMMON_TOOL_FIELDS,
      nativeName: "search_code",
      llmName: "connector_github__search_code",
      title: "Recherche dans le code GitHub",
      description: "Recherche un symbole ou une expression dans le dépôt attaché via GitHub Code Search.",
      inputSchema: {
        type: "object",
        additionalProperties: false,
        required: ["query"],
        properties: {
          query: { type: "string", minLength: 1, maxLength: 256 },
        },
      },
    },
  ]
}
