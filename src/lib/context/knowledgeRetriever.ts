import { chunkMarkdown, fingerprintText } from "./markdownChunker"
import type {
  KnowledgeChunk,
  KnowledgeDocument,
  RankedKnowledgeChunk,
} from "./types"

interface IndexedChunk {
  chunk: KnowledgeChunk
  frequencies: Map<string, number>
  terms: Set<string>
  length: number
  nameTerms: Set<string>
  headingTerms: Set<string>
  technicalIdentifiers: Set<string>
  sortOrder: number
}

interface CachedDocument {
  fingerprint: string
  name: string
  sortOrder: number
  chunks: IndexedChunk[]
}

interface ScoredChunk {
  indexed: IndexedChunk
  score: number
}

export interface KnowledgeRetriever {
  search(query: string, documents: readonly KnowledgeDocument[]): RankedKnowledgeChunk[]
  clear(): void
}

const STOP_WORDS = new Set([
  "a", "an", "and", "au", "aux", "avec", "ce", "ces", "cette", "comment",
  "dans", "de", "des", "du", "en", "et", "for", "in", "la", "le", "les",
  "ma", "mes", "mon", "of", "on", "or", "ou", "par", "pour", "qu", "que",
  "qui", "sans", "sur", "the", "to", "un", "une", "with",
])

export function tokenizeLexical(value: string): string[] {
  const expanded = value
    .replace(/([\p{Ll}\d])([\p{Lu}])/gu, "$1 $2")
    .replace(/[_\-/]+/g, " ")
    .normalize("NFKD")
    .replace(/\p{M}+/gu, "")
    .toLocaleLowerCase("fr")
  return (expanded.match(/[\p{L}\p{N}]+/gu) ?? [])
    .filter((term) => (term.length >= 2 || /^\d+$/.test(term)) && !STOP_WORDS.has(term))
}

function technicalIdentifiers(value: string): Set<string> {
  const normalized = value.normalize("NFKC").toLocaleLowerCase("fr")
  const identifiers = normalized.match(/[\p{L}\p{N}]+(?:[._\-/][\p{L}\p{N}]+)+/gu) ?? []
  return new Set(identifiers)
}

function frequencies(terms: readonly string[]): Map<string, number> {
  const result = new Map<string, number>()
  for (const term of terms) result.set(term, (result.get(term) ?? 0) + 1)
  return result
}

function jaccard(left: ReadonlySet<string>, right: ReadonlySet<string>): number {
  if (left.size === 0 || right.size === 0) return 0
  let intersection = 0
  for (const term of left) if (right.has(term)) intersection++
  const union = left.size + right.size - intersection
  return union === 0 ? 0 : intersection / union
}

function diversify(scored: ScoredChunk[]): ScoredChunk[] {
  const remaining = [...scored]
  const selected: ScoredChunk[] = []
  const seenDocuments = new Set<string>()

  while (remaining.length > 0) {
    remaining.sort((left, right) => {
      const maxScore = Math.max(left.score, right.score)
      const comparable = maxScore > 0 && Math.abs(left.score - right.score) / maxScore <= 0.1
      if (comparable) {
        const leftUnseen = !seenDocuments.has(left.indexed.chunk.documentId)
        const rightUnseen = !seenDocuments.has(right.indexed.chunk.documentId)
        if (leftUnseen !== rightUnseen) return leftUnseen ? -1 : 1
      }

      const leftSimilarity = selected.reduce(
        (maximum, item) => Math.max(maximum, jaccard(left.indexed.terms, item.indexed.terms)),
        0,
      )
      const rightSimilarity = selected.reduce(
        (maximum, item) => Math.max(maximum, jaccard(right.indexed.terms, item.indexed.terms)),
        0,
      )
      const leftAdjusted = left.score - 0.35 * leftSimilarity
      const rightAdjusted = right.score - 0.35 * rightSimilarity
      if (rightAdjusted !== leftAdjusted) return rightAdjusted - leftAdjusted
      if (left.indexed.sortOrder !== right.indexed.sortOrder) {
        return left.indexed.sortOrder - right.indexed.sortOrder
      }
      return left.indexed.chunk.chunkIndex - right.indexed.chunk.chunkIndex
    })

    const next = remaining.shift()
    if (!next) break
    selected.push(next)
    seenDocuments.add(next.indexed.chunk.documentId)
  }
  return selected
}

