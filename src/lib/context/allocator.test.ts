import { describe, expect, it } from "vitest"
import { allocateCandidates } from "./allocator"

describe("allocateCandidates", () => {
  it("préfère l’utilité puis le meilleur rapport utilité/tokens", () => {
    const selected = allocateCandidates([
      { id: "recent", kind: "history" as const, tokens: 40, utility: 1000 },
      { id: "knowledge", kind: "knowledge" as const, tokens: 20, utility: 600 },
      { id: "old", kind: "history" as const, tokens: 20, utility: 100 },
    ], 60)

    expect(selected.map((candidate) => candidate.id)).toEqual(["recent", "knowledge"])
  })

  it("ne dépasse jamais le budget", () => {
    const selected = allocateCandidates([
      { id: "a", kind: "knowledge" as const, tokens: 8, utility: 5 },
      { id: "b", kind: "knowledge" as const, tokens: 8, utility: 4 },
    ], 10)

    expect(selected.reduce((total, candidate) => total + candidate.tokens, 0)).toBeLessThanOrEqual(10)
  })

  it("ignore les coûts invalides et ne mute pas les candidats", () => {
    const candidates = [
      { id: "valid", kind: "mcp" as const, tokens: 4, utility: 10 },
      { id: "negative", kind: "history" as const, tokens: -1, utility: 100 },
      { id: "decimal", kind: "knowledge" as const, tokens: 1.5, utility: 100 },
    ]
    const original = structuredClone(candidates)

    expect(allocateCandidates(candidates, 10).map((candidate) => candidate.id)).toEqual(["valid"])
    expect(candidates).toEqual(original)
  })
})
