import { describe, it, expect, vi, beforeEach } from "vitest"

const mockExecute = vi.hoisted(() => vi.fn())
const mockSelect = vi.hoisted(() => vi.fn())
vi.mock("@/lib/db/database", () => ({
  execute: (...a: unknown[]) => mockExecute(...a),
  select: (...a: unknown[]) => mockSelect(...a),
}))

import { settings } from "@/lib/db/settings"

beforeEach(() => {
  vi.clearAllMocks()
})

describe("settings", () => {
  it("get renvoie la valeur si la clé existe", async () => {
    mockSelect.mockResolvedValueOnce([{ value: "42" }])
    expect(await settings.get("default_model")).toBe("42")
    expect(mockSelect.mock.calls[0][0]).toContain("FROM settings")
  })
  it("get renvoie null si la clé est absente", async () => {
    mockSelect.mockResolvedValueOnce([])
    expect(await settings.get("default_model")).toBeNull()
  })
  it("set upserte (INSERT ... ON CONFLICT)", async () => {
    mockExecute.mockResolvedValue(undefined)
    await settings.set("default_model", "m1")
    const [sql, bind] = mockExecute.mock.calls[0]
    expect(sql).toContain("ON CONFLICT")
    expect(bind).toEqual(["default_model", "m1"])
  })
})
