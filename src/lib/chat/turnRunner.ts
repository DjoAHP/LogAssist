import type { IProvider } from "@/lib/ai/openai-compat"
import type { ChatRequest, TokenUsage, TurnCallbacks } from "@/lib/ai/types"
import { runWebAgent, type WebAgentInput, type WebAgentResult } from "@/lib/mcp/webAgent"
import { runToolAgent, type ToolAgentInput, type ToolAgentResult } from "@/lib/mcp/toolAgent"
import type { WebSource } from "@/lib/mcp/types"

export interface AssistantTurnResult {
  text: string
  firstTokenMs: number
  totalMs: number
  sources: WebSource[]
  warning?: string
  usage?: TokenUsage
}

type ToolTurnOptions = Omit<
  ToolAgentInput,
  "provider" | "request" | "apiKey" | "modelId" | "callbacks" | "signal"
>

type WebTurnOptions = Omit<
  WebAgentInput,
  "provider" | "request" | "apiKey" | "modelId" | "callbacks" | "signal"
>

interface BaseTurnInput {
  provider: IProvider
  request: ChatRequest
  apiKey: string
  modelId: string
  callbacks: TurnCallbacks
  signal: AbortSignal
}

type RunAssistantTurnInput = BaseTurnInput & {
  tools?: ToolTurnOptions
  runTools?: (input: ToolAgentInput) => Promise<ToolAgentResult>
  web?: WebTurnOptions
  runWeb?: (input: WebAgentInput) => Promise<WebAgentResult>
}

export async function runAssistantTurn(
  input: RunAssistantTurnInput,
): Promise<AssistantTurnResult> {
  if (input.tools) {
    return (input.runTools ?? runToolAgent)({
      ...input.tools,
      provider: input.provider,
      request: input.request,
      apiKey: input.apiKey,
      modelId: input.modelId,
      callbacks: input.callbacks,
      signal: input.signal,
    })
  }
  if (input.web) {
    const webInput: WebAgentInput = {
      ...input.web,
      provider: input.provider,
      request: input.request,
      apiKey: input.apiKey,
      modelId: input.modelId,
      callbacks: input.callbacks,
      signal: input.signal,
    }
    return (input.runWeb ?? runWebAgent)(webInput)
  }

  const result = await input.provider.runTurn(
    input.request,
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
    ...(result.usage ? { usage: result.usage } : {}),
  }
}