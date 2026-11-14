import { useCallback, useEffect, useRef, useState } from "react"
import { createProvider, buildPreview } from "@/lib/ai/factory"
import { logger } from "@/lib/logger"
import {
  normalizeApiErrorKind,
  redactSensitiveDetail,
  type ApiError,
} from "@/lib/ai/errors"
import type { ApiErrorKind, ProviderConfig, ChatMessage } from "@/lib/ai/types"
import { messages as messagesDb, type MessageRow } from "@/lib/db/messages"
import { messageMedia as messageMediaDb, type MessageMediaInsert } from "@/lib/db/messageMedia"
import { images as imagesDb } from "@/lib/db/images"
import { conversations } from "@/lib/db/conversations"
import { secrets } from "@/lib/secrets/service"
import { mcp } from "@/lib/mcp/client"
import { resolveWebIntent } from "@/lib/mcp/webIntent"
import type { McpRuntimeSnapshot } from "@/lib/mcp/runtime"
import type {
  McpToolApprovalRequest,
  MessageMedia,
  WebSource,
  WebStatus,
} from "@/lib/mcp/types"
import { prepareConversationContext } from "@/lib/chat/prepareConversationContext"
import { createRecoveryPlan, type RecoveryMode } from "@/lib/chat/recoveryPolicy"
import { runAssistantTurn, type AssistantTurnResult } from "@/lib/chat/turnRunner"
import { invalidateModelContextProfile } from "@/lib/context/modelCapabilities"
import { ContextLengthDiagnosticError } from "@/lib/context/diagnostics"
import type { SafeContextDiagnostic } from "@/lib/context/types"
import type { ContextSession } from "@/lib/context"
import { formatTemplate } from "@/i18n/format"
import { t } from "@/i18n/fr"
import type { ToolMedia } from "@/lib/mcp/toolAgent"
import {
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
  width?: number
  height?: number
  // kind "text" : contenu du fichier importé (l'image, elle, passe en base64)
  text?: string
}

// Payload d'erreur persisté en JSON dans messages.error (rond-trip : la class
// ApiError ne survit pas à JSON.stringify, on sérialise un objet plat).
// Compteurs de contexte d'un échec — uniquement des nombres, reconstruits en
// phrase i18n à l'affichage (jamais de texte arbitraire relui depuis SQLite).
export interface ContextCounters {
  window: number
  system: number
  currentUser: number
  images: number
  tools: number
  mcp: number
  outputReserve: number
  safetyMargin: number
  total: number
}

export interface ApiErrorPayload {
  kind: ApiErrorKind
  message: string
  detail?: string
  contextCounters?: ContextCounters
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
  media?: MessageMedia[]
  webStatus?: WebStatus
  webWarning?: string
  conversationId?: string
  persistenceFailed?: boolean
  recoveryMode?: RecoveryMode
  recoveryFailed?: boolean
  toolApproval?: McpToolApprovalRequest
}

export interface SendOptions {
  forceWeb?: boolean
}

const PERSISTENCE_ERROR_MESSAGE = "La réponse n'a pas pu être enregistrée."
const MEDIA_PERSIST_WARNING =
  "Réponse enregistrée, mais les médias n'ont pas pu être sauvegardés."
const EMPTY_MCP_RUNTIME: McpRuntimeSnapshot = {
  servers: [],
  activeTools: [],
  authStatuses: {},
  webAccess: { enabled: false, configured: false },
}

function safeErrorMessage(error: unknown, exactSecrets: readonly string[] = []): string {
  const message = typeof error === "object" && error !== null &&
      "message" in error && typeof error.message === "string"
    ? error.message
    : "Erreur inattendue"
  return redactSensitiveDetail(message, exactSecrets)
}

