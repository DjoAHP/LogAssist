import { describe, it, expect, vi, beforeEach } from "vitest"

// Motif Task 4 : mocks DB + secrets ; vi.hoisted obligatoire car vi.mock est
// hoisté et ne peut référencer que des variables hoistées.
const mockExecute = vi.hoisted(() => vi.fn())
const mockSelect = vi.hoisted(() => vi.fn())
const mockSecrets = vi.hoisted(() => ({ set: vi.fn(), get: vi.fn(), remove: vi.fn() }))
vi.mock("@/lib/db/database", () => ({
  execute: (...a: unknown[]) => mockExecute(...a),
  select: (...a: unknown[]) => mockSelect(...a),
}))
vi.mock("@/lib/secrets/service", () => ({ secrets: mockSecrets }))

import { providers, secretRefFor } from "@/lib/db/providers"

beforeEach(() => {
  vi.clearAllMocks()
})

describe("providers", () => {
  it("create insère le provider et écrit la clé dans le Credential Manager", async () => {
    mockExecute.mockResolvedValue(undefined)
    const row = await providers.create("OpenRouter", "openai", "https://openrouter.ai/api/v1", "sk-test")
    expect(row.name).toBe("OpenRouter")
    const [sql, bind] = mockExecute.mock.calls[0]
    expect(sql).toContain("INSERT INTO providers")
    expect(bind[1]).toBe("OpenRouter")
    expect(bind[2]).toBe("openai")
    expect(mockSecrets.set).toHaveBeenCalledWith(secretRefFor(row.id), "sk-test")
  })

  it("create sans clé n'écrit aucun secret", async () => {
    await providers.create("NVIDIA", "openai", "https://integrate.api.nvidia.com/v1")
    expect(mockSecrets.set).not.toHaveBeenCalled()
  })

  it("remove supprime le secret, puis le provider (cascade models via FK)", async () => {
    mockExecute.mockResolvedValue(undefined)
    await providers.remove("p1")
    expect(mockSecrets.remove).toHaveBeenCalledWith(secretRefFor("p1"))
    const deleteCall = mockExecute.mock.calls.find((c) => String(c[0]).includes("DELETE FROM providers"))
    expect(deleteCall).toBeDefined()
    expect(deleteCall![1]).toEqual(["p1"])
  })

  it("setDefaultModel désactive tous les autres defaults (invariant global) avant de setter", async () => {
    mockExecute.mockResolvedValue(undefined)
    mockSelect.mockResolvedValueOnce([{ provider_id: "p1" }])
    await providers.setDefaultModel("m1")
    const calls = mockExecute.mock.calls.map((c) => String(c[0]))
    expect(calls[0]).toContain("UPDATE models SET is_default = 0 WHERE id != ?")
    expect(calls[1]).toContain("UPDATE models SET is_default = 1 WHERE id = ?")
  })

  it("setDefaultModel sur id inexistant ne modifie rien", async () => {
    mockSelect.mockResolvedValueOnce([])
    await providers.setDefaultModel("ghost")
    expect(mockExecute).not.toHaveBeenCalled()
  })

  it("addModel insère avec supports_images heuristique", async () => {
    mockExecute.mockResolvedValue(undefined)
    await providers.addModel("p1", "openai/gpt-4o")
    const [sql, bind] = mockExecute.mock.calls[0]
    expect(sql).toContain("INSERT INTO models")
    expect(bind[1]).toBe("p1")
    expect(typeof bind[3]).toBe("number")
  })

  it("update renomme sans toucher au secret si aucune clé fournie", async () => {
    mockExecute.mockResolvedValue(undefined)
    await providers.update("p1", { name: "Renommé" })
    const [sql, bind] = mockExecute.mock.calls[0]
    expect(sql).toContain("UPDATE providers SET")
    expect(bind).toContain("Renommé")
    expect(mockSecrets.set).not.toHaveBeenCalled()
  })

  it("update avec secret la réécrit dans le Credential Manager", async () => {
    mockExecute.mockResolvedValue(undefined)
    await providers.update("p1", { name: "Renommé" }, "sk-new")
    expect(mockSecrets.set).toHaveBeenCalledWith(secretRefFor("p1"), "sk-new")
  })

  it("removeModel émet DELETE FROM models", async () => {
    mockExecute.mockResolvedValue(undefined)
    await providers.removeModel("m1")
    const [sql, bind] = mockExecute.mock.calls[0]
    expect(sql).toContain("DELETE FROM models WHERE id =")
    expect(bind).toEqual(["m1"])
  })
})

describe("secretRefFor", () => {
  it("suit la convention logassist/provider/<id>", () => {
    expect(secretRefFor("p1")).toBe("logassist/provider/p1")
  })
})
