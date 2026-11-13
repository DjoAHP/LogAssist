import type { KnowledgeChunk } from "./types"

interface MarkdownUnit {
  content: string
  headingPath: string[]
  kind: "text" | "code"
}

export function fingerprintText(value: string): string {
  let hash = 0x811c9dc5
  for (const character of value) {
    hash ^= character.codePointAt(0) ?? 0
    hash = Math.imul(hash, 0x01000193)
  }
  return (hash >>> 0).toString(16).padStart(8, "0")
}

function samePath(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((part, index) => part === right[index])
}

function parseUnits(content: string): MarkdownUnit[] {
  const lines = content.replace(/\r\n?/g, "\n").split("\n")
  const headings: string[] = []
  const units: MarkdownUnit[] = []
  let paragraph: string[] = []

  const headingPath = () => headings.filter((heading) => heading.length > 0)
  const flushParagraph = () => {
    const text = paragraph.join("\n").trim()
    paragraph = []
    if (text) units.push({ content: text, headingPath: headingPath(), kind: "text" })
  }

  for (let index = 0; index < lines.length; index++) {
    const line = lines[index]
    const fence = line.match(/^\s*(`{3,}|~{3,})(.*)$/)
    if (fence) {
      flushParagraph()
      const marker = fence[1]
      const block = [line]
      while (++index < lines.length) {
        const codeLine = lines[index]
        block.push(codeLine)
        const trimmed = codeLine.trim()
        if (
          trimmed.length >= marker.length &&
          [...trimmed].every((character) => character === marker[0])
        ) break
      }
      units.push({ content: block.join("\n"), headingPath: headingPath(), kind: "code" })
      continue
    }

    const heading = line.match(/^(#{1,6})\s+(.+?)\s*#*\s*$/)
    if (heading) {
      flushParagraph()
      const level = heading[1].length
      headings.length = level
      headings[level - 1] = heading[2].trim()
      continue
    }

    if (line.trim() === "") flushParagraph()
    else paragraph.push(line)
  }
  flushParagraph()
  return units
}

function normalizedTokenCount(countTokens: (text: string) => number, text: string): number {
  const value = Math.ceil(countTokens(text))
  return Number.isSafeInteger(value) && value > 0 ? value : 1
}

function takeFittingPrefix(
  value: string,
  hardLimit: number,
  render: (part: string) => string,
  countTokens: (text: string) => number,
): [string, string] {
  const characters = Array.from(value)
  let low = 1
  let high = characters.length
  let best = 0
  while (low <= high) {
    const middle = Math.floor((low + high) / 2)
    const candidate = render(characters.slice(0, middle).join(""))
    if (normalizedTokenCount(countTokens, candidate) <= hardLimit) {
      best = middle
      low = middle + 1
    } else {
      high = middle - 1
    }
  }
  const length = Math.max(1, best)
  return [characters.slice(0, length).join(""), characters.slice(length).join("")]
}

function splitTextUnit(
  unit: MarkdownUnit,
  hardLimit: number,
  countTokens: (text: string) => number,
): MarkdownUnit[] {
  if (normalizedTokenCount(countTokens, unit.content) <= hardLimit) return [unit]
  const output: MarkdownUnit[] = []
  let current = ""

  const flush = () => {
    if (!current) return
    output.push({ ...unit, content: current })
    current = ""
  }

  for (const sourceLine of unit.content.split("\n")) {
    let line = sourceLine
    while (line.length > 0) {
      const separator = current ? "\n" : ""
      const combined = `${current}${separator}${line}`
      if (normalizedTokenCount(countTokens, combined) <= hardLimit) {
        current = combined
        line = ""
        continue
      }
      if (current) {
        flush()
        continue
      }
      const [head, tail] = takeFittingPrefix(line, hardLimit, (part) => part, countTokens)
      current = head
      line = tail
      flush()
    }
  }
  flush()
  return output
}

function splitCodeUnit(
  unit: MarkdownUnit,
  hardLimit: number,
  countTokens: (text: string) => number,
): MarkdownUnit[] {
  if (normalizedTokenCount(countTokens, unit.content) <= hardLimit) return [unit]
  const lines = unit.content.split("\n")
  const opening = lines[0]
  const markerMatch = opening.match(/^\s*(`{3,}|~{3,})/)
  if (!markerMatch) return splitTextUnit(unit, hardLimit, countTokens)
  const closing = markerMatch[1][0].repeat(markerMatch[1].length)
  const lastLine = lines[lines.length - 1]
  const hasClosing = lines.length > 1 && lastLine.trim().startsWith(closing)
  const body = lines.slice(1, hasClosing ? -1 : undefined)
  const output: MarkdownUnit[] = []
  let current: string[] = []
  const render = (parts: readonly string[]) => `${opening}\n${parts.join("\n")}\n${closing}`

  const flush = () => {
    if (current.length === 0) return
    output.push({ ...unit, content: render(current) })
    current = []
  }

  for (const sourceLine of body) {
    let line = sourceLine
    while (line.length > 0) {
      const candidate = [...current, line]
      if (normalizedTokenCount(countTokens, render(candidate)) <= hardLimit) {
        current = candidate
        line = ""
        continue
      }
      if (current.length > 0) {
        flush()
        continue
      }
      const [head, tail] = takeFittingPrefix(
        line,
        hardLimit,
        (part) => render([part]),
        countTokens,
      )
      current = [head]
      line = tail
      flush()
    }
  }
  flush()
  return output.length > 0 ? output : [{ ...unit, content: render([""]) }]
}

export function chunkMarkdown(input: {
  documentId: string
  documentName: string
  content: string
  countTokens(text: string): number
  targetTokens?: number
  hardLimitTokens?: number
}): KnowledgeChunk[] {
  if (!input.content.trim()) return []
  const targetTokens = Math.max(1, Math.floor(input.targetTokens ?? 450))
  const hardLimitTokens = Math.max(targetTokens, Math.floor(input.hardLimitTokens ?? 700))
  const fingerprint = fingerprintText(input.content)
  const units = parseUnits(input.content).flatMap((unit) =>
    unit.kind === "code"
      ? splitCodeUnit(unit, hardLimitTokens, input.countTokens)
      : splitTextUnit(unit, hardLimitTokens, input.countTokens))
  const grouped: Array<{ content: string; headingPath: string[]; tokenEstimate: number }> = []
  let currentContent = ""
  let currentPath: string[] = []

  const flush = () => {
    if (!currentContent) return
    grouped.push({
      content: currentContent,
      headingPath: [...currentPath],
      tokenEstimate: normalizedTokenCount(input.countTokens, currentContent),
    })
    currentContent = ""
  }

  for (const unit of units) {
    const candidate = currentContent ? `${currentContent}\n\n${unit.content}` : unit.content
    const pathChanged = currentContent.length > 0 && !samePath(currentPath, unit.headingPath)
    if (pathChanged || normalizedTokenCount(input.countTokens, candidate) > targetTokens) flush()
    if (!currentContent) currentPath = [...unit.headingPath]
    currentContent = currentContent ? `${currentContent}\n\n${unit.content}` : unit.content
    if (normalizedTokenCount(input.countTokens, currentContent) >= targetTokens) flush()
  }
  flush()

  return grouped.map((chunk, chunkIndex) => ({
    documentId: input.documentId,
    documentName: input.documentName,
    fingerprint,
    chunkIndex,
    headingPath: chunk.headingPath,
    content: chunk.content,
    tokenEstimate: chunk.tokenEstimate,
  }))
}
