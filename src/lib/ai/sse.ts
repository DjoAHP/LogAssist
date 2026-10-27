export interface SseChunk {
  event: string | null
  data: string
}

/**
 * Parse un flux SSE (Server-Sent Events) depuis un reader de ReadableStream.
 *
 * - Sépare les événements sur les lignes vides ("\n\n"). Les fins de ligne CRLF
 *   ("\r\n") et CR ("\r"), valides selon la spec SSE, sont normalisées en "\n"
 *   sur le buffer accumulé AVANT le split, avec rétention d'un "\r" terminal :
 *   un "\r" en frontière de chunk peut être la 1re moitié d'un "\r\n" qui
 *   s'achèvera au prochain read — le convertir maintenant créerait un faux
 *   séparateur "\n\n".
 * - Ignore les commentaires (": ...") et les lignes vides à l'intérieur d'un événement.
 * - Extrait "event: <nom>" et cumule les lignes "data:" (multiline, jointes par "\n").
 * - Regex /^data:/ sans espace obligatoire : "data:{...}" collé est parsé aussi.
 * - Le trim() est volontaire : les data attendues sont du JSON, les espaces de
 *   plafond SSE ne sont jamais significatifs ici.
 * - Champs id:/retry: de la spec ignorés (pas de reconnexion auto dans ce contexte).
 * - event vaut null par défaut : pas de fallback sur "message" (valeur par défaut
 *   de la spec) — le consommateur décide.
 * - Flush final : le dernier événement sans "\n\n" terminal est délivré quand même,
 *   et decoder.decode() restitue les fragments UTF-8 multi-octets résiduels.
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

  const deliverEvent = async (part: string): Promise<void> => {
    let event: string | null = null
    const dataLines: string[] = []
    for (const line of part.split("\n")) {
      if (line.startsWith(":") || line.trim() === "") continue
      if (line.startsWith("event:")) event = line.slice(6).trim()
      if (/^data:/.test(line)) dataLines.push(line.slice(5).trim())
    }
    if (dataLines.length) await onChunk({ event, data: dataLines.join("\n") })
  }

  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    buf += decoder.decode(value, { stream: true })
    // Rétention d'un "\r" terminal : peut être le début d'un "\r\n" à cheval
    // sur 2 reads (le normaliser maintenant créerait un faux "\n\n")
    let hold = ""
    if (buf.endsWith("\r")) {
      hold = "\r"
      buf = buf.slice(0, -1)
    }
    buf = buf.replace(/\r\n/g, "\n").replace(/\r/g, "\n")
    const parts = (buf + hold).split("\n\n")
    buf = parts.pop() ?? ""
    for (const part of parts) await deliverEvent(part)
  }

  // Flush final : dernier événement sans "\n\n" terminal + fragments UTF-8 résiduels.
  // Plus aucun read à venir : le "\r" terminal éventuel est un terminateur isolé.
  buf += decoder.decode()
  buf = buf.replace(/\r\n/g, "\n").replace(/\r/g, "\n")
  const parts = buf.split("\n\n")
  for (const part of parts) await deliverEvent(part)
}
