import type { IProvider } from "@/lib/ai/openai-compat"
import type { ChatRequest, TokenUsage, TurnCallbacks } from "@/lib/ai/types"
import type {
  ContextAdditionalMessage,
  ContextSession,
  ContextStats,
  PreparedChatRequest,
} from "@/lib/context"
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
  request: ChatRequest
  context?: ContextSession
  apiKey: string
  modelId: string
  callbacks: TurnCallbacks
  signal: AbortSignal
}

type RunAssistantTurnInput = BaseTurnInput & (
  | { tools?: undefined; runTools?: undefined }
  | { tools: ToolTurnOptions; runTools?: (input: ToolAgentInput) => Promise<ToolAgentResult> }
)

function passthroughMessage(entry: ContextAdditionalMessage) {
  if (entry.kind === "message") return entry.message
  return {
    role: "tool" as const,
    toolCallId: entry.toolCallId,
    content: [entry.prefix, ...entry.segments, entry.suffix].filter(Boolean).join("\n\n"),
  }
}

function createPassthroughContext(request: ChatRequest): ContextSession {
  const emptyStats = {
    categories: {
      system: 0,
      knowledge: 0,
      history: 0,
      currentUser: 0,
      images: 0,
      tools: 0,
      mcpResults: 0,
      outputReserve: 0,
      safetyMargin: 0,
    },
    inputTokens: 0,
    totalWithReserve: 0,
    selectedKnowledge: [],
    historyMessages: 0,
    historyTurns: 0,
    omitted: {
      knowledgeChunks: 0,
      historyTurns: 0,
      mcpSegments: 0,
      reasons: [],
    },
  } satisfies ContextStats

  return {
    prepareRound: ({ additionalMessages }) => ({
      request: {
        ...request,
        messages: [...request.messages, ...additionalMessages.map(passthroughMessage)],
      } as PreparedChatRequest,
      stats: emptyStats,
    }),
    estimateOutput: () => 0,
    dispose: () => {},
  }
}

export async function runAssistantTurn(
  input: RunAssistantTurnInput,
): Promise<AssistantTurnResult> {
  if (input.tools) {
    const context = input.context ?? createPassthroughContext(input.request)
    return (input.runTools ?? runToolAgent)({
      ...input.tools,
      provider: input.provider,
      context,
      apiKey: input.apiKey,
      modelId: input.modelId,
      callbacks: input.callbacks,
      signal: input.signal,
    })
  }

  const prepared = input.context?.prepareRound({ additionalMessages: [], tools: [] })
  const result = await input.provider.runTurn(
    prepared?.request ?? input.request,
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
    ...(prepared && input.context
      ? {
          estimatedUsage: {
            inputTokens: prepared.stats.inputTokens,
            outputTokens: input.context.estimateOutput(result.text),
          },
        }
      : {}),
  }
}
