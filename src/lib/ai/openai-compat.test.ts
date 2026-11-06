import { afterEach, describe, expect, it, vi } from "vitest"
import { ApiError } from "./errors"
import { buildPreview, createOpenAICompatible, createProvider } from "./openai-compat"
import type { ChatRequest, ProviderConfig, ToolDefinition } from "./types"

const loggerDebugMock = vi.hoisted(() => vi.fn())
const loggerErrorMock = vi.hoisted(() => vi.fn())

vi.mock("../logger", () => ({
  logger: { debug: loggerDebugMock, error: loggerErrorMock },
}))

const CFG: ProviderConfig = {
  id: "prov-openrouter",
  name: "OpenRouter",
  apiFamily: "openai",
  baseUrl: "https://openrouter.ai/api/v1/",
  secretRef: "openrouter.key",
}

const OFFICIAL_OPENAI_CFG: ProviderConfig = {
  ...CFG,
  id: "prov-openai",
  name: "OpenAI",
  baseUrl: "https://api.openai.com/v1",
  secretRef: "openai.key",
}

const BOUNDARY_API_KEY = "CUSTOM.alpha+42/=OMEGA.beta-99"
const BOUNDARY_API_KEY_MIDDLE = Math.floor(BOUNDARY_API_KEY.length / 2)
const BOUNDARY_API_KEY_FIRST_HALF = BOUNDARY_API_KEY.slice(0, BOUNDARY_API_KEY_MIDDLE)
const BOUNDARY_API_KEY_SECOND_HALF = BOUNDARY_API_KEY.slice(BOUNDARY_API_KEY_MIDDLE)

function makeRes(overrides: {
  ok?: boolean
  status?: number
  text?: string
  json?: unknown
  body?: ReadableStream | null
  headers?: Headers
}): Response {
  const { ok = true, status = 200, text = "", json, body = null, headers = new Headers() } = overrides
  return {
    ok,
    status,
    text: () => Promise.resolve(text),
    json: () => Promise.resolve(json),
    body,
    headers,
  } as unknown as Response
}

function sseStream(chunks: string[]): ReadableStream {
  const enc = new TextEncoder()
  return new ReadableStream({
    start(controller) {
      for (const c of chunks) controller.enqueue(enc.encode(c))
      controller.close()
    },
  })
}

// Format SSE standard : chaque événement est terminé par une ligne vide ("\n\n")
const SSE = "\n\n"

function sseData(data: unknown): string {
  return `data: ${JSON.stringify(data)}${SSE}`
}

const TEST_TOOLS: ToolDefinition[] = [
  {
    type: "function",
    function: {
      name: "search",
      description: "Recherche Web",
      parameters: {
        type: "object",
        properties: { query: { type: "string" } },
        required: ["query"],
      },
    },
  },
]

describe("createOpenAICompatible — listRemoteModels", () => {
  it("GET /models avec Bearer key, extrait data[].id (les entrées sans id sont filtrées)", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      makeRes({ json: { data: [{ id: "openai/gpt-4o" }, { id: "m/b" }, {}] } }),
    )
    vi.stubGlobal("fetch", fetchMock)
    const adapter = createOpenAICompatible(CFG)
    const ids = await adapter.listRemoteModels("KEY-123")
    expect(ids).toEqual(["openai/gpt-4o", "m/b"])
    const [url, init] = fetchMock.mock.calls[0]
    expect(String(url)).toContain("/models")
    expect(init.headers.Authorization).toBe("Bearer KEY-123")
  })

  it("statut non-OK → ApiError normalisée (auth pour 401)", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(makeRes({ ok: false, status: 401, text: "bad key" })))
    const adapter = createOpenAICompatible(CFG)
    await expect(adapter.listRemoteModels("KEY-123")).rejects.toMatchObject({ kind: "auth" })
  })

  it("Erreur réseau → ApiError normalisée (kind network)", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("fetch failed")))
    const adapter = createOpenAICompatible(CFG)
    await expect(adapter.listRemoteModels("KEY-123")).rejects.toMatchObject({ kind: "network" })
  })

  it("redacte la clé exacte d'un rejet réseau avant propagation", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(
      new Error(`Credential ${BOUNDARY_API_KEY} rejected`),
    ))

    let caught: unknown
    try {
      await createOpenAICompatible(CFG).listRemoteModels(BOUNDARY_API_KEY)
    } catch (error) {
      caught = error
    }

    const serialized = JSON.stringify({
      message: (caught as Error).message,
      detail: (caught as ApiError).detail,
      stack: (caught as Error).stack,
    })
    expect(serialized).not.toContain(BOUNDARY_API_KEY)
    expect(serialized).toContain("[REDACTED]")
  })

  it("data manquante → liste vide", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(makeRes({ json: {} })))
    const adapter = createOpenAICompatible(CFG)
    await expect(adapter.listRemoteModels("KEY-123")).resolves.toEqual([])
  })

  it("baseUrl collée avec suffixe /v1/models : le /v1 est préservé dans l'appel GET", async () => {
    const fetchMock = vi.fn().mockResolvedValue(makeRes({ json: { data: [] } }))
    vi.stubGlobal("fetch", fetchMock)
    const adapter = createOpenAICompatible({ ...CFG, baseUrl: "https://exemple.ai/api/v1/models" })
    await adapter.listRemoteModels("KEY-123")
    expect(String(fetchMock.mock.calls[0][0]).includes("/api/v1/models")).toBe(true)
  })
})

