import { useCallback, useEffect, useRef, useState } from "react"
import { createProvider, buildPreview } from "@/lib/ai/factory"
import { logger } from "@/lib/logger"
import type { ApiError } from "@/lib/ai/errors"
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
import { runWebAgent } from "@/lib/mcp/webAgent"
import type { WebAccessConfig, WebSource, WebStatus } from "@/lib/mcp/types"

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
  apiError?: ApiErrorPayload
  interrupted?: boolean
  sources?: WebSource[]
  webStatus?: WebStatus
  webWarning?: string
}

export interface SendOptions {
  forceWeb?: boolean
}

const WEB_DISABLED: WebAccessConfig = { enabled: false, configured: false }

export function useChat(
  modelSelection: { provider: ProviderConfig; modelId: string; supportsImages: boolean } | null,
  webAccess: WebAccessConfig = WEB_DISABLED,
) {
  const [vm, setVm] = useState<ChatMessageVM[]>([])
  const [busy, setBusy] = useState(false)
  const [webToolsUnsupported, setWebToolsUnsupported] = useState(false)
  // Hoistés au niveau du hook : useRef dans une callback violerait les règles
  // des hooks. Un seul stream actif à la fois (gate busy) → un ref partagé sûr.
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
    setVm(rows.map((r): ChatMessageVM => mapRow(r)))
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
      // utilisateur persisté (les pannes ultérieures du stream sont traitées
      // dans la bulle par onError).
      let userPersisted = false
      // id client de la bulle optimiste (retirée si l'insert échoue)
      let localUserId: string | undefined = undefined

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
        await conversations.touch(conversationId)
        userPersisted = true

        // 3. Historique APRÈS l'insert user : le message fait partie du contexte API.
        // Prompt reconstruit à CHAQUE envoi : modifs des réglages / interrupteurs
        // de connaissances prennent effet au prochain message.
        const [promptSettings, enabledKnowledge] = await Promise.all([
          loadPromptSettings(),
          // Overrides par conversation : si la conversation a des knowledge_id explicites,
          // on les utilise (respectant l'ordre sort_order), sinon fallback global listEnabled.
          (async () => {
            const overrideIds = await conversationKnowledge.listOn(conversationId)
            if (overrideIds.length > 0) {
              const rows = await knowledgeDb.list()
              const byId = new Map(rows.map((k) => [k.id, k]))
              return overrideIds.map((id) => byId.get(id)).filter((k): k is typeof rows[0] => !!k && k.enabled === 1)
            }
            return knowledgeDb.listEnabled()
          })(),
        ])
        const system = buildSystemPrompt({
          general: promptSettings.general,
          profile: promptSettings.profile,
          knowledge: enabledKnowledge.map((k) => ({ name: k.name, content: k.content })),
          webEnabled: webAccess.enabled && webAccess.configured,
        })
        const history = await messagesDb.listByConversation(conversationId)
        const apiMessages: ChatMessage[] = [
          ...(system ? [{ role: "system" as const, content: system }] : []),
          ...history.map((h) => {
            let images: ChatMessage["images"] = undefined
            if (h.attachments) {
              try {
                const atts = JSON.parse(h.attachments) as { id: string; name: string; mimeType: string }[]
                if (atts.length > 0) {
                  // Note: on ne peut pas récupérer le base64 depuis la DB ici (pas stocké)
                  // Pour l'historique, on n'envoie pas les images pour économiser les tokens
                  // (optionnel : on pourrait stocker le base64 en base si nécessaire)
                }
              } catch {
                // ignore
              }
            }
            return { role: h.role, content: h.content, images }
          }),
        ]

        // 4. Ajouter les images du message courant au dernier message user de l'historique
        if (apiImages.length > 0 && apiMessages.length > 0) {
          const lastUserMsg = apiMessages[apiMessages.length - 1]
          if (lastUserMsg.role === "user") {
            lastUserMsg.images = apiImages
          }
        }

        // 5. Placeholder assistant : bulle de streaming visible dès le départ.
        const { provider, modelId, supportsImages } = modelSelection
        const apiProvider = createProvider(provider)
        const apiKey = (await secrets.get(provider.secretRef)) ?? ""
        const label = buildPreview(provider.name, modelId)
        const assistantId = crypto.randomUUID()
        setVm((s) => [...s, { id: assistantId, role: "assistant", content: "", modelLabel: label }])

        const upsertLast = (patch: Partial<ChatMessageVM>) =>
          setVm((s) => s.map((m) => (m.id === assistantId ? { ...m, ...patch } : m)))

        const isAbort = (e: unknown) =>
          typeof e === "object" && e !== null &&
          (("name" in e && e.name === "AbortError") ||
            ("message" in e && e.message === "Request cancelled"))

        const persistDone = (
          result: { text: string; totalMs: number },
          sources: WebSource[] = [],
          webWarning?: string,
        ) => {
          const acc = accRef.current
          return (async () => {
            const finalContent = result.text || acc
            const id = await messagesDb.insert({
              conversation_id: conversationId,
              role: "assistant",
              content: finalContent,
              attachments: "[]",
              model_label: label,
              latency_ms: Math.round(result.totalMs),
              error: null,
              sources: JSON.stringify(sources),
            })
            upsertLast({
              id,
              content: finalContent,
              latencyMs: Math.round(result.totalMs),
              sources,
              webWarning,
              webStatus: undefined,
            })
          })().catch(logger.error)
        }

        const persistError = (e: unknown) => {
          const acc = accRef.current
          return (async () => {
            if (isAbort(e)) {
              const id = await messagesDb.insert({
                conversation_id: conversationId, role: "assistant", content: acc,
                attachments: "[]", model_label: label, latency_ms: null,
                error: JSON.stringify({ interrupted: true }), sources: "[]",
              })
              upsertLast({ id, content: acc, interrupted: true, webStatus: undefined })
              return
            }
            const api = e as Partial<ApiError>
            const payload: ApiErrorPayload = {
              kind: api.kind ?? "unknown",
              message: api.message ?? "Erreur inattendue",
              ...(api.detail ? { detail: api.detail } : {}),
            }
            upsertLast({ apiError: payload, interrupted: false, webStatus: undefined })
            const id = await messagesDb.insert({
              conversation_id: conversationId, role: "assistant", content: acc,
              attachments: "[]", model_label: label, latency_ms: null,
              error: JSON.stringify(payload), sources: "[]",
            })
            upsertLast({ id, content: acc })
          })().catch(logger.error)
        }

        const turnCallbacks = {
          onFirstToken: () => { /* réservé V1.1 (temps de première réponse) */ },
          onDelta: (d: string) => {
            accRef.current += d
            upsertLast({ content: accRef.current })
          },
        }

        // DEBUG: log ce qui part vers l'API (no-op en production)
        logger.debug("[useChat] Envoi à l'API:", {
          modelId,
          supportsImages,
          apiImagesLength: apiImages.length,
          lastUserMsgImages: apiMessages[apiMessages.length - 1]?.images?.length ?? 0,
          messagesCount: apiMessages.length,
        })

        if (webAccess.enabled && webAccess.configured) {
          try {
            const webResult = await runWebAgent({
              provider: apiProvider,
              webClient: {
                call: async (requestId, request) => {
                  mcpRequestRef.current = requestId
                  try {
                    return await tinyfish.call(requestId, request)
                  } finally {
                    if (mcpRequestRef.current === requestId) mcpRequestRef.current = null
                  }
                },
              },
              request: { messages: apiMessages },
              apiKey,
              modelId,
              toolChoice: resolveWebChoice(fullContent, options.forceWeb ?? false),
              callbacks: turnCallbacks,
              signal: controller.signal,
              requestId: assistantId,
              compatibilityKey: `${provider.id}/${modelId}`,
              unsupportedTools: unsupportedToolsRef.current,
              onStatus: (webStatus) => upsertLast({ webStatus }),
            })
            setWebToolsUnsupported(unsupportedToolsRef.current.has(`${provider.id}/${modelId}`))
            if (controller.signal.aborted) throw controller.signal.reason
            accRef.current = webResult.text
            await persistDone(webResult, webResult.sources, webResult.warning)
          } catch (e) {
            await persistError(e)
          }
        } else {
          await apiProvider.stream(
            { messages: apiMessages },
            apiKey,
            modelId,
            {
              ...turnCallbacks,
            // Insertions persistance : ON RETOURNE la promesse (contrat fix
            // 85acc6b) — stream() l'attend (openai-compat.ts) avant de se
            // résoudre. Si on fait `void`, stream résout avant committance →
            // busy=false → refetch App sans le message (disparition).
            // Cap défensif : on lit accRef une seule fois (une interruption
            // simultanée ne peut plus muter le cap).
              onDone: persistDone,
              onError: persistError,
            },
            controller.signal,
          )
        }
        return true
      } catch (e) {
        // Contrat anti-perte : !userPersisted → false (contenu restauré par
        // InputBar) et retrait de la bulle optimiste (sinon doublon au renvoi).
        // Sinon : message utilisateur déjà persisté, le problème du stream
        // est déjà matérialisé dans la bulle par onError.
        logger.error(e)
        if (!userPersisted) setVm((s) => s.filter((m) => m.id !== localUserId))
        return userPersisted
      } finally {
        // stream() résout quand le flux est fini (ou après onError) : toujours
        // réactivé, y compris en cas d'exception du consommateur.
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
    if (requestId) void tinyfish.cancel(requestId).catch(logger.error)
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
      else if (parsed.kind) apiError = parsed
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
    apiError, interrupted, sources,
  }
}