// Extrait le diagnostic sûr attaché à un échec de contexte, uniquement si tous
// les compteurs sont des nombres finis (défense en profondeur : jamais de
// jeton {clé} laissé vide dans le message visible).
function contextCountersOf(
  error: unknown,
): SafeContextDiagnostic | null {
  if (!(error instanceof ContextLengthDiagnosticError)) return null
  const tokens = error.diagnostic.tokens
  const counters = [
    error.diagnostic.contextWindowTokens,
    tokens.system,
    tokens.currentUser,
    tokens.images,
    tokens.tools,
    tokens.mcpResults,
    tokens.outputReserve,
    tokens.safetyMargin,
    tokens.totalWithReserve,
  ]
  return counters.every((value) => typeof value === "number" && Number.isFinite(value))
    ? error.diagnostic
    : null
}

function contextFailureMessage(diagnostic: SafeContextDiagnostic): string {
  return formatTemplate(t.errors.contextDetail, contextCountersOfNumbers(diagnostic))
}

function contextCountersOfNumbers(diagnostic: SafeContextDiagnostic): ContextCounters {
  const tokens = diagnostic.tokens
  return {
    window: diagnostic.contextWindowTokens,
    system: tokens.system,
    currentUser: tokens.currentUser,
    images: tokens.images,
    tools: tokens.tools,
    mcp: tokens.mcpResults,
    outputReserve: tokens.outputReserve,
    safetyMargin: tokens.safetyMargin,
    total: tokens.totalWithReserve,
  }
}

function normalizeDuration(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? Math.round(value)
    : null
}

function metricsFromEstimatedUsage(
  usage: AssistantTurnResult["estimatedUsage"],
): TurnMetrics | null {
  if (
    !usage ||
    !Number.isSafeInteger(usage.inputTokens) ||
    !Number.isSafeInteger(usage.outputTokens) ||
    usage.inputTokens < 0 ||
    usage.outputTokens < 0
  ) return null
  return {
    inputTokens: usage.inputTokens,
    outputTokens: usage.outputTokens,
    usageSource: "estimated",
    costMicrousd: null,
  }
}

/** Réfs JSON ordonnées des médias : tolérant aux valeurs historiques invalides. */
function parseMediaRefs(json: string | undefined | null): string[] {
  try {
    const parsed = JSON.parse(json ?? "[]") as unknown
    return Array.isArray(parsed)
      ? parsed.filter((v): v is string => typeof v === "string")
      : []
  } catch {
    return []
  }
}

/** Médias du tour, tolérant : une réponse sans champ média (fixtures ou
 * contrats anciens) est traitée comme « aucun média » — une absence ne doit
 * jamais casser la persistance du message. */
function mediaOf(result: AssistantTurnResult): ToolMedia[] {
  return Array.isArray(result.media) ? result.media : []
}

/** Insère les médias d'une réponse et pose les refs sur le message. Retourne
 * les entrées hydratées (id posé) ou null si la persistance a échoué : les
 * médias sont optionnels et ne requalifient jamais une réponse réussie. */
async function persistMediaRows(
  messageId: string,
  media: ToolMedia[],
): Promise<MessageMedia[] | null> {
  const entries: MessageMedia[] = media.map((item) => ({ ...item, id: crypto.randomUUID() }))
  try {
    const rows: MessageMediaInsert[] = entries.map((entry) => ({
      id: entry.id,
      message_id: messageId,
      kind: entry.type,
      mime_type: entry.mimeType,
      tool_label: entry.toolLabel,
      base64: entry.base64,
    }))
    await messageMediaDb.insertRows(rows)
    await messagesDb.setMediaRefs(messageId, JSON.stringify(entries.map((entry) => entry.id)))
    return entries
  } catch (error) {
    logger.error({
      kind: "assistant_media_persistence",
      message: safeErrorMessage(error),
    })
    return null
  }
}

/** Hydrate les refs messages.media en entrées typées (un seul IN global).
 * Les refs sont des IDS de médias : requête sur la colonne id, PAS message_id. */
