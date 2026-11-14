import type { IProvider } from "@/lib/ai/openai-compat"
import type { TokenUsage, TurnCallbacks } from "@/lib/ai/types"
import type { ContextSession } from "@/lib/context"
import { runToolAgent, type ToolAgentInput, type ToolAgentResult } from "@/lib/mcp/toolAgent"

/** Le contrat du tour assistant hérite des médias validés remontés par ToolAgent. */
export interface AssistantTurnResult extends ToolAgentResult {
  estimatedUsage?: TokenUsage
}

type ToolTurnOptions = Omit<
  ToolAgentInput,
  "provider" | "context" | "apiKey" | "modelId" | "callbacks" | "signal"
>

interface BaseTurnInput {
  provider: IProvider
  context: ContextSession
  apiKey: string
  modelId: string
  callbacks: TurnCallbacks
  signal: AbortSignal
}

type RunAssistantTurnInput = BaseTurnInput & (
  | { tools?: undefined; runTools?: undefined }
  | { tools: ToolTurnOptions; runTools?: (input: ToolAgentInput) => Promise<ToolAgentResult> }
)

export async function runAssistantTurn(
  input: RunAssistantTurnInput,
): Promise<AssistantTurnResult> {
  if (input.tools) {
    return (input.runTools ?? runToolAgent)({
      ...input.tools,
      provider: input.provider,
      context: input.context,
      apiKey: input.apiKey,
      modelId: input.modelId,
      callbacks: input.callbacks,
      signal: input.signal,
    })
  }

  const prepared = input.context.prepareRound({ additionalMessages: [], tools: [] })
  const result = await input.provider.runTurn(
    prepared.request,
    input.apiKey,
    input.modelId,
    {},
    input.callbacks,
    input.signal,
  )

  return {
    text: result.text,
    firstTokenMs: result.firstTokenMs,
    totalMs: result.totalMs,
    sources: [],
    media: [],
    ...(result.usage ? { usage: result.usage } : {}),
    estimatedUsage: {
      inputTokens: prepared.stats.inputTokens,
      outputTokens: input.context.estimateOutput(result.text),
    },
  }
}
