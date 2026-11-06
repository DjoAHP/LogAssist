import { useCallback, useEffect, useRef, useState } from "react"
import { createProvider, buildPreview } from "@/lib/ai/factory"
import { logger } from "@/lib/logger"
import {
  normalizeApiErrorKind,
  redactSensitiveDetail,
  type ApiError,
} from "@/lib/ai/errors"
import type { ApiErrorKind, ProviderConfig, ChatMessage } from "@/lib/ai/types"
import { buildSystemPrompt } from "@/lib/prompts/compose"
import { loadPromptSettings } from "@/lib/prompts/store"
import { knowledge as knowledgeDb } from "@/lib/db/knowledge"
import { conversationKnowledge } from "@/lib/db/conversationKnowledge"
import { messages as messagesDb, type MessageRow } from "@/lib/db/messages"
import { images as imagesDb } from "@/lib/db/images"
import { conversations } from "@/lib/db/conversations"
import { secrets } from "@/lib/secrets/service"
import { tinyfish } from "@/lib/mcp/client"
import { resolveWebChoice } from "@/lib/mcp/webIntent"
import type { WebAccessConfig, WebSource, WebStatus, WebToolRequest } from "@/lib/mcp/types"
import { buildChatMessages } from "@/lib/chat/contextBuilder"
import { runAssistantTurn, type AssistantTurnResult } from "@/lib/chat/turnRunner"
import {
  estimateTurnMetrics,
  metricsFromProviderUsage,
  resolvePricingProvider,
  type TurnMetrics,
} from "@/lib/token"

export interface Attachment {
  id: string
  kind: "image" | "text"
  base64: string
  mimeType: string
  name: string
  // kind "text" : contenu du fichier importé (l'image, elle, passe en base64)
  text?: string
}

// Payload d'erreur persisté en JSON dans messages.error (rond-trip : la class
// ApiError ne survit pas à JSON.stringify, on sérialise un objet plat).
export interface ApiErrorPayload {
  kind: ApiErrorKind
  message: string
  detail?: string
}

export interface ChatMessageVM {
  id?: string
  role: "user" | "assistant"
  content: string
  attachments?: Attachment[]
  modelLabel?: string
  latencyMs?: number
  firstTokenMs?: number
  inputTokens?: number
  outputTokens?: number
  usageSource?: "provider" | "estimated"
  costMicrousd?: number
  apiError?: ApiErrorPayload
  interrupted?: boolean
  sources?: WebSource[]
  webStatus?: WebStatus
  webWarning?: string
  conversationId?: string
  persistenceFailed?: boolean
}

export interface SendOptions {
  forceWeb?: boolean
}

const WEB_DISABLED: WebAccessConfig = { enabled: false, configured: false }
const PERSISTENCE_ERROR_MESSAGE = "La réponse n'a pas pu être enregistrée."

function safeErrorMessage(error: unknown, exactSecrets: readonly string[] = []): string {
  const message = typeof error === "object" && error !== null &&
      "message" in error && typeof error.message === "string"
    ? error.message
    : "Erreur inattendue"
  return redactSensitiveDetail(message, exactSecrets)
}