afterEach(() => {
  vi.unstubAllGlobals()
  loggerDebugMock.mockReset()
  loggerErrorMock.mockReset()
})

describe("createOpenAICompatible — complete", () => {
  it("POST /chat/completions avec model, messages, Bearer key ; extrait choices[0].message.content", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      makeRes({ json: { choices: [{ message: { content: "Salut !" } }] } }),
    )
    vi.stubGlobal("fetch", fetchMock)

    const adapter = createOpenAICompatible(CFG)
    const req: ChatRequest = { messages: [{ role: "user", content: "Bonjour" }] }
    const out = await adapter.complete(req, "KEY-123", "gpt-4o-mini")

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe("https://openrouter.ai/api/v1/chat/completions")
    expect(init.method).toBe("POST")
    expect(init.headers["Content-Type"]).toBe("application/json")
    expect(init.headers.Authorization).toBe("Bearer KEY-123")
    const body = JSON.parse(init.body)
    expect(body.model).toBe("gpt-4o-mini")
    expect(body.messages).toEqual([{ role: "user", content: "Bonjour" }])
    expect(out.text).toBe("Salut !")
    expect(out.totalMs).toBeGreaterThanOrEqual(0)
  })

  it("n'envoie pas stream_options pour une requête non stream officielle", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      makeRes({ json: { choices: [{ message: { content: "Salut !" } }] } }),
    )
    vi.stubGlobal("fetch", fetchMock)

    await createOpenAICompatible(OFFICIAL_OPENAI_CFG).complete(
      { messages: [{ role: "user", content: "Bonjour" }] },
      "KEY-123",
      "gpt-4o-mini",
    )

    const body = JSON.parse(fetchMock.mock.calls[0][1].body)
    expect(body.stream).toBe(false)
    expect(body).not.toHaveProperty("stream_options")
  })

  it("complete avec images : content devient array text + image_url en data URI", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      makeRes({ json: { choices: [{ message: { content: "vu" } }] } }),
    )
    vi.stubGlobal("fetch", fetchMock)

    const adapter = createOpenAICompatible(CFG)
    const req: ChatRequest = {
      messages: [
        {
          role: "user",
          content: "Décris",
          images: [{ base64: "AAA", mimeType: "image/png" }],
        },
      ],
    }
    await adapter.complete(req, "K", "m")
    const body = JSON.parse(fetchMock.mock.calls[0][1].body)
    expect(body.messages[0].content).toEqual([
      { type: "text", text: "Décris" },
      { type: "image_url", image_url: { url: "data:image/png;base64,AAA" } },
    ])
  })

  it("401 → ApiError kind auth", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(makeRes({ ok: false, status: 401, text: "{}" })))
    const adapter = createOpenAICompatible(CFG)
    const req: ChatRequest = { messages: [{ role: "user", content: "hi" }] }
    await expect(adapter.complete(req, "BAD", "m")).rejects.toMatchObject({
      name: "ApiError",
      kind: "auth",
    })
  })

  it("redacte le body avant normalisation d'une erreur HTTP métier", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(makeRes({
      ok: false,
      status: 401,
      text: `Credential ${BOUNDARY_API_KEY} was rejected`,
    })))
    const adapter = createOpenAICompatible(CFG)
    const req: ChatRequest = { messages: [{ role: "user", content: "hi" }] }

    let caught: unknown
    try {
      await adapter.complete(req, BOUNDARY_API_KEY, "m")
    } catch (error) {
      caught = error
    }

    expect(caught).toBeInstanceOf(ApiError)
    const apiError = caught as ApiError
    const serializedError = JSON.stringify({
      message: apiError.message,
      detail: apiError.detail,
    })
    expect(serializedError).not.toContain(BOUNDARY_API_KEY)
    expect(serializedError).not.toContain(BOUNDARY_API_KEY_FIRST_HALF)
    expect(serializedError).not.toContain(BOUNDARY_API_KEY_SECOND_HALF)
    expect(serializedError).toContain("[REDACTED]")
  })

  it("429 + retry-after: 0.8 → ApiError rate_limit retryAfterMs 800", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        makeRes({
          ok: false,
          status: 429,
          text: "{}",
          headers: new Headers({ "retry-after": "0.8" }),
        }),
      ),
    )
    const adapter = createOpenAICompatible(CFG)
    const req: ChatRequest = { messages: [{ role: "user", content: "hi" }] }
    await expect(adapter.complete(req, "K", "m")).rejects.toMatchObject({
      kind: "rate_limit",
      retryAfterMs: 800,
    })
  })

  it("429 body insufficient_quota → kind quota", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(makeRes({ ok: false, status: 429, text: "insufficient_quota" })),
    )
    const adapter = createOpenAICompatible(CFG)
    const req: ChatRequest = { messages: [{ role: "user", content: "hi" }] }
    await expect(adapter.complete(req, "K", "m")).rejects.toMatchObject({ kind: "quota" })
  })

  it("classifie le quota sur le body brut mais retourne un détail Authorization sûr", async () => {
    const body = 'Authorization: Digest username="admin", nonce="abc"; response="deadbeef"\ninsufficient_quota'
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(
      makeRes({ ok: false, status: 429, text: body }),
    ))

    let caught: unknown
    try {
      await createOpenAICompatible(CFG).complete(
        { messages: [{ role: "user", content: "hi" }] },
        "K",
        "m",
      )
    } catch (error) {
      caught = error
    }

    expect(caught).toMatchObject({ kind: "quota" })
    expect((caught as ApiError).detail).toContain("insufficient_quota")
    expect((caught as ApiError).detail).not.toContain("nonce")
    expect((caught as ApiError).detail).not.toContain("response")
  })

  it("classifie une erreur image sur le body brut mais retourne un détail sûr", async () => {
    const body = 'Authorization: Digest nonce="abc", response="deadbeef"\nimage input unsupported'
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(
      makeRes({ ok: false, status: 400, text: body }),
    ))

    let caught: unknown
    try {
      await createOpenAICompatible(CFG).complete(
        { messages: [{ role: "user", content: "hi" }] },
        "K",
        "m",
      )
    } catch (error) {
      caught = error
    }

    expect(caught).toMatchObject({ kind: "image_unsupported" })
    expect((caught as ApiError).detail).toContain("image input unsupported")
    expect((caught as ApiError).detail).not.toContain("nonce")
    expect((caught as ApiError).detail).not.toContain("response")
  })

  it("500 → kind unavailable", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(makeRes({ ok: false, status: 500, text: "oops" })))
    const adapter = createOpenAICompatible(CFG)
    const req: ChatRequest = { messages: [{ role: "user", content: "hi" }] }
    await expect(adapter.complete(req, "K", "m")).rejects.toMatchObject({ kind: "unavailable" })
  })

  it("fetch rejeté (fetch failed) → ApiError kind network", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("fetch failed")))
    const adapter = createOpenAICompatible(CFG)
    const req: ChatRequest = { messages: [{ role: "user", content: "hi" }] }
    await expect(adapter.complete(req, "K", "m")).rejects.toMatchObject({
      name: "ApiError",
      kind: "network",
    })
  })

  it("redacte la clé exacte d'un rejet réseau complete", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(
      new Error(`Credential ${BOUNDARY_API_KEY} rejected`),
    ))

    let caught: unknown
    try {
      await createOpenAICompatible(CFG).complete(
        { messages: [{ role: "user", content: "hi" }] },
        BOUNDARY_API_KEY,
        "m",
      )
    } catch (error) {
      caught = error
    }

    const serialized = JSON.stringify({
      message: (caught as Error).message,
      detail: (caught as ApiError).detail,
      stack: (caught as Error).stack,
    })
    expect(serialized).not.toContain(BOUNDARY_API_KEY)
    expect(serialized).toContain("[REDACTED]")
  })
})

