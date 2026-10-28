import { useCallback, useRef, useState } from "react"
import { createProvider, buildPreview } from "@/lib/ai/factory"
import type { ApiError } from "@/lib/ai/errors"
import type { ApiErrorKind, ProviderConfig } from "@/lib/ai/types"
import { buildSystemPrompt } from "@/lib/prompts/compose"
import { DEFAULT_GENERAL_INSTRUCTIONS, PROFILE_APPRENTISSAGE } from "@/lib/prompts/defaults"
import { messages as messagesDb, type MessageRow } from "@/lib/db/messages"
import { conversations } from "@/lib/db/conversations"
import { secrets } from "@/lib/secrets/service"

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
  modelLabel?: string
  latencyMs?: number
  apiError?: ApiErrorPayload
  interrupted?: boolean
}

export function useChat(modelSelection: { provider: ProviderConfig; modelId: string } | null) {
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
    async (conversationId: string, text: string) => {
      const content = text.trim()
      if (!content || busy || !modelSelection) return
      setBusy(true)
      const controller = new AbortController()
      abortRef.current = controller
      accRef.current = ""

      try {
        // 1. Message user : affiché immédiatement, puis persisté.
        setVm((s) => [...s, { role: "user", content }])
        await messagesDb.insert({
          conversation_id: conversationId, role: "user", content,
          attachments: "[]", model_label: null, latency_ms: null, error: null,
        })
        await conversations.touch(conversationId)

        // 2. Historique APRÈS l'insert user : le message fait partie du contexte API.
        const system = buildSystemPrompt({
          general: DEFAULT_GENERAL_INSTRUCTIONS,
          profile: PROFILE_APPRENTISSAGE,
        })
        const history = await messagesDb.listByConversation(conversationId)
        const apiMessages = [
          ...(system ? [{ role: "system" as const, content: system }] : []),
          ...history.map((h) => ({ role: h.role, content: h.content })),
        ]

        // 3. Placeholder assistant : bulle de streaming visible dès le départ.
        const { provider, modelId } = modelSelection
        const apiProvider = createProvider(provider)
        const apiKey = (await secrets.get(provider.secretRef)) ?? ""
        const label = buildPreview(provider.name, modelId)
        const assistantId = crypto.randomUUID()
        setVm((s) => [...s, { id: assistantId, role: "assistant", content: "", modelLabel: label }])

        const upsertLast = (patch: Partial<ChatMessageVM>) =>
          setVm((s) => s.map((m) => (m.id === assistantId ? { ...m, ...patch } : m)))

        const isAbort = (e: unknown) => e instanceof Error && e.name === "AbortError"

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
  if (r.error) {
    try {
      const parsed = JSON.parse(r.error) as ApiErrorPayload & { interrupted?: boolean }
      if (parsed.interrupted) interrupted = true
      else if (parsed.kind) apiError = parsed
    } catch {
      // error non-JSON (legacy) : ignoré
    }
  }
  return {
    id: r.id, role: r.role, content: r.content,
    modelLabel: r.model_label ?? undefined,
    latencyMs: r.latency_ms ?? undefined,
    apiError, interrupted,
  }
}
