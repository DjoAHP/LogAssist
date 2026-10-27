import { ApiError, normalizeHttpStatus, normalizeNetworkError } from "./errors"
import { parseSseStream } from "./sse"
import type { ChatRequest, ProviderConfig, StreamCallbacks } from "./types"

export interface IProvider {
  complete(req: ChatRequest, apiKey: string, modelId: string): Promise<{ text: string; totalMs: number }>
  stream(req: ChatRequest, apiKey: string, modelId: string, cb: StreamCallbacks, signal: AbortSignal): Promise<void>
  testConnection(apiKey: string): Promise<{ ok: boolean; error?: ApiError }>
}

function retryAfterMs(headers: Headers): number | undefined {
  const v = headers.get("retry-after")
  if (!v) return undefined
  const n = Number(v)
  return Number.isFinite(n) ? Math.round(n * 1000) : undefined
}

export function createOpenAICompatible(cfg: ProviderConfig): IProvider {
  const base = cfg.baseUrl.replace(/\/+$/, "")

  async function chatRequest(req: ChatRequest, apiKey: string, modelId: string, stream: boolean, signal?: AbortSignal) {
    const messages = req.messages.map((m) => ({
      role: m.role,
      content: m.images?.length
        ? [
            { type: "text", text: m.content },
            ...m.images.map((i) => ({ type: "image_url", image_url: { url: `data:${i.mimeType};base64,${i.base64}` } })),
          ]
        : m.content,
    }))
    return fetch(`${base}/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({ model: modelId, messages, stream }),
      signal,
    })
  }

  return {
    async complete(req, apiKey, modelId) {
      const start = performance.now()
      try {
        const res = await chatRequest(req, apiKey, modelId, false)
        if (!res.ok) {
          const body = await res.text()
          throw normalizeHttpStatus(res.status, body, retryAfterMs(res.headers))
        }
        const data = await res.json()
        const text: string = data?.choices?.[0]?.message?.content ?? ""
        return { text, totalMs: performance.now() - start }
      } catch (e) {
        if (e instanceof ApiError) throw e
        throw normalizeNetworkError(e)
      }
    },

    async stream(req, apiKey, modelId, cb, signal) {
      const start = performance.now()
      let firstTokenMs = 0
      let acc = ""
      let reader: ReadableStreamDefaultReader<Uint8Array> | null = null
      try {
        const res = await chatRequest(req, apiKey, modelId, true, signal)
        if (!res.ok) {
          const body = await res.text()
          throw normalizeHttpStatus(res.status, body, retryAfterMs(res.headers))
        }
        if (!res.body) throw new ApiError("unknown", "Réponse vide du fournisseur")
        reader = res.body.getReader()
        await parseSseStream(reader, (chunk) => {
          if (chunk.data === "[DONE]") return
          // Ligne non-JSON (keep-alive restant, commentaire SSE) : ignorée définitivement.
          // Note critère 5 bis : si le consommateur throw dans onDelta, l'exception
          // est absorbée par le catch global ci-dessous → onError (comportement documenté).
          try {
            const json = JSON.parse(chunk.data)
            const delta: string = json?.choices?.[0]?.delta?.content ?? ""
            if (delta) {
              if (!firstTokenMs) {
                firstTokenMs = performance.now() - start
                cb.onFirstToken?.()
              }
              acc += delta
              cb.onDelta?.(delta)
            }
          } catch {
            /* ignoré : ligne non-JSON (keep-alive, commentaire SSE) */
          }
        })
      } catch (e: unknown) {
        // Critère 1 : erreurs réseau normalisées ; critère 5 : abort passthrough
        if (e instanceof ApiError) cb.onError?.(e)
        else if (e instanceof Error && e.name === "AbortError") cb.onError?.(e)
        else cb.onError?.(normalizeNetworkError(e))
        return
      } finally {
        // Critère 5 : libérer le reader si on a décroché en cours
        // (cancel sur un stream déjà consommé = no-op sûr)
        if (reader) reader.cancel().catch(() => {})
      }
      // Critère 5 bis : onDone hors du try/catch — si le consommateur throw dans
      // onDone, l'exception remonte au consommateur sans déclencher onError
      // (pas de onError après un onDone partiel).
      cb.onDone?.({ text: acc, firstTokenMs, totalMs: performance.now() - start })
    },

    async testConnection(apiKey) {
      try {
        const res = await fetch(`${base}/models`, { headers: { Authorization: `Bearer ${apiKey}` } })
        if (!res.ok) {
          const body = await res.text()
          return { ok: false, error: normalizeHttpStatus(res.status, body, retryAfterMs(res.headers)) }
        }
        return { ok: true }
      } catch (e) {
        return { ok: false, error: normalizeNetworkError(e) as ApiError }
      }
    },
  }
}

export function createProvider(cfg: ProviderConfig): IProvider {
  if (cfg.apiFamily === "gemini") {
    throw new Error(
      "L'adaptateur Google Gemini arrive en V2 (Plan 2). Utilisez un fournisseur openai-compatible pour le moment.",
    )
  }
  return createOpenAICompatible(cfg)
}

export function buildPreview(providerName: string, modelLabel: string): string {
  return `${providerName} › ${modelLabel}`
}