describe("createOpenAICompatible — stream", () => {
  it("chunks SSE → onFirstToken 1×, onDelta 2×, onDone text 'Bonjour', pas onError", async () => {
    const stream = sseStream([
      `data: {"choices":[{"delta":{"content":"Bonj"}}]}${SSE}`,
      `data: {"choices":[{"delta":{"content":"our"}}]}${SSE}`,
      `data: [DONE]${SSE}`,
    ])
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(makeRes({ body: stream })))

    const onFirstToken = vi.fn()
    const onDelta = vi.fn()
    const onDone = vi.fn()
    const onError = vi.fn()
    const adapter = createOpenAICompatible(CFG)
    const req: ChatRequest = { messages: [{ role: "user", content: "hi" }] }

    await adapter.stream(req, "K", "m", { onFirstToken, onDelta, onDone, onError }, new AbortController().signal)

    expect(onFirstToken).toHaveBeenCalledTimes(1)
    expect(onDelta).toHaveBeenCalledTimes(2)
    expect(onDelta).toHaveBeenNthCalledWith(1, "Bonj")
    expect(onDelta).toHaveBeenNthCalledWith(2, "our")
    expect(onDone).toHaveBeenCalledTimes(1)
    expect(onDone).toHaveBeenCalledWith(expect.objectContaining({ text: "Bonjour" }))
    expect(onError).not.toHaveBeenCalled()
  })

  it("stream erreur HTTP 401 → onError ApiError kind auth, pas onDone", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(makeRes({ ok: false, status: 401, text: "{}" })))

    const onDone = vi.fn()
    const onError = vi.fn()
    const adapter = createOpenAICompatible(CFG)
    const req: ChatRequest = { messages: [{ role: "user", content: "hi" }] }

    await adapter.stream(req, "BAD", "m", { onDone, onError }, new AbortController().signal)

    expect(onDone).not.toHaveBeenCalled()
    expect(onError).toHaveBeenCalledTimes(1)
    const err = onError.mock.calls[0][0]
    expect(err).toBeInstanceOf(ApiError)
    expect(err.kind).toBe("auth")
  })

  it("stream fetch rejeté (fetch failed) → onError ApiError kind network (critère 1)", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("fetch failed")))

    const onDone = vi.fn()
    const onError = vi.fn()
    const adapter = createOpenAICompatible(CFG)
    const req: ChatRequest = { messages: [{ role: "user", content: "hi" }] }

    await adapter.stream(req, "K", "m", { onDone, onError }, new AbortController().signal)

    expect(onDone).not.toHaveBeenCalled()
    expect(onError).toHaveBeenCalledTimes(1)
    const err = onError.mock.calls[0][0]
    expect(err).toBeInstanceOf(ApiError)
    expect(err.kind).toBe("network")
  })

  it("stream transmet à onError une erreur réseau sans la clé exacte", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(
      new Error(`Credential ${BOUNDARY_API_KEY} rejected`),
    ))
    const onError = vi.fn()

    await createOpenAICompatible(CFG).stream(
      { messages: [{ role: "user", content: "hi" }] },
      BOUNDARY_API_KEY,
      "m",
      { onError },
      new AbortController().signal,
    )

    const error = onError.mock.calls[0][0] as ApiError
    const serialized = JSON.stringify({
      message: error.message,
      detail: error.detail,
      stack: error.stack,
    })
    expect(serialized).not.toContain(BOUNDARY_API_KEY)
    expect(serialized).toContain("[REDACTED]")
  })

  it("stream : un throw du consommateur dans onDelta → onError (pas d'absorption silencieuse)", async () => {
    const stream = sseStream([
      `data: {"choices":[{"delta":{"content":"un"}}]}${SSE}`,
      `data: {"choices":[{"delta":{"content":"deux"}}]}${SSE}`,
    ])
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(makeRes({ body: stream })))

    let calls = 0
    const onFirstToken = vi.fn()
    const onDelta = vi.fn(() => {
      calls++
      if (calls === 2) throw new Error("boom consommateur")
    })
    const onDone = vi.fn()
    const onError = vi.fn()
    const adapter = createOpenAICompatible(CFG)
    const req: ChatRequest = { messages: [{ role: "user", content: "hi" }] }

    await adapter.stream(req, "K", "m", { onFirstToken, onDelta, onDone, onError }, new AbortController().signal)

    expect(onDelta).toHaveBeenCalledTimes(2)
    expect(onDone).not.toHaveBeenCalled()
    expect(onError).toHaveBeenCalledTimes(1)
    const err = onError.mock.calls[0][0]
    expect(err).toBeInstanceOf(ApiError)
    expect(err.kind).toBe("unknown")
    expect(err.detail).toBe("boom consommateur")
  })

  it("stream : un throw du consommateur dans onDone → rejection à l'appelant, onError JAMAIS appelé (critère 5 bis)", async () => {
    const stream = sseStream([
      `data: {"choices":[{"delta":{"content":"un"}}]}${SSE}`,
      `data: {"choices":[{"delta":{"content":"deux"}}]}${SSE}`,
    ])
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(makeRes({ body: stream })))

    const onDelta = vi.fn()
    const onDone = vi.fn(() => {
      throw new Error("boom onDone")
    })
    const onError = vi.fn()
    const adapter = createOpenAICompatible(CFG)
    const req: ChatRequest = { messages: [{ role: "user", content: "hi" }] }

    await expect(
      adapter.stream(req, "K", "m", { onDelta, onDone, onError }, new AbortController().signal),
    ).rejects.toThrow("boom onDone")
    expect(onDelta).toHaveBeenCalledTimes(2)
    expect(onError).not.toHaveBeenCalled()
  })

  it("stream aborté → onError avec AbortError (pas ApiError)", async () => {
    const controller = new AbortController()
    const abortErr = new DOMException(
      `Request cancelled for ${BOUNDARY_API_KEY}`,
      "AbortError",
    ) as DOMException & { providerDebug?: string }
    abortErr.providerDebug = `raw ${BOUNDARY_API_KEY}`
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation((_url: string, init: RequestInit) => {
        const signal = init.signal as AbortSignal
        return new Promise<Response>((_resolve, reject) => {
          if (signal.aborted) {
            reject(abortErr)
            return
          }
          signal.addEventListener("abort", () => reject(abortErr))
        })
      }),
    )

    const onDone = vi.fn()
    const onError = vi.fn()
    const adapter = createOpenAICompatible(CFG)
    const req: ChatRequest = { messages: [{ role: "user", content: "hi" }] }

    const p = adapter.stream(
      req,
      BOUNDARY_API_KEY,
      "m",
      { onDone, onError },
      controller.signal,
    )
    controller.abort()
    await p

    expect(onDone).not.toHaveBeenCalled()
    expect(onError).toHaveBeenCalledTimes(1)
    const err = onError.mock.calls[0][0] as Error & { providerDebug?: string }
    expect(err).not.toBe(abortErr)
    expect(err.name).toBe("AbortError")
    expect(err).not.toBeInstanceOf(ApiError)
    expect(err.providerDebug).toBeUndefined()
    const serialized = JSON.stringify({
      name: err.name,
      message: err.message,
      stack: err.stack,
      providerDebug: err.providerDebug,
    })
    expect(serialized).not.toContain(BOUNDARY_API_KEY)
    expect(serialized).toContain("[REDACTED]")
  })
})

