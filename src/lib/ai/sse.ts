export interface SseChunk {
  event: string | null
  data: string
}

/**
 * Parse un flux SSE (Server-Sent Events) depuis un reader de ReadableStream.
 *
 * - Sépare les événements sur les lignes vides ("\n\n", format SSE standard).
 * - Ignore les commentaires ("(:...)") et les lignes vides à l'intérieur d'un événement.
 * - Extrait "event: <nom>" et cumule les lignes "data:" (multiline, jointes par "\n").
 * - Regex /^data:/ sans espace obligatoire : "data:{...}" collé est parsé aussi.
 * - Flush final : le dernier événement sans "\n\n" terminal est délivré quand même.
 *
 * Ne throw jamais sur les callbacks : si onChunk throw, l'exception remonte
 * telle quelle à l'appelant (responsabilité du consommateur de l'isoler).
 */
export async function parseSseStream(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  onChunk: (c: SseChunk) => Promise<void> | void,
): Promise<void> {
  const decoder = new TextDecoder()
  let buf = ""

  const handleEvent = (part: string): { event: string | null; dataLines: string[] } => {
    let event: string | null = null
    const dataLines: string[] = []
    for (const line of part.split("\n")) {
      if (line.startsWith(":") || line.trim() === "") continue
      if (line.startsWith("event:")) event = line.slice(6).trim()
      if (/^data:/.test(line)) dataLines.push(line.slice(5).trim())
    }
    return { event, dataLines }
  }

  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    buf += decoder.decode(value, { stream: true })
    const parts = buf.split("\n\n")
    buf = parts.pop() ?? ""
    for (const part of parts) {
      const { event, dataLines } = handleEvent(part)
      if (dataLines.length) await onChunk({ event, data: dataLines.join("\n") })
    }
  }

  // Flush final : dernier événement sans "\n\n" terminal + fragments UTF-8 résiduels
  buf += decoder.decode()
  const { event, dataLines } = handleEvent(buf)
  if (dataLines.length) await onChunk({ event, data: dataLines.join("\n") })
}
