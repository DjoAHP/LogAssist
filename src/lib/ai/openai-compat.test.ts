import { afterEach, describe, expect, it, vi } from "vitest"
import { ApiError } from "./errors"
import { buildPreview, createOpenAICompatible, createProvider } from "./openai-compat"
import type { ChatRequest, ProviderConfig } from "./types"

const CFG: ProviderConfig = {
  id: "prov-openrouter",
  name: "OpenRouter",
  apiFamily: "openai",
  baseUrl: "https://openrouter.ai/api/v1/",
  secretRef: "openrouter.key",
}

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

afterEach(() => {
  vi.unstubAllGlobals()
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

  it("stream aborté → onError avec AbortError (pas ApiError)", async () => {
    const controller = new AbortController()
    const abortErr = new DOMException("This operation was aborted", "AbortError")
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

    const p = adapter.stream(req, "K", "m", { onDone, onError }, controller.signal)
    controller.abort()
    await p

    expect(onDone).not.toHaveBeenCalled()
    expect(onError).toHaveBeenCalledTimes(1)
    const err = onError.mock.calls[0][0]
    expect(err.name).toBe("AbortError")
    expect(err).not.toBeInstanceOf(ApiError)
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