export function useChat(
  modelSelection: { provider: ProviderConfig; modelId: string; supportsImages: boolean } | null,
  webAccess: WebAccessConfig = WEB_DISABLED,
) {
  const [vm, setVm] = useState<ChatMessageVM[]>([])
  const [busy, setBusy] = useState(false)
  const [webToolsUnsupported, setWebToolsUnsupported] = useState(false)
  // Hoistés au niveau du hook : useRef dans une callback violerait les règles
  // des hooks. Un seul tour actif à la fois (gate busy) → un ref partagé sûr.
  const accRef = useRef("")
  const abortRef = useRef<AbortController | null>(null)
  const mcpRequestRef = useRef<string | null>(null)
  const unsupportedToolsRef = useRef(new Set<string>())
  const loadSeqRef = useRef(0)

  useEffect(() => {
    const key = modelSelection
      ? `${modelSelection.provider.id}/${modelSelection.modelId}`
      : ""
    setWebToolsUnsupported(key !== "" && unsupportedToolsRef.current.has(key))
  }, [modelSelection?.provider.id, modelSelection?.modelId])

  const load = useCallback(async (conversationId: string) => {
    // Token de séquence : une réponse de load obsolète (switch rapide entre
    // conversations, rechargements concurrents) ne doit jamais écraser la vm.
    const seq = ++loadSeqRef.current
    const rows = await messagesDb.listByConversation(conversationId)
    if (seq !== loadSeqRef.current) return
    setVm((current) => {
      const warningsById = new Map(
        current
          .filter((message) => message.id && message.webWarning)
          .map((message) => [message.id as string, message.webWarning as string]),
      )
      const persisted = rows.map((row): ChatMessageVM => ({
        ...mapRow(row),
        ...(warningsById.has(row.id) ? { webWarning: warningsById.get(row.id) } : {}),
      }))
      const persistedIds = new Set(persisted.map((message) => message.id))
      const transients = current.filter((message) =>
        message.persistenceFailed === true &&
        message.conversationId === conversationId &&
        !persistedIds.has(message.id),
      )
      return [...persisted, ...transients]
    })
  }, [])

  const send = useCallback(
    async (
      conversationId: string,
      text: string,
      attachments: Attachment[] = [],
      options: SendOptions = {},
    ): Promise<boolean> => {
      const content = text.trim()
      if (!content && attachments.length === 0) return false
      if (busy || !modelSelection) return false
      setBusy(true)
      const controller = new AbortController()
      abortRef.current = controller
      accRef.current = ""
      // Contrat anti-perte avec InputBar : false = échec AVANT persistence du
      // message utilisateur (l'input sera restauré) ; true = message
      // utilisateur persisté (toute panne ultérieure est matérialisée dans la
      // bulle assistant par persistError).
      let userPersisted = false
      // id client de la bulle optimiste (retirée si l'insert échoue)
      let localUserId: string | undefined = undefined
      // Secret limité à ce tour et utilisé uniquement pour la requête et la
      // redaction exacte. Il ne doit jamais être persisté ni journalisé.
      let activeApiKey = ""
      const redactTurnDetail = (value: string) =>
        redactSensitiveDetail(value, [activeApiKey])
      const safeTurnErrorMessage = (error: unknown) =>
        safeErrorMessage(error, [activeApiKey])

      try {
        // 1. Stocker les images en base et préparer les pièces jointes pour l'API
        const apiImages: ChatMessage["images"] = []
        const storedAttachments: Attachment[] = []
        // 1 bis. Fichiers texte : injectés DANS le contenu user (persisté et
        // envoyé au modèle) — la persistance est gratuite et l'historique
        // rejoue le contexte sans stockage base64.
        const textBlocks = attachments
          .filter((a) => a.kind === "text")
          .map((a) => `\n\n[Fichier joint : ${a.name}]\n\`\`\`\n${a.text ?? ""}\n\`\`\``)
          .join("")
        const fullContent = content + textBlocks

        for (const att of attachments) {
          if (att.kind !== "image") continue
          // Stocker en base (table images)
          await imagesDb.create(att.id, att.name)
          // Préparer pour l'API
          apiImages.push({ base64: att.base64, mimeType: att.mimeType })
          storedAttachments.push(att)
        }

        // 2. Message user : affiché immédiatement, puis persisté.
        localUserId = crypto.randomUUID()
        setVm((s) => [...s, { id: localUserId, role: "user", content: fullContent, attachments: storedAttachments }])
        await messagesDb.insert({
          conversation_id: conversationId,
          role: "user",
          content: fullContent,
          attachments: JSON.stringify(storedAttachments.map((a) => ({ id: a.id, name: a.name, mimeType: a.mimeType, kind: a.kind }))),
          model_label: null,
          latency_ms: null,
          error: null,
        })
        userPersisted = true
        await conversations.touch(conversationId).catch((error) => {
          logger.error({ kind: "conversation_touch", message: safeTurnErrorMessage(error) })
        })

        // Dès que le message user est committé, la bulle assistant et sa voie
        // d'erreur existent avant toute préparation susceptible d'échouer.
        const { provider, modelId, supportsImages } = modelSelection
        const label = buildPreview(provider.name, modelId)
        const assistantId = crypto.randomUUID()
        setVm((s) => [...s, {
          id: assistantId,
          role: "assistant",
          content: "",
          modelLabel: label,
          conversationId,
        }])

        const upsertLast = (patch: Partial<ChatMessageVM>) =>
          setVm((s) => s.map((m) => (m.id === assistantId ? { ...m, ...patch } : m)))

        const isAbort = (e: unknown) =>
          typeof e === "object" && e !== null &&
          (("name" in e && e.name === "AbortError") ||
            ("message" in e && e.message === "Request cancelled"))

        const persistDone = (
          result: AssistantTurnResult,
          metrics: TurnMetrics | null,
        ) => {
          const acc = accRef.current
          return (async (): Promise<void> => {
            const finalContent = result.text || acc
            const latencyMs = Math.round(result.totalMs)
            const firstTokenMs = metrics ? Math.round(result.firstTokenMs) : null
            const id = await messagesDb.insert({
              conversation_id: conversationId,
              role: "assistant",
              content: finalContent,
              attachments: "[]",
              model_label: label,
              latency_ms: latencyMs,
              error: null,
              sources: JSON.stringify(result.sources),
              first_token_ms: firstTokenMs,
              input_tokens: metrics?.inputTokens ?? null,
              output_tokens: metrics?.outputTokens ?? null,
              usage_source: metrics?.usageSource ?? null,
              cost_microusd: metrics?.costMicrousd ?? null,
            })
            upsertLast({
              id,
              content: finalContent,
              latencyMs,
              firstTokenMs: firstTokenMs ?? undefined,
              inputTokens: metrics?.inputTokens,
              outputTokens: metrics?.outputTokens,
              usageSource: metrics?.usageSource,
              costMicrousd: metrics?.costMicrousd ?? undefined,
              sources: result.sources,
              webWarning: result.warning,
              webStatus: undefined,
              persistenceFailed: undefined,
            })
          })()
        }

        const persistError = async (e: unknown): Promise<void> => {
          const acc = accRef.current
          try {
            if (isAbort(e)) {
              upsertLast({ content: acc, interrupted: true, webStatus: undefined })
              const id = await messagesDb.insert({
                conversation_id: conversationId, role: "assistant", content: acc,
                attachments: "[]", model_label: label, latency_ms: null,
                error: JSON.stringify({ interrupted: true }), sources: "[]",
              })
              upsertLast({
                id,
                content: acc,
                interrupted: true,
                webStatus: undefined,
                persistenceFailed: undefined,
              })
              return
            }
            const api = e as Partial<ApiError>
            const payload: ApiErrorPayload = {
              kind: normalizeApiErrorKind(api.kind),
              message: redactTurnDetail(api.message ?? "Erreur inattendue"),
              ...(api.detail ? { detail: redactTurnDetail(api.detail) } : {}),
            }
            upsertLast({ apiError: payload, interrupted: false, webStatus: undefined })
            const id = await messagesDb.insert({
              conversation_id: conversationId, role: "assistant", content: acc,
              attachments: "[]", model_label: label, latency_ms: null,
              error: JSON.stringify(payload), sources: "[]",
            })
            upsertLast({ id, content: acc, persistenceFailed: undefined })
          } catch (persistenceError) {
            const payload: ApiErrorPayload = {
              kind: "unknown",
              message: PERSISTENCE_ERROR_MESSAGE,
            }
            upsertLast({
              content: acc,
              apiError: payload,
              interrupted: false,
              webStatus: undefined,
              persistenceFailed: true,
            })
            logger.error({
              kind: "assistant_error_persistence",
              message: safeTurnErrorMessage(persistenceError),
            })
          }
        }

        const turnCallbacks = {
          onFirstToken: () => { /* réservé V1.1 (temps de première réponse) */ },
          onDelta: (d: string) => {
            accRef.current += d
            upsertLast({ content: accRef.current })
          },
        }

        try {
          // Historique APRÈS l'insert user : le message fait partie du contexte API.
          // Le prompt est reconstruit à chaque envoi pour appliquer les réglages
          // et les connaissances actifs au moment du tour.
          const [promptSettings, enabledKnowledge] = await Promise.all([
            loadPromptSettings(),
            (async () => {
              const overrideIds = await conversationKnowledge.listOn(conversationId)
              if (overrideIds.length > 0) {
                const rows = await knowledgeDb.list()
                const byId = new Map(rows.map((knowledge) => [knowledge.id, knowledge]))
                return overrideIds
                  .map((id) => byId.get(id))
                  .filter((knowledge): knowledge is typeof rows[0] =>
                    !!knowledge && knowledge.enabled === 1)
              }
              return knowledgeDb.listEnabled()
            })(),
          ])
          const system = buildSystemPrompt({
            general: promptSettings.general,
            profile: promptSettings.profile,
            knowledge: enabledKnowledge.map((knowledge) => ({
              name: knowledge.name,
              content: knowledge.content,
            })),
            webEnabled: webAccess.enabled && webAccess.configured,
          })
          const history = await messagesDb.listByConversation(conversationId)
          const apiMessages = buildChatMessages({
            system,
            history: history.map((message) => ({ role: message.role, content: message.content })),
            currentImages: apiImages,
          })
          const apiProvider = createProvider(provider)
          activeApiKey = (await secrets.get(provider.secretRef)) ?? ""

          // DEBUG: uniquement des métadonnées non sensibles (no-op en production).
          logger.debug("[useChat] Envoi à l'API:", {
            modelId,
            supportsImages,
            apiImagesLength: apiImages.length,
            lastUserMsgImages: apiMessages[apiMessages.length - 1]?.images?.length ?? 0,
            messagesCount: apiMessages.length,
          })

          const web = webAccess.enabled && webAccess.configured
            ? {
                webClient: {
                  call: async (requestId: string, request: WebToolRequest) => {
                    mcpRequestRef.current = requestId
                    try {
                      return await tinyfish.call(requestId, request)
                    } finally {
                      if (mcpRequestRef.current === requestId) mcpRequestRef.current = null
                    }
                  },
                },
                toolChoice: resolveWebChoice(fullContent, options.forceWeb ?? false),
                requestId: assistantId,
                compatibilityKey: `${provider.id}/${modelId}`,
                unsupportedTools: unsupportedToolsRef.current,
                onStatus: (webStatus: WebStatus | undefined) => upsertLast({ webStatus }),
              }
            : undefined

          const result = await runAssistantTurn({
            provider: apiProvider,
            request: { messages: apiMessages },
            apiKey: activeApiKey,
            modelId,
            callbacks: turnCallbacks,
            signal: controller.signal,
            ...(web ? { web } : {}),
          })
          if (controller.signal.aborted) throw controller.signal.reason
          accRef.current = result.text
          if (web) {
            setWebToolsUnsupported(unsupportedToolsRef.current.has(`${provider.id}/${modelId}`))
          }
          const pricingProvider = resolvePricingProvider(provider.baseUrl) ?? ""
          const providerMetrics = result.usage
            ? metricsFromProviderUsage(result.usage, pricingProvider, modelId)
            : null
          const metrics = providerMetrics ?? (web
            ? null
            : estimateTurnMetrics(apiMessages, result.text, pricingProvider, modelId))
          await persistDone(result, metrics)
        } catch (e) {
          await persistError(e)
        }
        return true
      } catch (e) {
        // Contrat anti-perte : !userPersisted → false (contenu restauré par
        // InputBar) et retrait de la bulle optimiste (sinon doublon au renvoi).
        // Le cas post-insert est un dernier filet : le inner catch matérialise
        // normalement déjà toute erreur dans la bulle assistant.
        logger.error({ kind: "chat_send", message: safeTurnErrorMessage(e) })
        if (!userPersisted) setVm((s) => s.filter((m) => m.id !== localUserId))
        return userPersisted
      } finally {
        // Le runner et la persistance assistant sont terminés avant de rendre
        // l'input, y compris après erreur ou interruption.
        setBusy(false)
        abortRef.current = null
        mcpRequestRef.current = null
      }
    },
    [busy, modelSelection, webAccess],
  )

  const interrupt = useCallback(() => {
    abortRef.current?.abort()
    const requestId = mcpRequestRef.current
    if (requestId) {
      void tinyfish.cancel(requestId).catch((error) => {
        logger.error({ kind: "mcp_cancel", message: safeErrorMessage(error) })
      })
    }
  }, [])
  return { vm, busy, send, interrupt, load, webToolsUnsupported }
}

