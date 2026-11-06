import type { MessageRow } from "@/lib/db/messages"

export type RecoveryMode = "retry" | "regenerate"

export interface RecoveryPlan {
  targetId: string
  triggerUserContent: string
  history: MessageRow[]
}

function parseStoredError(error: string | null): { kind?: string; interrupted?: boolean } {
  if (!error) return {}
  try {
    return JSON.parse(error) as { kind?: string; interrupted?: boolean }
  } catch {
    return {}
  }
}

export function createRecoveryPlan(
  rows: MessageRow[],
  targetId: string,
  mode: RecoveryMode,
): RecoveryPlan | null {
  const targetIndex = rows.findIndex((row) => row.id === targetId)
  if (targetIndex < 0 || rows[targetIndex].role !== "assistant") return null
  if (targetIndex !== rows.length - 1) return null

  let lastAssistantIndex = -1
  for (let index = rows.length - 1; index >= 0; index--) {
    if (rows[index].role === "assistant") {
      lastAssistantIndex = index
      break
    }
  }
  if (targetIndex !== lastAssistantIndex) return null

  const target = rows[targetIndex]
  const storedError = parseStoredError(target.error)
  if (mode === "retry") {
    if (!target.error || storedError.interrupted || storedError.kind === "persistence") return null
  } else if (target.error || target.content.trim() === "") {
    return null
  }

  let userIndex = -1
  for (let index = targetIndex - 1; index >= 0; index--) {
    if (rows[index].role === "user") {
      userIndex = index
      break
    }
  }
  if (userIndex < 0) return null

  return {
    targetId,
    triggerUserContent: rows[userIndex].content,
    history: rows.slice(0, targetIndex),
  }
}
