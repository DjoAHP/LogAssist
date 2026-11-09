import type { ToolChoice, ToolDefinition } from "@/lib/ai/types"
import type { McpAgentTool } from "./types"
import type { WebIntent } from "./webIntent"

export function buildToolDefinitions(tools: McpAgentTool[]): ToolDefinition[] {
  return tools.map((tool) => ({
    type: "function",
    function: {
      name: tool.llmName,
      description: `${tool.title ? `${tool.title}. ` : ""}${tool.description ?? `Outil ${tool.nativeName}`}`.slice(0, 2_000),
      parameters: tool.inputSchema,
    },
  }))
}

export function firstRoundTools(tools: McpAgentTool[], intent: WebIntent): McpAgentTool[] {
  return intent === "auto" ? tools : tools.filter((tool) => tool.kind === "tinyfish_web")
}

export function firstRoundChoice(tools: McpAgentTool[], intent: WebIntent): ToolChoice {
  if (intent === "auto" || intent === "required") return intent
  const target = tools.find((tool) => tool.serverId === "tinyfish" && tool.nativeName === intent)
  return target ? { type: "function", function: { name: target.llmName } } : "auto"
}