import type { IProvider } from "@/lib/ai/openai-compat"
import type { ChatMessage, ProviderConfig } from "@/lib/ai/types"
import {
  createContextSession,
  createTokenEstimator,
  getVerifiedContextWindow,
  resolveModelContextProfile,
  type ContextHistoryMessage,
  type ContextSession,
  type ContextTokenEstimator,
} from "@/lib/context"
import type { KnowledgeRow } from "@/lib/db/knowledge"
import { logger } from "@/lib/logger"
import { buildSystemPrompt } from "@/lib/prompts/compose"
import { loadPromptSettings, type PromptSettings } from "@/lib/prompts/store"
import { loadEligibleKnowledge } from "./knowledgeSelection"

export interface PrepareConversationContextInput {
  conversationId: string
  history: readonly ContextHistoryMessage[]
  currentImages: NonNullable<ChatMessage["images"]>
  provider: ProviderConfig
  providerAdapter: IProvider
  apiKey: string
  modelId: string
  contextWindowOverride: number | null
  maxOutputTokensOverride: number | null
  webEnabled: boolean
}

export interface PrepareConversationContextDeps {
  loadPromptSettings(): Promise<PromptSettings>
  loadKnowledge(conversationId: string): Promise<KnowledgeRow[]>
  resolveProfile: typeof resolveModelContextProfile
  createEstimator(input: { baseUrl: string; modelId: string }): ContextTokenEstimator
  createSession: typeof createContextSession
}

const defaultDeps: PrepareConversationContextDeps = {
  loadPromptSettings,
  loadKnowledge: loadEligibleKnowledge,
  resolveProfile: resolveModelContextProfile,
  createEstimator: createTokenEstimator,
  createSession: createContextSession,
}

function truncateCodePoints(value: string, maximum: number): string {
  return Array.from(value).slice(0, maximum).join("")
}

function retrievalQuery(
  current: ContextHistoryMessage,
  history: readonly ContextHistoryMessage[],
): string {
  const previousUsers = history
    .filter((message) => message.role === "user")
    .slice(-2)
    .reverse()
    .map((message) => truncateCodePoints(message.content, 2_000))
  return [truncateCodePoints(current.content, 4_000), ...previousUsers]
    .filter((content) => content.trim().length > 0)
    .join("\n\n")
}

export async function prepareConversationContext(
  input: PrepareConversationContextInput,
  deps: PrepareConversationContextDeps = defaultDeps,
): Promise<ContextSession> {
  const current = input.history[input.history.length - 1]
  if (!current || current.role !== "user") {
    throw new Error("Le dernier message du contexte doit être un message utilisateur.")
  }
  const priorHistory = input.history.slice(0, -1)
  const [promptSettings, knowledge] = await Promise.all([
    deps.loadPromptSettings(),
    deps.loadKnowledge(input.conversationId),
  ])
  const profile = await deps.resolveProfile({
    cacheKey: `${input.provider.id}/${input.modelId}`,
    contextWindowOverride: input.contextWindowOverride,
    maxOutputTokensOverride: input.maxOutputTokensOverride,
    registryContextWindow: getVerifiedContextWindow(input.provider.baseUrl, input.modelId),
    inspect: () => input.providerAdapter.inspectModelContext(input.apiKey, input.modelId),
  })
  const estimator = deps.createEstimator({
    baseUrl: input.provider.baseUrl,
    modelId: input.modelId,
  })

  try {
    return deps.createSession({
      modelId: input.modelId,
      profile: { ...profile, tokenizer: estimator.kind },
      estimator,
      baseSystem: buildSystemPrompt({
        general: promptSettings.general,
        profile: promptSettings.profile,
        webEnabled: input.webEnabled,
      }),
      documents: knowledge.map((row) => ({
        id: row.id,
        name: row.name,
        content: row.content,
        sortOrder: row.sort_order,
      })),
      history: priorHistory.map((message) => ({ ...message })),
      currentUser: {
        content: current.content,
        images: input.currentImages.map((image) => ({ ...image })),
      },
      retrievalQuery: retrievalQuery(current, priorHistory),
      onDiagnostic: (diagnostic) => logger.debug({ context: "context.plan", ...diagnostic }),
    })
  } catch (error) {
    estimator.dispose()
    throw error
  }
}