describe("createOpenAICompatible — runTurn", () => {
  it("demande le chunk d'usage uniquement à l'endpoint OpenAI officiel", async () => {
    const stream = sseStream([`data: [DONE]${SSE}`])
    const fetchMock = vi.fn().mockResolvedValue(makeRes({ body: stream }))
    vi.stubGlobal("fetch", fetchMock)

    await createOpenAICompatible(OFFICIAL_OPENAI_CFG).runTurn(
      { messages: [{ role: "user", content: "Salut" }] },
      "K",
      "gpt-4o-mini",
      {},
      {},
      new AbortController().signal,
    )

    const body = JSON.parse(fetchMock.mock.calls[0][1].body)
    expect(body.stream).toBe(true)
    expect(body.stream_options).toEqual({ include_usage: true })
  })

  it("n'envoie pas stream_options à un endpoint OpenAI-compatible générique", async () => {
    const stream = sseStream([`data: [DONE]${SSE}`])
    const fetchMock = vi.fn().mockResolvedValue(makeRes({ body: stream }))
    vi.stubGlobal("fetch", fetchMock)

    await createOpenAICompatible(CFG).runTurn(
      { messages: [{ role: "user", content: "Salut" }] },
      "K",
      "gpt-4o-mini",
      {},
      {},
      new AbortController().signal,
    )

    const body = JSON.parse(fetchMock.mock.calls[0][1].body)
    expect(body.stream).toBe(true)
    expect(body).not.toHaveProperty("stream_options")
  })

  it("remonte l'usage du chunk final quand le fournisseur le fournit", async () => {
    const stream = sseStream([
      sseData({ choices: [{ delta: { content: "Bonjour" } }] }),
      sseData({
        choices: [],
        usage: { prompt_tokens: 120, completion_tokens: 30, total_tokens: 150 },
      }),
      `data: [DONE]${SSE}`,
    ])
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(makeRes({ body: stream })))
    const result = await createOpenAICompatible(CFG).runTurn(
      { messages: [{ role: "user", content: "Salut" }] },
      "K",
      "m",
      {},
      {},
      new AbortController().signal,
    )
    expect(result.usage).toEqual({ inputTokens: 120, outputTokens: 30 })
  })

  it("remonte les tokens d'entrée cachés valides", async () => {
    const stream = sseStream([
      sseData({ choices: [{ delta: { content: "Bonjour" } }] }),
      sseData({
        choices: [],
        usage: {
          prompt_tokens: 120,
          completion_tokens: 30,
          prompt_tokens_details: { cached_tokens: 40 },
        },
      }),
      `data: [DONE]${SSE}`,
    ])
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(makeRes({ body: stream })))

    const result = await createOpenAICompatible(CFG).runTurn(
      { messages: [{ role: "user", content: "Salut" }] },
      "K",
      "m",
      {},
      {},
      new AbortController().signal,
    )

    expect(result.usage).toEqual({
      inputTokens: 120,
      outputTokens: 30,
      cachedInputTokens: 40,
    })
  })

  it("omet les tokens cachés supérieurs au total d'entrée sans perdre l'usage", async () => {
    const stream = sseStream([
      sseData({ choices: [{ delta: { content: "Bonjour" } }] }),
      sseData({
        choices: [],
        usage: {
          prompt_tokens: 120,
          completion_tokens: 30,
          prompt_tokens_details: { cached_tokens: 121 },
        },
      }),
      `data: [DONE]${SSE}`,
    ])
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(makeRes({ body: stream })))

    const result = await createOpenAICompatible(CFG).runTurn(
      { messages: [{ role: "user", content: "Salut" }] },
      "K",
      "m",
      {},
      {},
      new AbortController().signal,
    )

    expect(result.usage).toEqual({ inputTokens: 120, outputTokens: 30 })
  })

  it("ignore un événement JSON null sans interrompre le stream", async () => {
    const stream = sseStream([
      sseData({ choices: [{ delta: { content: "Bon" } }] }),
      sseData(null),
      sseData({ choices: [{ delta: { content: "jour" } }] }),
      `data: [DONE]${SSE}`,
    ])
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(makeRes({ body: stream })))

    const result = await createOpenAICompatible(CFG).runTurn(
      { messages: [{ role: "user", content: "Salut" }] },
      "K",
      "m",
      {},
      {},
      new AbortController().signal,
    )

    expect(result.text).toBe("Bonjour")
  })

  it.each([
    ["prompt_tokens négatif", '{"prompt_tokens":-1,"completion_tokens":1}'],
    ["completion_tokens décimal", '{"prompt_tokens":1,"completion_tokens":1.5}'],
    ["prompt_tokens infini", '{"prompt_tokens":1e400,"completion_tokens":1}'],
    [
      "prompt_tokens entier non sûr",
      `{"prompt_tokens":${Number.MAX_SAFE_INTEGER + 1},"completion_tokens":1}`,
    ],
  ])("ignore un usage invalide : %s", async (_label, usageJson) => {
    const stream = sseStream([
      sseData({ choices: [{ delta: { content: "Réponse" } }] }),
      `data: {"choices":[],"usage":${usageJson}}${SSE}`,
      `data: [DONE]${SSE}`,
    ])
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(makeRes({ body: stream })))

    const result = await createOpenAICompatible(CFG).runTurn(
      { messages: [{ role: "user", content: "Question" }] },
      "K",
      "m",
      {},
      {},
      new AbortController().signal,
    )

    expect(result.text).toBe("Réponse")
    expect(result.usage).toBeUndefined()
  })

  it("transmet les outils et recompose les arguments JSON fragmentés", async () => {
    const stream = sseStream([
      sseData({
        choices: [
          {
            delta: {
              tool_calls: [
                {
                  index: 0,
                  id: "call-1",
                  type: "function",
                  function: { name: "search", arguments: '{"query":"Tau' },
                },
              ],
            },
          },
        ],
      }),
      sseData({
        choices: [
          {
            delta: {
              tool_calls: [{ index: 0, function: { arguments: 'ri 2.9"}' } }],
            },
          },
        ],
      }),
      `data: [DONE]${SSE}`,
    ])
    const fetchMock = vi.fn().mockResolvedValue(makeRes({ body: stream }))
    vi.stubGlobal("fetch", fetchMock)
    const adapter = createOpenAICompatible(CFG)

    const result = await adapter.runTurn(
      { messages: [{ role: "user", content: "Cherche Tauri" }] },
      "K",
      "m",
      { tools: TEST_TOOLS, toolChoice: "required" },
      {},
      new AbortController().signal,
    )

    const body = JSON.parse(fetchMock.mock.calls[0][1].body)
    expect(body.tools).toEqual(TEST_TOOLS)
    expect(body.tool_choice).toBe("required")
    expect(result.toolCalls).toEqual([
      { id: "call-1", name: "search", arguments: { query: "Tauri 2.9" } },
    ])
  })

  it("recompose indépendamment plusieurs index d'appels", async () => {
    const stream = sseStream([
      sseData({
        choices: [
          {
            delta: {
              tool_calls: [
                {
                  index: 1,
                  id: "call-2",
                  function: { name: "fetch_content", arguments: '{"urls":[' },
                },
                {
                  index: 0,
                  id: "call-1",
                  function: { name: "search", arguments: '{"query":"doc"}' },
                },
              ],
            },
          },
        ],
      }),
      sseData({
        choices: [
          {
            delta: {
              tool_calls: [
                { index: 1, function: { arguments: '"https://example.com"]}' } },
              ],
            },
          },
        ],
      }),
      `data: [DONE]${SSE}`,
    ])
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(makeRes({ body: stream })))

    const result = await createOpenAICompatible(CFG).runTurn(
      { messages: [{ role: "user", content: "doc" }] },
      "K",
      "m",
      { tools: TEST_TOOLS },
      {},
      new AbortController().signal,
    )

    expect(result.toolCalls).toEqual([
      { id: "call-1", name: "search", arguments: { query: "doc" } },
      {
        id: "call-2",
        name: "fetch_content",
        arguments: { urls: ["https://example.com"] },
      },
    ])
  })

  it("préserve les messages assistant/tool dans le corps OpenAI", async () => {
    const stream = sseStream([sseData({ choices: [{ delta: { content: "Réponse" } }] })])
    const fetchMock = vi.fn().mockResolvedValue(makeRes({ body: stream }))
    vi.stubGlobal("fetch", fetchMock)

    await createOpenAICompatible(CFG).runTurn(
      {
        messages: [
          {
            role: "assistant",
            content: "",
            toolCalls: [
              { id: "call-1", name: "search", arguments: { query: "Tauri" } },
            ],
          },
          { role: "tool", content: "Résultat externe", toolCallId: "call-1" },
        ],
      },
      "K",
      "m",
      {},
      {},
      new AbortController().signal,
    )

    const body = JSON.parse(fetchMock.mock.calls[0][1].body)
    expect(body.messages).toEqual([
      {
        role: "assistant",
        content: "",
        tool_calls: [
          {
            id: "call-1",
            type: "function",
            function: { name: "search", arguments: '{"query":"Tauri"}' },
          },
        ],
      },
      { role: "tool", content: "Résultat externe", tool_call_id: "call-1" },
    ])
  })

  it("retourne le texte direct et respecte [DONE]", async () => {
    const stream = sseStream([
      sseData({ choices: [{ delta: { content: "Bon" } }] }),
      sseData({ choices: [{ delta: { content: "jour" } }] }),
      `data: [DONE]${SSE}`,
    ])
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(makeRes({ body: stream })))

    const result = await createOpenAICompatible(CFG).runTurn(
      { messages: [{ role: "user", content: "bonjour" }] },
      "K",
      "m",
      {},
      {},
      new AbortController().signal,
    )

    expect(result.text).toBe("Bonjour")
    expect(result.toolCalls).toEqual([])
  })

  it("rejette les arguments JSON invalides", async () => {
    const stream = sseStream([
      sseData({
        choices: [
          {
            delta: {
              tool_calls: [
                { index: 0, id: "call-1", function: { name: "search", arguments: "{" } },
              ],
            },
          },
        ],
      }),
    ])
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(makeRes({ body: stream })))

    await expect(
      createOpenAICompatible(CFG).runTurn(
        { messages: [{ role: "user", content: "doc" }] },
        "K",
        "m",
        {},
        {},
        new AbortController().signal,
      ),
    ).rejects.toMatchObject({ kind: "unknown" })
  })

  it("normalise une erreur HTTP", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(makeRes({ ok: false, status: 401, text: "bad key" })),
    )

    await expect(
      createOpenAICompatible(CFG).runTurn(
        { messages: [{ role: "user", content: "doc" }] },
        "BAD",
        "m",
        {},
        {},
        new AbortController().signal,
      ),
    ).rejects.toMatchObject({ kind: "auth" })
  })

  it("redacte la clé exacte d'un rejet réseau runTurn", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(
      new Error(`Credential ${BOUNDARY_API_KEY} rejected`),
    ))

    let caught: unknown
    try {
      await createOpenAICompatible(CFG).runTurn(
        { messages: [{ role: "user", content: "doc" }] },
        BOUNDARY_API_KEY,
        "m",
        {},
        {},
        new AbortController().signal,
      )
    } catch (error) {
      caught = error
    }

    const serialized = JSON.stringify({
      message: (caught as Error).message,
      detail: (caught as ApiError).detail,
      stack: (caught as Error).stack,
    })
    expect(serialized).not.toContain(BOUNDARY_API_KEY)
    expect(serialized).toContain("[REDACTED]")
  })

  it("laisse remonter AbortError", async () => {
    const controller = new AbortController()
    const abortError = new DOMException(
      `Request cancelled for ${BOUNDARY_API_KEY}`,
      "AbortError",
    ) as DOMException & { providerDebug?: string }
    abortError.providerDebug = `raw ${BOUNDARY_API_KEY}`
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation((_url: string, init: RequestInit) => {
        return new Promise<Response>((_resolve, reject) => {
          init.signal?.addEventListener("abort", () => reject(abortError))
        })
      }),
    )
    const promise = createOpenAICompatible(CFG).runTurn(
      { messages: [{ role: "user", content: "doc" }] },
      BOUNDARY_API_KEY,
      "m",
      {},
      {},
      controller.signal,
    )

    controller.abort()

    let caught: unknown
    try {
      await promise
    } catch (error) {
      caught = error
    }

    const sanitized = caught as Error & { providerDebug?: string }
    expect(sanitized).not.toBe(abortError)
    expect(sanitized.name).toBe("AbortError")
    expect(sanitized.providerDebug).toBeUndefined()
    const serialized = JSON.stringify({
      name: sanitized.name,
      message: sanitized.message,
      stack: sanitized.stack,
      providerDebug: sanitized.providerDebug,
    })
    expect(serialized).not.toContain(BOUNDARY_API_KEY)
    expect(serialized).toContain("[REDACTED]")
  })

  it("reconstruit un AbortError au message vide avec un message générique", async () => {
    const abortError = new Error("")
    abortError.name = "AbortError"
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(abortError))

    let caught: unknown
    try {
      await createOpenAICompatible(CFG).runTurn(
        { messages: [{ role: "user", content: "doc" }] },
        BOUNDARY_API_KEY,
        "m",
        {},
        {},
        new AbortController().signal,
      )
    } catch (error) {
      caught = error
    }

    expect(caught).not.toBe(abortError)
    expect(caught).toMatchObject({ name: "AbortError", message: "Request cancelled" })
  })
})

