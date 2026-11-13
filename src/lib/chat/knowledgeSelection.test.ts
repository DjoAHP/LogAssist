import { describe, expect, it, vi } from "vitest"
import type { KnowledgeRow } from "@/lib/db/knowledge"
import { loadEligibleKnowledge } from "./knowledgeSelection"

function row(id: string, enabled = 1): KnowledgeRow {
  return {
    id,
    name: id.toUpperCase(),
    content: `# ${id}`,
    enabled,
    sort_order: 0,
    created_at: "2026-01-01 00:00:00",
  }
}

describe("loadEligibleKnowledge", () => {
  it("utilise les connaissances globales sans override", async () => {
    const listEnabled = vi.fn().mockResolvedValue([row("global")])
    const listAll = vi.fn()
    const result = await loadEligibleKnowledge("c1", {
      listOverrideIds: vi.fn().mockResolvedValue([]),
      listAll,
      listEnabled,
    })

    expect(result).toEqual([row("global")])
    expect(listEnabled).toHaveBeenCalledTimes(1)
    expect(listAll).not.toHaveBeenCalled()
  })

  it("remplace la globale par l’override non vide dans son ordre", async () => {
    const result = await loadEligibleKnowledge("c1", {
      listOverrideIds: vi.fn().mockResolvedValue(["k2", "k1"]),
      listAll: vi.fn().mockResolvedValue([row("k1"), row("k2")]),
      listEnabled: vi.fn(),
    })

    expect(result.map((knowledge) => knowledge.id)).toEqual(["k2", "k1"])
  })

  it("exclut un document désactivé ou absent même s’il est référencé", async () => {
    const result = await loadEligibleKnowledge("c1", {
      listOverrideIds: vi.fn().mockResolvedValue(["missing", "off", "on"]),
      listAll: vi.fn().mockResolvedValue([row("off", 0), row("on")]),
      listEnabled: vi.fn(),
    })

    expect(result).toEqual([row("on")])
  })
})
