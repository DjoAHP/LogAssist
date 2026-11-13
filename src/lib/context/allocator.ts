export interface ContextCandidate {
  id: string
  kind: "history" | "knowledge" | "mcp"
  tokens: number
  utility: number
}

export function allocateCandidates<T extends ContextCandidate>(
  candidates: readonly T[],
  tokenBudget: number,
): T[] {
  const budget = Number.isFinite(tokenBudget) ? Math.max(0, Math.floor(tokenBudget)) : 0
  const ordered = candidates
    .filter((candidate) =>
      Number.isSafeInteger(candidate.tokens) &&
      candidate.tokens > 0 &&
      Number.isFinite(candidate.utility))
    .slice()
    .sort((left, right) =>
      right.utility - left.utility ||
      right.utility / right.tokens - left.utility / left.tokens ||
      left.id.localeCompare(right.id))
  const selected: T[] = []
  let consumed = 0
  for (const candidate of ordered) {
    if (consumed + candidate.tokens > budget) continue
    selected.push(candidate)
    consumed += candidate.tokens
  }
  return selected
}
