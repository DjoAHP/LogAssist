import { ApiError, normalizeHttpStatus, normalizeNetworkError } from "./errors"
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
      try {
        const res = await chatRequest(req, apiKey, modelId, true, signal)
        if (!res.ok) {
          const body = await res.text()
          throw normalizeHttpStatus(res.status, body, retryAfterMs(res.headers))
        }
        if (!res.body) throw new ApiError("unknown", "Réponse vide du fournisseur")
        const reader = res.body.getReader()
        const decoder = new TextDecoder()
        let buf = ""
        for (;;) {
          const { done, value } = await reader.read()
          if (done) break
          buf += decoder.decode(value, { stream: true })
          const lines = buf.split("\n")
          buf = lines.pop() ?? ""
          for (const line of lines) {
            const clean = line.replace(/^data: /, "").trim()
            if (!clean || clean === "[DONE]") continue
            try {
              const chunk = JSON.parse(clean)
              const delta: string = chunk?.choices?.[0]?.delta?.content ?? ""
              if (delta) {
                if (!firstTokenMs) {
                  firstTokenMs = performance.now() - start
                  cb.onFirstToken?.()
                }
                acc += delta
                cb.onDelta?.(delta)
              }
            } catch {
              // ligne partielle ignorée — sera complétée par le buffer au prochain read
            }
          }
        }
        cb.onDone?.({ text: acc, firstTokenMs, totalMs: performance.now() - start })
      } catch (e: unknown) {
        cb.onError?.(e instanceof Error ? e : new Error(String(e)))
      }
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