export function createKnowledgeRetriever(input: {
  countTokens(text: string): number
  chunkDocument?: typeof chunkMarkdown
}): KnowledgeRetriever {
  const cache = new Map<string, CachedDocument>()
  const chunkDocument = input.chunkDocument ?? chunkMarkdown

  const indexDocument = (document: KnowledgeDocument): IndexedChunk[] => {
    const fingerprint = fingerprintText(document.content)
    const cached = cache.get(document.id)
    if (
      cached &&
      cached.fingerprint === fingerprint &&
      cached.name === document.name &&
      cached.sortOrder === document.sortOrder
    ) return cached.chunks

    const nameTerms = new Set(tokenizeLexical(document.name))
    const chunks = chunkDocument({
      documentId: document.id,
      documentName: document.name,
      content: document.content,
      countTokens: input.countTokens,
    }).map((chunk): IndexedChunk => {
      const lexicalTerms = tokenizeLexical(chunk.content)
      return {
        chunk,
        frequencies: frequencies(lexicalTerms),
        terms: new Set(lexicalTerms),
        length: Math.max(1, lexicalTerms.length),
        nameTerms,
        headingTerms: new Set(tokenizeLexical(chunk.headingPath.join(" "))),
        technicalIdentifiers: technicalIdentifiers(chunk.content),
        sortOrder: document.sortOrder,
      }
    })
    cache.set(document.id, { fingerprint, name: document.name, sortOrder: document.sortOrder, chunks })
    return chunks
  }

  return {
    search(query, documents) {
      const queryTerms = [...new Set(tokenizeLexical(query))]
      const queryIdentifiers = technicalIdentifiers(query)
      if (queryTerms.length === 0 || documents.length === 0) return []

      const activeIds = new Set(documents.map((document) => document.id))
      for (const documentId of cache.keys()) {
        if (!activeIds.has(documentId)) cache.delete(documentId)
      }
      const indexed = documents.flatMap(indexDocument)
      if (indexed.length === 0) return []

      const documentFrequency = new Map<string, number>()
      for (const item of indexed) {
        for (const term of item.terms) {
          documentFrequency.set(term, (documentFrequency.get(term) ?? 0) + 1)
        }
      }
      const averageLength = indexed.reduce((total, item) => total + item.length, 0) / indexed.length
      const k1 = 1.2
      const b = 0.75
      const scored: ScoredChunk[] = []

      for (const item of indexed) {
        let score = 0
        for (const term of queryTerms) {
          const termFrequency = item.frequencies.get(term) ?? 0
          if (termFrequency > 0) {
            const matchingDocuments = documentFrequency.get(term) ?? 0
            const inverseFrequency = Math.log(
              1 + (indexed.length - matchingDocuments + 0.5) / (matchingDocuments + 0.5),
            )
            const normalization = termFrequency + k1 * (1 - b + b * item.length / averageLength)
            score += inverseFrequency * (termFrequency * (k1 + 1)) / normalization
          }
          if (item.nameTerms.has(term)) score += 1.5
          if (item.headingTerms.has(term)) score += 1
        }
        for (const identifier of queryIdentifiers) {
          if (item.technicalIdentifiers.has(identifier)) score += 2
        }
        if (score > 0) scored.push({ indexed: item, score })
      }

      const unique = new Map<string, ScoredChunk>()
      for (const item of scored) {
        const contentFingerprint = fingerprintText(item.indexed.chunk.content)
        const existing = unique.get(contentFingerprint)
        if (!existing || item.score > existing.score) unique.set(contentFingerprint, item)
      }

      return diversify([...unique.values()]).map(({ indexed: item, score }) => ({
        ...item.chunk,
        score,
      }))
    },
    clear() {
      cache.clear()
    },
  }
}
