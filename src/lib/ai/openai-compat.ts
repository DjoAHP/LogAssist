import { isTauri } from "@tauri-apps/api/core"
import { fetch as tauriFetch } from "@tauri-apps/plugin-http"
import {
  ApiError,
  normalizeHttpStatus,
  normalizeNetworkError,
  redactSensitiveDetail,
} from "./errors"
import { cleanApiBaseUrl } from "./url"
import { logger } from "../logger"
import { parseSseStream } from "./sse"
import type {
  ChatMessage,
  ChatRequest,
  ProviderConfig,
  StreamCallbacks,
  TokenUsage,
  ToolCall,
  TurnCallbacks,
  TurnOptions,
  TurnResult,
} from "./types"

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
  runTurn(
    req: ChatRequest,
    apiKey: string,
    modelId: string,
    options: TurnOptions,
    callbacks: TurnCallbacks,
    signal: AbortSignal,
  ): Promise<TurnResult>
  stream(req: ChatRequest, apiKey: string, modelId: string, cb: StreamCallbacks, signal: AbortSignal): Promise<void>
  testConnection(apiKey: string): Promise<{ ok: boolean; error?: ApiError }>
  // Récupération des modèles annoncés par le fournisseur (GET /models)
  listRemoteModels(apiKey: string): Promise<string[]>
}

function retryAfterMs(headers: Headers): number | undefined {
  const v = headers.get("retry-after")
  if (!v) return undefined
  const n = Number(v)
  return Number.isFinite(n) ? Math.round(n * 1000) : undefined
}

function parseTokenUsage(value: unknown): TokenUsage | undefined {
  if (typeof value !== "object" || value === null) return undefined
  const usage = (value as {
    usage?: { prompt_tokens?: unknown; completion_tokens?: unknown }
  }).usage
  const input = usage?.prompt_tokens
  const output = usage?.completion_tokens
  if (
    !Number.isSafeInteger(input) ||
    !Number.isSafeInteger(output) ||
    (input as number) < 0 ||
    (output as number) < 0
  ) {
    return undefined
  }
  return { inputTokens: input as number, outputTokens: output as number }
}

function sanitizeApiError(error: ApiError, apiKey: string): ApiError {
  return new ApiError(
    error.kind,
    redactSensitiveDetail(error.message, [apiKey]),
    error.detail === undefined
      ? undefined
      : redactSensitiveDetail(error.detail, [apiKey]),
    error.retryAfterMs,
  )
}

function sanitizeBody(body: string, apiKey: string): string {
  return redactSensitiveDetail(body, [apiKey])
}

function isAbortError(error: unknown): error is Error {
  return error instanceof Error &&
    (error.name === "AbortError" || error.message === "Request cancelled")
}

function sanitizeAbortError(error: Error, apiKey: string): Error {
  const redactedMessage = redactSensitiveDetail(error.message, [apiKey])
  const sanitized = new Error(
    redactedMessage.trim().length > 0 ? redactedMessage : "Request cancelled",
  )
  sanitized.name = "AbortError"
  return sanitized
}

function sanitizeAdapterError(error: unknown, apiKey: string): Error {
  if (isAbortError(error)) return sanitizeAbortError(error, apiKey)

  const normalized = error instanceof ApiError ? error : normalizeNetworkError(error)
  if (normalized instanceof ApiError) return sanitizeApiError(normalized, apiKey)

  const message = redactSensitiveDetail(normalized.message, [apiKey])
  return new Error(message)
}

function normalizeSanitizedHttpStatus(
  status: number,
  rawBody: string,
  apiKey: string,
  retryAfter?: number,
): ApiError {
  const classified = normalizeHttpStatus(status, rawBody, retryAfter)
  const safeBody = sanitizeBody(rawBody, apiKey)
  return new ApiError(
    classified.kind,
    classified.message,
    safeBody.slice(0, 500) || undefined,
    classified.retryAfterMs,
  )
}