async function hydrateMedia(
  refsByMessage: Map<string, string[]>,
): Promise<Map<string, MessageMedia[]>> {
  const ids = [...new Set([...refsByMessage.values()].flat())]
  if (ids.length === 0) return new Map()
  const rows = await messageMediaDb.listByIds(ids)
  const byId = new Map(
    rows.map((row) => [
      row.id,
      {
        id: row.id,
        type: row.kind,
        mimeType: row.mime_type,
        base64: row.base64,
        toolLabel: row.tool_label,
      } satisfies MessageMedia,
    ]),
  )
  const result = new Map<string, MessageMedia[]>()
  for (const [messageId, refs] of refsByMessage) {
    const hydrated = refs
      .map((ref) => byId.get(ref))
      .filter((entry): entry is MessageMedia => Boolean(entry))
    if (hydrated.length > 0) result.set(messageId, hydrated)
  }
  return result
}

export function useChat(
  modelSelection: {
    provider: ProviderConfig
    modelRowId: string
    modelId: string
    supportsImages: boolean
    contextWindowOverride: number | null
    maxOutputTokensOverride: number | null
  } | null,
  mcpRuntime: McpRuntimeSnapshot = EMPTY_MCP_RUNTIME,
) {
  const [vm, setVm] = useState<ChatMessageVM[]>([])
  const [busy, setBusy] = useState(false)
  const [webToolsUnsupported, setWebToolsUnsupported] = useState(false)
  const [pendingToolApproval, setPendingToolApproval] = useState<McpToolApprovalRequest | null>(null)
  // Hoistés au niveau du hook : useRef dans une callback violerait les règles
  // des hooks. Le verrou ref ferme la fenêtre avant le prochain rendu React.
  const inFlightRef = useRef(false)
  const accRef = useRef("")
  const abortRef = useRef<AbortController | null>(null)
  const unsupportedToolsRef = useRef(new Set<string>())
  const loadSeqRef = useRef(0)
  const approvalResolverRef = useRef<((decision: "allow" | "deny") => void) | null>(null)
  const activeTurnIdRef = useRef<string | null>(null)

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
    const refsByMessage = new Map<string, string[]>()
    for (const row of rows) {
      const refs = parseMediaRefs(row.media)
      if (refs.length > 0) refsByMessage.set(row.id, refs)
    }
    const mediaByMessage = await hydrateMedia(refsByMessage)
    setVm((current) => {
      const warningsById = new Map(
        current
          .filter((message) => message.id && message.webWarning)
          .map((message) => [message.id as string, message.webWarning as string]),
      )
      const recoveryFailedIds = new Set(
        current
          .filter((message) => message.id && message.recoveryFailed)
          .map((message) => message.id as string),
      )
      const persisted = rows.map((row): ChatMessageVM => ({
        ...mapRow(row),
        ...(mediaByMessage.has(row.id) ? { media: mediaByMessage.get(row.id) } : {}),
        ...(warningsById.has(row.id) ? { webWarning: warningsById.get(row.id) } : {}),
        ...(recoveryFailedIds.has(row.id) ? { recoveryFailed: true } : {}),
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

  const settleApproval = useCallback((decision: "allow" | "deny") => {
    const resolve = approvalResolverRef.current
    approvalResolverRef.current = null
    setPendingToolApproval(null)
    setVm((messages) =>
      messages.map((message) =>
        message.toolApproval ? { ...message, toolApproval: undefined } : message,
      ),
    )
    resolve?.(decision)
  }, [])

  const allowTool = useCallback(() => settleApproval("allow"), [settleApproval])
  const denyTool = useCallback(() => settleApproval("deny"), [settleApproval])

  const approvalHandlerFor = useCallback(
    (update: (patch: Partial<ChatMessageVM>) => void) =>
      (request: McpToolApprovalRequest): Promise<"allow" | "deny"> =>
        new Promise((resolve) => {
          approvalResolverRef.current?.("deny")
          approvalResolverRef.current = resolve
          setPendingToolApproval(request)
          update({ toolApproval: request })
        }),
    [],
  )

  const send = useCallback(
    async (
      conversationId: string,
      text: string,
      attachments: Attachment[] = [],
      options: SendOptions = {},
    ): Promise<boolean> => {
      const content = text.trim()
      if (!content && attachments.length === 0) return false
      if (inFlightRef.current || !modelSelection) return false
      inFlightRef.current = true
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
          apiImages.push({
            base64: att.base64,
            mimeType: att.mimeType,
            ...(att.width ? { width: att.width } : {}),
            ...(att.height ? { height: att.height } : {}),
          })
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
        const { provider, modelId } = modelSelection
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
            const latencyMs = normalizeDuration(result.totalMs)
            const firstTokenMs = normalizeDuration(result.firstTokenMs)
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
            // Les médias sont optionnels : leur échec ne requalifie jamais la
            // réponse en erreur (note via webWarning, bulle conservée).
            const persistedMedia = mediaOf(result).length > 0
              ? await persistMediaRows(id, mediaOf(result))
              : []
            // L'id passe à l'id SQLite : les refetch (load) et les relances
            // (retry/regenerate) ciblent la vraie row. Le remount React qui
            // en découle est sans conséquence — le flash média provenait du
            // bug d'hydratation (refs interrogées sur message_id), corrigé.
            upsertLast({
              id,
              content: finalContent,
              latencyMs: latencyMs ?? undefined,
              firstTokenMs: firstTokenMs ?? undefined,
              inputTokens: metrics?.inputTokens,
              outputTokens: metrics?.outputTokens,
              usageSource: metrics?.usageSource,
              costMicrousd: metrics?.costMicrousd ?? undefined,
              sources: result.sources,
              media: persistedMedia ?? [],
              webWarning: persistedMedia === null
                ? [result.warning, MEDIA_PERSIST_WARNING].filter(Boolean).join(" ")
                : result.warning,
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
            const kind = normalizeApiErrorKind(api.kind)
            if (kind === "context_length") {
              invalidateModelContextProfile(`${provider.id}/${modelId}`)
            }
            // Échec de contexte : journal avec diagnostic sûr + compteurs visibles.
            const failureDiagnostic = contextCountersOf(e)
            if (failureDiagnostic) {
              logger.error({
                kind: "chat_context_failure",
                message: safeTurnErrorMessage(e),
                diagnostic: failureDiagnostic,
              })
            }
            const payload: ApiErrorPayload = {
              kind,
              message: failureDiagnostic
                ? redactTurnDetail(contextFailureMessage(failureDiagnostic))
                : redactTurnDetail(api.message ?? "Erreur inattendue"),
              ...(api.detail ? { detail: redactTurnDetail(api.detail) } : {}),
              ...(failureDiagnostic ? { contextCounters: contextCountersOfNumbers(failureDiagnostic) } : {}),
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
              kind: "persistence",
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
        let turnContext: ContextSession | null = null

        try {
          // Historique APRÈS l'insert user : le message fait partie du contexte API.
          const history = await messagesDb.listByConversation(conversationId)
          const apiProvider = createProvider(provider)
          activeApiKey = (await secrets.get(provider.secretRef)) ?? ""
          turnContext = await prepareConversationContext({
            conversationId,
            history,
            currentImages: apiImages,
            provider,
            providerAdapter: apiProvider,
            apiKey: activeApiKey,
            modelId,
            contextWindowOverride: modelSelection.contextWindowOverride,
            maxOutputTokensOverride: modelSelection.maxOutputTokensOverride,
            webEnabled: mcpRuntime.webAccess.enabled && mcpRuntime.webAccess.configured,
          })

          activeTurnIdRef.current = assistantId
          const approve = approvalHandlerFor(upsertLast)

          const tools = mcpRuntime.activeTools.length > 0
            ? {
                toolClient: {
                  call: (serverId: string, turnId: string, callId: string, nativeName: string, arguments_: Record<string, unknown>) =>
                    mcp.callTool(serverId, turnId, callId, nativeName, arguments_),
                },
                tools: mcpRuntime.activeTools,
                webIntent: resolveWebIntent(fullContent, options.forceWeb ?? false),
                turnId: assistantId,
                compatibilityKey: `${provider.id}/${modelId}`,
                unsupportedTools: unsupportedToolsRef.current,
                approve,
                onWebStatus: (webStatus: WebStatus | undefined) => upsertLast({ webStatus }),
              }
            : undefined

          const result = await runAssistantTurn(
            tools
              ? {
                  provider: apiProvider,
                  context: turnContext,
                  apiKey: activeApiKey,
                  modelId,
                  callbacks: turnCallbacks,
                  signal: controller.signal,
                  tools,
                }
              : {
                  provider: apiProvider,
                  context: turnContext,
                  apiKey: activeApiKey,
                  modelId,
                  callbacks: turnCallbacks,
                  signal: controller.signal,
                }
          )
          if (controller.signal.aborted) throw controller.signal.reason
          accRef.current = result.text
          if (tools) {
            setWebToolsUnsupported(unsupportedToolsRef.current.has(`${provider.id}/${modelId}`))
          }
          let metrics: TurnMetrics | null = null
          try {
            const pricingProvider = resolvePricingProvider(provider.baseUrl) ?? ""
            const providerMetrics = result.usage
              ? metricsFromProviderUsage(result.usage, pricingProvider, modelId)
              : null
            metrics = providerMetrics ?? metricsFromEstimatedUsage(result.estimatedUsage)
          } catch (metricsError) {
            // Les métriques sont optionnelles : leur panne ne requalifie jamais
            // une réponse fournisseur réussie en erreur API.
            logger.error({
              kind: "chat_metrics",
              message: safeTurnErrorMessage(metricsError),
            })
          }
          try {
            await persistDone(result, metrics)
          } catch (persistenceError) {
            // La cause SQLite reste réservée au log reconstruit. La VM et la
            // seconde tentative ne reçoivent qu'un payload public stable.
            logger.error({
              kind: "assistant_response_persistence",
              message: safeTurnErrorMessage(persistenceError),
            })
            await persistError({
              kind: "persistence",
              message: PERSISTENCE_ERROR_MESSAGE,
            } satisfies ApiErrorPayload)
          }
        } catch (e) {
          await persistError(e)
        } finally {
          turnContext?.dispose()
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
        approvalResolverRef.current?.("deny")
        approvalResolverRef.current = null
        setPendingToolApproval(null)
        activeTurnIdRef.current = null
        inFlightRef.current = false
        setBusy(false)
        abortRef.current = null
      }
    },
    [modelSelection, mcpRuntime, approvalHandlerFor],
  )

  const recoverLast = useCallback(
    async (
      conversationId: string,
      targetId: string,
      mode: RecoveryMode,
    ): Promise<boolean> => {
      if (inFlightRef.current || !modelSelection) return false
      inFlightRef.current = true
      setBusy(true)
      const controller = new AbortController()
      abortRef.current = controller
      let activeApiKey = ""
      let recoveryAcc = ""
      let recoveryContext: ContextSession | null = null
      const safeRecoveryError = (error: unknown) =>
        safeErrorMessage(error, [activeApiKey])
      const upsertTarget = (patch: Partial<ChatMessageVM>) => {
        setVm((current) => current.map((message) =>
          message.id === targetId ? { ...message, ...patch } : message,
        ))
      }

      try {
        const rows = await messagesDb.listByConversation(conversationId)
        const plan = createRecoveryPlan(rows, targetId, mode)
        if (!plan) return false

        // Les anciens médias sont retirés avant réécriture (l'ancienne
        // réponse ne repart pas dans l'historique rechargé) ; un échec de
        // nettoyage suit le chemin recoveryFailed existant.
        await messageMediaDb.removeByMessageIds([targetId])

        upsertTarget({
          recoveryMode: mode,
          recoveryFailed: undefined,
          webStatus: undefined,
        })

        const { provider, modelId } = modelSelection
        const label = buildPreview(provider.name, modelId)
        const apiProvider = createProvider(provider)
        activeApiKey = (await secrets.get(provider.secretRef)) ?? ""
        recoveryContext = await prepareConversationContext({
          conversationId,
          history: plan.history,
          currentImages: [],
          provider,
          providerAdapter: apiProvider,
          apiKey: activeApiKey,
          modelId,
          contextWindowOverride: modelSelection.contextWindowOverride,
          maxOutputTokensOverride: modelSelection.maxOutputTokensOverride,
          webEnabled: mcpRuntime.webAccess.enabled && mcpRuntime.webAccess.configured,
        })
        const callbacks = {
          onFirstToken: () => { /* métrique remontée par le runner */ },
          onDelta: (delta: string) => {
            recoveryAcc += delta
          },
        }
        const requestId = crypto.randomUUID()
        activeTurnIdRef.current = requestId
        const recoveryTools = mcpRuntime.activeTools.length > 0
          ? {
              toolClient: {
                call: (serverId: string, turnId: string, callId: string, nativeName: string, arguments_: Record<string, unknown>) =>
                  mcp.callTool(serverId, turnId, callId, nativeName, arguments_),
              },
              tools: mcpRuntime.activeTools,
              webIntent: resolveWebIntent(plan.triggerUserContent, false),
              turnId: requestId,
              compatibilityKey: `${provider.id}/${modelId}`,
              unsupportedTools: unsupportedToolsRef.current,
              approve: approvalHandlerFor(upsertTarget),
              onWebStatus: (webStatus: WebStatus | undefined) => upsertTarget({ webStatus }),
            }
          : undefined
        const result = await runAssistantTurn(
          recoveryTools
            ? {
                provider: apiProvider,
                context: recoveryContext,
                apiKey: activeApiKey,
                modelId,
                callbacks,
                signal: controller.signal,
                tools: recoveryTools,
              }
            : {
                provider: apiProvider,
                context: recoveryContext,
                apiKey: activeApiKey,
                modelId,
                callbacks,
                signal: controller.signal,
              }
        )
        if (controller.signal.aborted) throw controller.signal.reason
        const finalContent = result.text || recoveryAcc
        if (finalContent.trim() === "") throw new Error("Réponse vide du fournisseur")

        let metrics: TurnMetrics | null = null
        try {
          const pricingProvider = resolvePricingProvider(provider.baseUrl) ?? ""
          const providerMetrics = result.usage
            ? metricsFromProviderUsage(result.usage, pricingProvider, modelId)
            : null
          metrics = providerMetrics ?? metricsFromEstimatedUsage(result.estimatedUsage)
        } catch (metricsError) {
          logger.error({ kind: "chat_recovery_metrics", message: safeRecoveryError(metricsError) })
        }

        const latencyMs = normalizeDuration(result.totalMs)
        const firstTokenMs = normalizeDuration(result.firstTokenMs)
        await messagesDb.updateAssistant(targetId, {
          content: finalContent,
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
        // Remplacement des médias analogiquement à la réécriture du contenu.
        const persistedMedia = mediaOf(result).length > 0
          ? await persistMediaRows(targetId, mediaOf(result))
          : []
        upsertTarget({
          content: finalContent,
          modelLabel: label,
          latencyMs: latencyMs ?? undefined,
          firstTokenMs: firstTokenMs ?? undefined,
          inputTokens: metrics?.inputTokens,
          outputTokens: metrics?.outputTokens,
          usageSource: metrics?.usageSource,
          costMicrousd: metrics?.costMicrousd ?? undefined,
          apiError: undefined,
          interrupted: undefined,
          sources: result.sources,
          media: persistedMedia ?? [],
          webWarning: persistedMedia === null
            ? [result.warning, MEDIA_PERSIST_WARNING].filter(Boolean).join(" ")
            : result.warning,
          webStatus: undefined,
          recoveryMode: undefined,
          recoveryFailed: undefined,
        })
        if (recoveryTools) {
          setWebToolsUnsupported(unsupportedToolsRef.current.has(`${provider.id}/${modelId}`))
        }
        await conversations.touch(conversationId).catch((error) => {
          logger.error({ kind: "conversation_touch", message: safeRecoveryError(error) })
        })
        return true
      } catch (error) {
        const kind = normalizeApiErrorKind((error as Partial<ApiError>).kind)
        if (kind === "context_length") {
          invalidateModelContextProfile(`${modelSelection.provider.id}/${modelSelection.modelId}`)
        }
        const failureDiagnostic = contextCountersOf(error)
        logger.error({
          kind: "chat_recovery",
          message: safeRecoveryError(error),
          ...(failureDiagnostic ? { diagnostic: failureDiagnostic } : {}),
        })
        upsertTarget({
          recoveryMode: undefined,
          recoveryFailed: true,
          webStatus: undefined,
        })
        return false
      } finally {
        recoveryContext?.dispose()
        approvalResolverRef.current?.("deny")
        approvalResolverRef.current = null
        setPendingToolApproval(null)
        activeTurnIdRef.current = null
        inFlightRef.current = false
        setBusy(false)
        abortRef.current = null
      }
    },
    [modelSelection, mcpRuntime, approvalHandlerFor],
  )

  const retryLast = useCallback(
    (conversationId: string, targetId: string) =>
      recoverLast(conversationId, targetId, "retry"),
    [recoverLast],
  )

  const regenerateLast = useCallback(
    (conversationId: string, targetId: string) =>
      recoverLast(conversationId, targetId, "regenerate"),
    [recoverLast],
  )

  const interrupt = useCallback(() => {
    approvalResolverRef.current?.("deny")
    approvalResolverRef.current = null
    setPendingToolApproval(null)
    abortRef.current?.abort()
    const turnId = activeTurnIdRef.current
    if (turnId) {
      void mcp.cancelTurn(turnId).catch((error) => {
        logger.error({ kind: "mcp_cancel", message: safeErrorMessage(error) })
      })
    }
    activeTurnIdRef.current = null
  }, [])
  return {
    vm,
    busy,
    send,
    retryLast,
    regenerateLast,
    interrupt,
    load,
    webToolsUnsupported,
    pendingToolApproval,
    allowTool,
    denyTool,
  }
}

const CONTEXT_COUNTER_KEYS = [
  "window", "system", "currentUser", "images", "tools",
  "mcp", "outputReserve", "safetyMargin", "total",
] as const

function parseContextCounters(value: unknown): ContextCounters | null {
  if (typeof value !== "object" || value === null) return null
  const record = value as Record<string, unknown>
  const counters: Record<string, number> = {}
  for (const key of CONTEXT_COUNTER_KEYS) {
    const entry = record[key]
    if (typeof entry !== "number" || !Number.isFinite(entry)) return null
    counters[key] = entry
  }
  return counters as unknown as ContextCounters
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
        // Une ligne legacy ne permet pas de retrouver sa clé arbitraire exacte.
        // Seul le kind contrôlé atteint la VM ; le libellé vient de l'i18n.
        // Les compteurs de contexte sont des nombres validés : la phrase est
        // reconstruite par l'i18n, jamais relue depuis le texte persisté.
        const counters = parseContextCounters(parsed.contextCounters)
        apiError = {
          kind: normalizeApiErrorKind(parsed.kind),
          message: counters ? formatTemplate(t.errors.contextDetail, counters) : "",
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
  const latencyMs = normalizeDuration(r.latency_ms)
  const firstTokenMs = normalizeDuration(r.first_token_ms)
  return {
    id: r.id, role: r.role, content: r.content, attachments,
    modelLabel: r.model_label ?? undefined,
    latencyMs: latencyMs ?? undefined,
    firstTokenMs: firstTokenMs ?? undefined,
    inputTokens: r.input_tokens ?? undefined,
    outputTokens: r.output_tokens ?? undefined,
    usageSource: r.usage_source ?? undefined,
    costMicrousd: r.cost_microusd ?? undefined,
    apiError, interrupted, sources,
  }
}
