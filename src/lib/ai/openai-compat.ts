import { isTauri } from "@tauri-apps/api/core"
import { fetch as tauriFetch } from "@tauri-apps/plugin-http"
import { ApiError, normalizeHttpStatus, normalizeNetworkError } from "./errors"
import { logger } from "../logger"
import { parseSseStream } from "./sse"
import type { ChatRequest, ProviderConfig, StreamCallbacks } from "./types"

// fetch passe par le backend Rust via tauri-plugin-http quand on est dans Tauri :
// la webview n'est pas soumise au CORS (certains fournisseurs ex. NVIDIA NIM
// ne renvoient pas Access-Control-Allow-Origin). En test/node : fetch natif,
// stubbable via vi.stubGlobal("fetch") — résolu à l'APPEL, pas à l'import, pour
// que les stubs posés après le chargement du module soient honorés.
function getFetch(): typeof globalThis.fetch {
  return (isTauri() ? (tauriFetch as unknown as typeof globalThis.fetch) : globalThis.fetch) ??
    globalThis.fetch
}

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
  // Nettoie l'URL de base : retire trailing slashes ET chemins API connus (/models, /chat/completions, etc.)
  const base = cfg.baseUrl.replace(/\/+$/, "").replace(/\/(models|chat\/completions|v1\/models)$/, "")

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
    return getFetch()(`${base}/chat/completions`, {
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
          let json: unknown
          try {
            // Ligne non-JSON (keep-alive restant, commentaire SSE) : ignorée définitivement.
            // Try séparé : SEUL le parse JSON est absorbé — un throw du consommateur
            // dans onDelta/onFirstToken remonte au catch global → onError, stream interrompu.
            json = JSON.parse(chunk.data)
          } catch {
            return
          }
          const delta: string =
            (json as { choices?: { delta?: { content?: string } }[] })?.choices?.[0]?.delta?.content ?? ""
          if (delta) {
            if (!firstTokenMs) {
              firstTokenMs = performance.now() - start
              cb.onFirstToken?.()
            }
            acc += delta
            cb.onDelta?.(delta)
          }
        })
      } catch (e: unknown) {
        // Critère 1 : erreurs réseau normalisées ; critère 5 : abort passthrough
        // (abort natif = AbortError ; plugin Tauri = message "Request cancelled")
        if (e instanceof ApiError) await cb.onError?.(e)
        else if (e instanceof Error && (e.name === "AbortError" || e.message === "Request cancelled")) await cb.onError?.(e)
        else await cb.onError?.(normalizeNetworkError(e))
        return
      } finally {
        // Critère 5 : libérer le reader si on a décroché en cours
        // (cancel sur un stream déjà consommé = no-op sûr)
        if (reader) reader.cancel().catch(() => {})
      }
      // Critère 5 bis : onDone hors du try/catch — si le consommateur throw dans
      // onDone, l'exception remonte au consommateur sans déclencher onError
      // (pas de onError après un onDone partiel).
      await cb.onDone?.({ text: acc, firstTokenMs, totalMs: performance.now() - start })
    },

    async testConnection(apiKey) {
      try {
        // Try /models first (standard OpenAI)
        const res = await getFetch()(`${base}/models`, { headers: { Authorization: `Bearer ${apiKey}` } })
        if (res.ok) {
          return { ok: true }
        }
        // If /models fails (404, 405, etc.), try a minimal chat completion as fallback
        // Some OpenAI-compatible APIs (like NVIDIA NIM) don't implement /models
        const bodyText = await res.text()
        logger.debug("[testConnection] /models failed:", res.status, bodyText.slice(0, 200))
        
        // Fallback: try a minimal completion request
        const testRes = await getFetch()(`${base}/chat/completions`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
          body: JSON.stringify({ model: "test", messages: [{ role: "user", content: "test" }], max_tokens: 1 }),
        })
        if (testRes.ok || testRes.status === 400) {
          // 400 = bad request (model not found) but auth worked
          // 401/403 = auth error
          // 404 = endpoint not found
          if (testRes.status === 401 || testRes.status === 403) {
            const body = await testRes.text()
            return { ok: false, error: normalizeHttpStatus(testRes.status, body, retryAfterMs(testRes.headers)) }
          }
          return { ok: true }
        }
        const body = await testRes.text()
        return { ok: false, error: normalizeHttpStatus(testRes.status, body, retryAfterMs(testRes.headers)) }
      } catch (e) {
        console.error("[testConnection] network error:", e)
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