export function createOpenAICompatible(cfg: ProviderConfig): IProvider {
  // Nettoie l'URL via le helper partagé avec le formulaire — invariant unique.
  const base = cleanApiBaseUrl(cfg.baseUrl)

  function toOpenAiMessage(message: ChatMessage): Record<string, unknown> {
    const content = message.images?.length
      ? [
          { type: "text", text: message.content },
          ...message.images.map((image) => ({
            type: "image_url",
            image_url: { url: `data:${image.mimeType};base64,${image.base64}` },
          })),
        ]
      : message.content
    const wire: Record<string, unknown> = { role: message.role, content }
    if (message.role === "tool" && message.toolCallId) {
      wire.tool_call_id = message.toolCallId
    }
    if (message.role === "assistant" && message.toolCalls?.length) {
      wire.tool_calls = message.toolCalls.map((call) => ({
        id: call.id,
        type: "function",
        function: { name: call.name, arguments: JSON.stringify(call.arguments) },
      }))
    }
    return wire
  }

  async function chatRequest(
    req: ChatRequest,
    apiKey: string,
    modelId: string,
    stream: boolean,
    signal?: AbortSignal,
    options: TurnOptions = {},
  ) {
    const body: Record<string, unknown> = {
      model: modelId,
      messages: req.messages.map(toOpenAiMessage),
      stream,
    }
    if (options.tools !== undefined) body.tools = options.tools
    if (options.toolChoice !== undefined) body.tool_choice = options.toolChoice
    return getFetch()(`${base}/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify(body),
      signal,
    })
  }

  async function runTurn(
    req: ChatRequest,
    apiKey: string,
    modelId: string,
    options: TurnOptions,
    callbacks: TurnCallbacks,
    signal: AbortSignal,
  ): Promise<TurnResult> {
    const start = performance.now()
    let firstTokenMs = 0
    let text = ""
    let usage: TokenUsage | undefined
    let reader: ReadableStreamDefaultReader<Uint8Array> | null = null
    const pendingCalls = new Map<number, { id: string; name: string; arguments: string }>()

    try {
      const res = await chatRequest(req, apiKey, modelId, true, signal, options)
      if (!res.ok) {
        const body = await res.text()
        throw normalizeSanitizedHttpStatus(
          res.status,
          body,
          apiKey,
          retryAfterMs(res.headers),
        )
      }
      if (!res.body) throw new ApiError("unknown", "Réponse vide du fournisseur")
      reader = res.body.getReader()
      await parseSseStream(reader, (chunk) => {
        if (chunk.data === "[DONE]") return
        let json: unknown
        try {
          json = JSON.parse(chunk.data)
        } catch {
          return
        }
        const parsedUsage = parseTokenUsage(json)
        if (parsedUsage) usage = parsedUsage
        const delta = (json as {
          choices?: {
            delta?: {
              content?: string
              tool_calls?: {
                index: number
                id?: string
                function?: { name?: string; arguments?: string }
              }[]
            }
          }[]
        })?.choices?.[0]?.delta
        const content = delta?.content ?? ""
        const toolDeltas = delta?.tool_calls ?? []
        if (!firstTokenMs && (content || toolDeltas.length > 0)) {
          firstTokenMs = performance.now() - start
          callbacks.onFirstToken?.()
        }
        if (content) {
          text += content
          callbacks.onDelta?.(content)
        }
        for (const toolDelta of toolDeltas) {
          const current = pendingCalls.get(toolDelta.index) ?? {
            id: "",
            name: "",
            arguments: "",
          }
          if (toolDelta.id) current.id = toolDelta.id
          if (toolDelta.function?.name) current.name += toolDelta.function.name
          if (toolDelta.function?.arguments) current.arguments += toolDelta.function.arguments
          pendingCalls.set(toolDelta.index, current)
        }
      })

      const toolCalls: ToolCall[] = [...pendingCalls.entries()]
        .sort(([left], [right]) => left - right)
        .map(([, call]) => {
          let parsed: unknown
          try {
            parsed = JSON.parse(call.arguments || "{}")
          } catch {
            throw new ApiError("unknown", "Arguments d'appel d'outil invalides")
          }
          if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
            throw new ApiError("unknown", "Arguments d'appel d'outil invalides")
          }
          return { id: call.id, name: call.name, arguments: parsed as Record<string, unknown> }
        })

      return {
        text,
        toolCalls,
        firstTokenMs,
        totalMs: performance.now() - start,
        ...(usage ? { usage } : {}),
      }
    } catch (error) {
      throw sanitizeAdapterError(error, apiKey)
    } finally {
      if (reader) reader.cancel().catch(() => {})
    }
  }

  return {
    async complete(req, apiKey, modelId) {
      const start = performance.now()
      try {
        const res = await chatRequest(req, apiKey, modelId, false)
        if (!res.ok) {
          const body = await res.text()
          throw normalizeSanitizedHttpStatus(
            res.status,
            body,
            apiKey,
            retryAfterMs(res.headers),
          )
        }
        const data = await res.json()
        const text: string = data?.choices?.[0]?.message?.content ?? ""
        return { text, totalMs: performance.now() - start }
      } catch (e) {
        throw sanitizeAdapterError(e, apiKey)
      }
    },

    runTurn,

    async stream(req, apiKey, modelId, cb, signal) {
      let result: TurnResult
      try {
        result = await runTurn(req, apiKey, modelId, {}, cb, signal)
      } catch (error: unknown) {
        await cb.onError?.(sanitizeAdapterError(error, apiKey))
        return
      }
      await cb.onDone?.(result)
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
        const rawBodyText = await res.text()
        const bodyText = sanitizeBody(rawBodyText, apiKey)
        logger.debug({
          context: "testConnection.models",
          status: res.status,
          detail: bodyText.slice(0, 200),
        })
        
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
            return {
              ok: false,
              error: normalizeSanitizedHttpStatus(
                testRes.status,
                body,
                apiKey,
                retryAfterMs(testRes.headers),
              ),
            }
          }
          return { ok: true }
        }
        const body = await testRes.text()
        return {
          ok: false,
          error: normalizeSanitizedHttpStatus(
            testRes.status,
            body,
            apiKey,
            retryAfterMs(testRes.headers),
          ),
        }
      } catch (e) {
        const error = sanitizeAdapterError(e, apiKey)
        if (!(error instanceof ApiError)) throw error
        logger.error({
          context: "testConnection.network",
          message: error.message,
        })
        return { ok: false, error }
      }
    },

    async listRemoteModels(apiKey) {
      try {
        const res = await getFetch()(`${base}/models`, { headers: { Authorization: `Bearer ${apiKey}` } })
        if (!res.ok) {
          const body = await res.text()
          throw normalizeSanitizedHttpStatus(
            res.status,
            body,
            apiKey,
            retryAfterMs(res.headers),
          )
        }
        const data = await res.json()
        const list: { id?: string }[] = data?.data ?? []
        return list.map((m) => m.id).filter((id): id is string => typeof id === "string" && id.length > 0)
      } catch (e) {
        throw sanitizeAdapterError(e, apiKey)
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
