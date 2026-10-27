import { describe, expect, it, vi } from "vitest"
import { parseSseStream, type SseChunk } from "./sse"

/** Helper : construit un ReadableStream réel depuis des fragments de texte et retourne son reader */
function streamFrom(parts: string[]): ReadableStreamDefaultReader<Uint8Array> {
  const enc = new TextEncoder()
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const p of parts) controller.enqueue(enc.encode(p))
      controller.close()
    },
  })
  return stream.getReader()
}

/** Helper : collecte tous les chunks émis par le parseur */
async function collect(parts: string[]): Promise<SseChunk[]> {
  const out: SseChunk[] = []
  await parseSseStream(streamFrom(parts), (c) => {
    out.push(c)
  })
  return out
}

describe("parseSseStream", () => {
  it("émet un chunk data par événement, même scindé entre deux reads", async () => {
    const chunks = await collect([
      'data: {"choices":[{"delta":{"content":"Bonj"}}]}\n\ndata: {"ch',
      'oices":[{"delta":{"content":"our"}}]}\n\ndata: [DONE]\n\n',
    ])
    expect(chunks).toHaveLength(3)
    expect(chunks[0]).toEqual({ event: null, data: '{"choices":[{"delta":{"content":"Bonj"}}]}' })
    expect(chunks[1]).toEqual({ event: null, data: '{"choices":[{"delta":{"content":"our"}}]}' })
    expect(chunks[2]).toEqual({ event: null, data: "[DONE]" })
  })

  it("event: ping → SseChunk.event rempli", async () => {
    const chunks = await collect(["event: ping\ndata: {}\n\n"])
    expect(chunks).toEqual([{ event: "ping", data: "{}" }])
  })

  it("commentaires ':keepalive' et lignes vides ignorés", async () => {
    const chunks = await collect([": keepalive\n\ndata: {\"a\":1}\n\n: ping\n\n"])
    expect(chunks).toEqual([{ event: null, data: '{"a":1}' }])
  })

  it("data multiline : 2 lignes data: jointes par \\n", async () => {
    const chunks = await collect(["data: ligne1\ndata: ligne2\n\n"])
    expect(chunks).toEqual([{ event: null, data: "ligne1\nligne2" }])
  })

  it("dernier événement sans \\n final → délivré quand même (flush final)", async () => {
    const chunks = await collect(['data: {"choices":[{"delta":{"content":"fin"}}]}\n\ndata: {"last":true}'])
    expect(chunks).toHaveLength(2)
    expect(chunks[1]).toEqual({ event: null, data: '{"last":true}' })
  })

  it("data: sans espace (data:{\"x\":1}) → parsé aussi", async () => {
    const chunks = await collect(['data:{"x":1}\n\n'])
    expect(chunks).toEqual([{ event: null, data: '{"x":1}' }])
  })

  it("onChunk async : le parseur attend chaque callback", async () => {
    const order: string[] = []
    await parseSseStream(streamFrom(["data: a\n\ndata: b\n\n"]), async (c) => {
      order.push(c.data)
    })
    expect(order).toEqual(["a", "b"])
  })

  it("aucun événement data → onChunk jamais appelé", async () => {
    const onChunk = vi.fn()
    await parseSseStream(streamFrom([": commentaire seul\n\nevent: fin\n\n"]), onChunk)
    expect(onChunk).not.toHaveBeenCalled()
  })
})
