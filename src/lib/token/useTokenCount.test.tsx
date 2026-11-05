// @vitest-environment jsdom

import { renderHook, waitFor } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"

const tiktokenMocks = vi.hoisted(() => ({
  encodingForModel: vi.fn(),
  getEncoding: vi.fn(),
}))

vi.mock("@dqbd/tiktoken", () => ({
  encoding_for_model: tiktokenMocks.encodingForModel,
  get_encoding: tiktokenMocks.getEncoding,
}))

import { countTokens, useTokenCount } from "./useTokenCount"

function createEncoder(tokenCounts: Record<string, number> = {}) {
  return {
    encode: vi.fn((text: string) => ({ length: tokenCounts[text] ?? 1 })),
    free: vi.fn(),
  }
}

describe("ancien compteur de tokens", () => {
  beforeEach(() => {
    tiktokenMocks.encodingForModel.mockReset()
    tiktokenMocks.getEncoding.mockReset()
  })

  it("conserve le coût historique en USD par million et libère l'encodeur au démontage", async () => {
    const bootstrapEncoder = createEncoder()
    const persistentEncoder = createEncoder({ entrée: 1_000, sortie: 500 })
    tiktokenMocks.encodingForModel
      .mockReturnValueOnce(bootstrapEncoder)
      .mockReturnValueOnce(persistentEncoder)

    const { result, unmount } = renderHook(() => useTokenCount(
      "OpenAI",
      "gpt-4o-mini",
      [
        { role: "user", content: "entrée" },
        { role: "assistant", content: "sortie" },
      ],
    ))

    await waitFor(() => expect(result.current.inputTokens).toBe(1_000))
    expect(result.current.outputTokens).toBe(500)
    expect(result.current.estimatedCost).toBe(0.00045)
    expect(persistentEncoder.free).not.toHaveBeenCalled()

    unmount()
    expect(persistentEncoder.free).toHaveBeenCalledOnce()
  })

  it("libère l'encodeur principal avant le repli de countTokens", () => {
    const primaryEncoder = createEncoder()
    primaryEncoder.encode.mockImplementation(() => {
      throw new Error("encodage principal impossible")
    })
    const fallbackEncoder = createEncoder({ texte: 2 })
    tiktokenMocks.encodingForModel.mockReturnValue(primaryEncoder)
    tiktokenMocks.getEncoding.mockReturnValue(fallbackEncoder)

    expect(countTokens("texte")).toBe(2)
    expect(primaryEncoder.free).toHaveBeenCalledOnce()
    expect(fallbackEncoder.free).toHaveBeenCalledOnce()
  })

  it("libère l'encodeur de repli même si son encodage échoue", () => {
    const fallbackEncoder = createEncoder()
    fallbackEncoder.encode.mockImplementation(() => {
      throw new Error("encodage de repli impossible")
    })
    tiktokenMocks.encodingForModel.mockImplementation(() => {
      throw new Error("modèle inconnu")
    })
    tiktokenMocks.getEncoding.mockReturnValue(fallbackEncoder)

    expect(() => countTokens("texte")).toThrow("encodage de repli impossible")
    expect(fallbackEncoder.free).toHaveBeenCalledOnce()
  })
})
