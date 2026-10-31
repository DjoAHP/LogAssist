import { useCallback, useRef, useState } from "react"
import { createProvider, buildPreview } from "@/lib/ai/factory"
import { logger } from "@/lib/logger"
import type { ApiError } from "@/lib/ai/errors"
import type { ApiErrorKind, ProviderConfig, ChatMessage } from "@/lib/ai/types"
import { buildSystemPrompt } from "@/lib/prompts/compose"
import { loadPromptSettings } from "@/lib/prompts/store"
import { knowledge as knowledgeDb } from "@/lib/db/knowledge"
import { messages as messagesDb, type MessageRow } from "@/lib/db/messages"
import { images as imagesDb } from "@/lib/db/images"
import { conversations } from "@/lib/db/conversations"
import { secrets } from "@/lib/secrets/service"

export interface Attachment {
  id: string
  base64: string
  mimeType: string
  name: string
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
}

export function useChat(modelSelection: { provider: ProviderConfig; modelId: string; supportsImages: boolean } | null) {
  const [vm, setVm] = useState<ChatMessageVM[]>([])
  const [busy, setBusy] = useState(false)
  // Hoistés au niveau du hook : useRef dans une callback violerait les règles
  // des hooks. Un seul stream actif à la fois (gate busy) → un ref partagé sûr.
  const accRef = useRef("")
  const abortRef = useRef<AbortController | null>(null)
  const loadSeqRef = useRef(0)

  const load = useCallback(async (conversationId: string) => {
    // Token de séquence : une réponse de load obsolète (switch rapide entre
    // conversations, rechargements concurrents) ne doit jamais écraser la vm.
    const seq = ++loadSeqRef.current
    const rows = await messagesDb.listByConversation(conversationId)
    if (seq !== loadSeqRef.current) return
    setVm(rows.map((r): ChatMessageVM => mapRow(r)))
  }, [])

  const send = useCallback(
    async (conversationId: string, text: string, attachments: Attachment[] = []): Promise<boolean> => {
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

        if (attachments.length > 0 && modelSelection.supportsImages) {
          for (const att of attachments) {
            // Stocker en base (table images)
            await imagesDb.create(att.id, att.name)
            // Préparer pour l'API
            apiImages.push({ base64: att.base64, mimeType: att.mimeType })
            storedAttachments.push(att)
          }
        }

        // 2. Message user : affiché immédiatement, puis persisté.
        localUserId = crypto.randomUUID()
        setVm((s) => [...s, { id: localUserId, role: "user", content, attachments: storedAttachments }])
        await messagesDb.insert({
          conversation_id: conversationId,
          role: "user",
          content,
          attachments: JSON.stringify(storedAttachments.map((a) => ({ id: a.id, name: a.name, mimeType: a.mimeType }))),
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
          knowledgeDb.listEnabled(),
        ])
        const system = buildSystemPrompt({
          general: promptSettings.general,
          profile: promptSettings.profile,
          knowledge: enabledKnowledge.map((k) => ({ name: k.name, content: k.content })),
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

        const isAbort = (e: unknown) => e instanceof Error && e.name === "AbortError"

        // DEBUG: log ce qui part vers l'API (no-op en production)
        logger.debug("[useChat] Envoi à l'API:", {
          modelId,
          supportsImages,
          apiImagesLength: apiImages.length,
          lastUserMsgImages: apiMessages[apiMessages.length - 1]?.images?.length ?? 0,
          messagesCount: apiMessages.length,
        })

        await apiProvider.stream(
          { messages: apiMessages },
          apiKey,
          modelId,
          {
            onFirstToken: () => { /* réservé V1.1 (temps de première réponse) */ },
            onDelta: (d) => {
              accRef.current += d
              upsertLast({ content: accRef.current })
            },
            // Insertions async en base : onDone résout déjà le stream, l'await
            // se poursuit en tâche de fond — attrapé localement pour éviter
            // tout unhandled rejection. Cap défensif : on lit accRef une seule
            // fois (une interruption simultanée ne peut plus muter le cap).
            onDone: ({ text, totalMs }) => {
              const acc = accRef.current
              void (async () => {
                const id = await messagesDb.insert({
                  conversation_id: conversationId, role: "assistant", content: text || acc,
                  attachments: "[]", model_label: label, latency_ms: Math.round(totalMs), error: null,
                })
                upsertLast({ id, content: text || acc, latencyMs: Math.round(totalMs) })
              })().catch(console.error)
            },
            onError: (e) => {
              const acc = accRef.current
              void (async () => {
                if (isAbort(e)) {
                  // Interruption volontaire : contenu accumulé conservé et
                  // persisté, marqué « interrompu », pas de bulle d'erreur.
                  const id = await messagesDb.insert({
                    conversation_id: conversationId, role: "assistant", content: acc,
                    attachments: "[]", model_label: label, latency_ms: null,
                    error: JSON.stringify({ interrupted: true }),
                  })
                  upsertLast({ id, content: acc, interrupted: true })
                  return
                }
                const api = e as ApiError
                const payload: ApiErrorPayload = {
                  kind: api.kind ?? "unknown",
                  message: api.message,
                  ...(api.detail ? { detail: api.detail } : {}),
                }
                upsertLast({ apiError: payload, interrupted: false })
                const id = await messagesDb.insert({
                  conversation_id: conversationId, role: "assistant", content: acc,
                  attachments: "[]", model_label: label, latency_ms: null,
                  error: JSON.stringify(payload),
                })
                upsertLast({ id, content: acc })
              })().catch(console.error)
            },
          },
          controller.signal,
        )
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
      }
    },
    [busy, modelSelection],
  )

  const interrupt = useCallback(() => abortRef.current?.abort(), [])
  return { vm, busy, send, interrupt, load }
}

function mapRow(r: MessageRow): ChatMessageVM {
  let apiError: ApiErrorPayload | undefined
  let interrupted: boolean | undefined
  let attachments: Attachment[] | undefined
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
      const parsed = JSON.parse(r.attachments) as { id: string; name: string; mimeType: string }[]
      if (parsed.length > 0) {
        attachments = parsed.map((a) => ({ ...a, base64: "" })) // base64 non stocké pour l'historique
      }
    } catch {
      // ignore
    }
  }
  return {
    id: r.id, role: r.role, content: r.content, attachments,
    modelLabel: r.model_label ?? undefined,
    latencyMs: r.latency_ms ?? undefined,
    apiError, interrupted,
  }
}