function mapRow(r: MessageRow): ChatMessageVM {
  let apiError: ApiErrorPayload | undefined
  let interrupted: boolean | undefined
  let attachments: Attachment[] | undefined
  let sources: WebSource[] = []
  if (r.error) {
    try {
      const parsed = JSON.parse(r.error) as ApiErrorPayload & { interrupted?: boolean }
      if (parsed.interrupted) interrupted = true
      else if (parsed.kind) {
        apiError = {
          kind: normalizeApiErrorKind(parsed.kind),
          // Une ligne legacy ne permet pas de retrouver sa clé arbitraire exacte.
          // Seul le kind contrôlé atteint la VM ; le libellé vient de l'i18n.
          message: "",
        }
      }
    } catch {
      // error non-JSON (legacy) : ignoré
    }
  }
  if (r.attachments) {
    try {
      const parsed = JSON.parse(r.attachments) as Attachment[]
      if (parsed.length > 0) {
        // base64 non stocké pour l'historique ; kind par défaut = image
        // (les lignes legacy au format pré-kind n'ont que des images).
        attachments = parsed.map((a) => ({ ...a, base64: "", kind: a.kind ?? "image" }))
      }
    } catch {
      // ignore
    }
  }
  if (r.sources) {
    try {
      const parsed = JSON.parse(r.sources) as unknown
      if (Array.isArray(parsed)) {
        sources = parsed.filter((source): source is WebSource => {
          if (typeof source !== "object" || source === null) return false
          const candidate = source as Partial<WebSource>
          return typeof candidate.url === "string" &&
            (candidate.origin === "search" || candidate.origin === "fetch_content") &&
            (candidate.title === undefined || typeof candidate.title === "string")
        })
      }
    } catch {
      // Valeur historique invalide : aucune source affichée.
    }
  }
  return {
    id: r.id, role: r.role, content: r.content, attachments,
    modelLabel: r.model_label ?? undefined,
    latencyMs: r.latency_ms ?? undefined,
    firstTokenMs: r.first_token_ms ?? undefined,
    inputTokens: r.input_tokens ?? undefined,
    outputTokens: r.output_tokens ?? undefined,
    usageSource: r.usage_source ?? undefined,
    costMicrousd: r.cost_microusd ?? undefined,
    apiError, interrupted, sources,
  }
}