describe("createOpenAICompatible — testConnection", () => {
  it("clé valide : GET /models → ok true", async () => {
    const fetchMock = vi.fn().mockResolvedValue(makeRes({ json: { data: [] } }))
    vi.stubGlobal("fetch", fetchMock)

    const adapter = createOpenAICompatible(CFG)
    const out = await adapter.testConnection("GOOD")

    expect(fetchMock).toHaveBeenCalledWith("https://openrouter.ai/api/v1/models", {
      headers: { Authorization: "Bearer GOOD" },
    })
    expect(out).toEqual({ ok: true })
  })

  it("mauvaise clé : 401 → ok false, error.kind auth", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(makeRes({ ok: false, status: 401, text: "{}" })))

    const adapter = createOpenAICompatible(CFG)
    const out = await adapter.testConnection("BAD")

    expect(out.ok).toBe(false)
    expect(out.error).toBeInstanceOf(ApiError)
    expect(out.error?.kind).toBe("auth")
  })

  it("redacte avant la troncature à 200 caractères du log /models", async () => {
    const prefix = "x".repeat(200 - BOUNDARY_API_KEY_FIRST_HALF.length)
    vi.stubGlobal("fetch", vi.fn()
      .mockResolvedValueOnce(makeRes({
        ok: false,
        status: 404,
        text: `${prefix}${BOUNDARY_API_KEY}`,
      }))
      .mockResolvedValueOnce(makeRes({ ok: true })))

    await createOpenAICompatible(CFG).testConnection(BOUNDARY_API_KEY)
    const serializedLogs = JSON.stringify(loggerDebugMock.mock.calls)

    expect(serializedLogs).not.toContain(BOUNDARY_API_KEY)
    expect(serializedLogs).not.toContain(BOUNDARY_API_KEY_FIRST_HALF)
    expect(serializedLogs).not.toContain(BOUNDARY_API_KEY_SECOND_HALF)
    expect(serializedLogs).toContain("[REDACTED]")
  })

  it("redacte avant la troncature à 500 caractères du fallback normalisé", async () => {
    const prefix = "x".repeat(500 - BOUNDARY_API_KEY_FIRST_HALF.length)
    vi.stubGlobal("fetch", vi.fn()
      .mockResolvedValueOnce(makeRes({
        ok: false,
        status: 404,
        text: "models unavailable",
      }))
      .mockResolvedValueOnce(makeRes({
        ok: false,
        status: 401,
        text: `${prefix}${BOUNDARY_API_KEY}`,
      })))

    const out = await createOpenAICompatible(CFG).testConnection(BOUNDARY_API_KEY)
    const serializedSinks = JSON.stringify({
      result: {
        message: out.error?.message,
        detail: out.error?.detail,
      },
      logs: loggerDebugMock.mock.calls,
    })

    expect(serializedSinks).not.toContain(BOUNDARY_API_KEY)
    expect(serializedSinks).not.toContain(BOUNDARY_API_KEY_FIRST_HALF)
    expect(serializedSinks).not.toContain(BOUNDARY_API_KEY_SECOND_HALF)
    expect(serializedSinks).toContain("[REDACTED]")
  })

  it("redacte la clé exacte du fallback HTTP dans le log et le résultat", async () => {
    const opaqueKey = "CUSTOM.key+42/="
    vi.stubGlobal("fetch", vi.fn()
      .mockResolvedValueOnce(makeRes({
        ok: false,
        status: 404,
        text: `Incorrect API key provided: ${opaqueKey}`,
      }))
      .mockResolvedValueOnce(makeRes({
        ok: false,
        status: 401,
        text: `Credential ${opaqueKey} was rejected`,
    })))

    const out = await createOpenAICompatible(CFG).testConnection(opaqueKey)
    const serializedSinks = JSON.stringify({
      result: {
        ok: out.ok,
        error: out.error && {
          kind: out.error.kind,
          message: out.error.message,
          detail: out.error.detail,
        },
      },
      logs: loggerDebugMock.mock.calls,
    })

    expect(serializedSinks).not.toContain(opaqueKey)
    expect(serializedSinks).toContain("[REDACTED]")
  })

  it("redacte la clé exacte d'une exception réseau avant le log et le résultat", async () => {
    const opaqueKey = "CUSTOM.key+42/="
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(
      new Error(`Credential ${opaqueKey} was rejected`),
    ))

    const out = await createOpenAICompatible(CFG).testConnection(opaqueKey)
    const serializedSinks = JSON.stringify({
      result: {
        ok: out.ok,
        error: out.error && {
          kind: out.error.kind,
          message: out.error.message,
          detail: out.error.detail,
        },
      },
      logs: loggerErrorMock.mock.calls,
    })

    expect(serializedSinks).not.toContain(opaqueKey)
    expect(serializedSinks).toContain("[REDACTED]")
  })
})

describe("factory", () => {
  it("createProvider apiFamily openai → instance IProvider", () => {
    const p = createProvider(CFG)
    expect(typeof p.complete).toBe("function")
    expect(typeof p.stream).toBe("function")
    expect(typeof p.testConnection).toBe("function")
  })

  it("createProvider apiFamily gemini → throw /Gemini.*V2/", () => {
    const geminiCfg: ProviderConfig = { ...CFG, apiFamily: "gemini", baseUrl: "https://gemini.api" }
    expect(() => createProvider(geminiCfg)).toThrow(/Gemini.*V2|V2.*Gemini/)
  })

  it("buildPreview formate 'Provider › Model'", () => {
    expect(buildPreview("OpenRouter", "GPT-4o mini")).toBe("OpenRouter › GPT-4o mini")
  })
})
