import { tokenizeLexical } from "./knowledgeRetriever"
import type { ContextHistoryMessage, HistorySelection } from "./types"

interface HistoryTurn {
  index: number
  messages: ContextHistoryMessage[]
  tokens: number
  orphan: boolean
}

function safeTokenCount(countText: (text: string) => number, text: string): number {
  const value = Math.ceil(countText(text))
  return Number.isSafeInteger(value) && value > 0 ? value : 0
}

function groupTurns(
  messages: readonly ContextHistoryMessage[],
  countText: (text: string) => number,
): HistoryTurn[] {
  const turns: HistoryTurn[] = []
  let current: HistoryTurn | null = null

  for (const message of messages) {
    if (message.role === "user") {
      current = {
        index: turns.length,
        messages: [{ ...message }],
        tokens: safeTokenCount(countText, message.content),
        orphan: false,
      }
      turns.push(current)
      continue
    }

    if (!current || current.orphan) {
      current = {
        index: turns.length,
        messages: [{ ...message }],
        tokens: safeTokenCount(countText, message.content),
        orphan: true,
      }
      turns.push(current)
      continue
    }

    current.messages.push({ ...message })
    current.tokens += safeTokenCount(countText, message.content)
  }
  return turns
}

function relevance(turn: HistoryTurn, queryTerms: ReadonlySet<string>): number {
  if (queryTerms.size === 0) return 0
  const frequencies = new Map<string, number>()
  for (const message of turn.messages) {
    for (const term of tokenizeLexical(message.content)) {
      frequencies.set(term, (frequencies.get(term) ?? 0) + 1)
    }
  }
  let score = 0
  for (const term of queryTerms) score += frequencies.get(term) ?? 0
  return turn.orphan ? score * 0.5 : score
}

export function selectHistory(input: {
  messages: readonly ContextHistoryMessage[]
  query: string
  tokenBudget: number
  countText(text: string): number
  recentTurns?: number
}): HistorySelection {
  const turns = groupTurns(input.messages, input.countText)
  const budget = Number.isFinite(input.tokenBudget)
    ? Math.max(0, Math.floor(input.tokenBudget))
    : 0
  const recentTurns = Math.max(0, Math.floor(input.recentTurns ?? 2))
  const recentStart = Math.max(0, turns.length - recentTurns)
  const selected = new Map<number, HistoryTurn>()
  let tokens = 0

  for (let index = turns.length - 1; index >= recentStart; index--) {
    const turn = turns[index]
    if (tokens + turn.tokens > budget) continue
    selected.set(turn.index, turn)
    tokens += turn.tokens
  }

  const queryTerms = new Set(tokenizeLexical(input.query))
  const older = turns
    .slice(0, recentStart)
    .map((turn) => ({ turn, score: relevance(turn, queryTerms) }))
    .filter((candidate) => candidate.score > 0)
    .sort((left, right) => right.score - left.score || right.turn.index - left.turn.index)

  for (const { turn } of older) {
    if (tokens + turn.tokens > budget) continue
    selected.set(turn.index, turn)
    tokens += turn.tokens
  }

  const ordered = [...selected.values()].sort((left, right) => left.index - right.index)
  return {
    messages: ordered.flatMap((turn) => turn.messages.map((message) => ({ ...message }))),
    selectedTurns: ordered.length,
    omittedTurns: turns.length - ordered.length,
    tokens,
  }
}
