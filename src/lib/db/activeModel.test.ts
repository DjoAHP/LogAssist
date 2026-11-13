import { beforeEach, describe, expect, it, vi } from "vitest"

const mockSelect = vi.hoisted(() => vi.fn())

vi.mock("./database", () => ({
  select: (...args: unknown[]) => mockSelect(...args),
}))

import { getActiveModel } from "./activeModel"

beforeEach(() => {
  vi.clearAllMocks()
})

describe("getActiveModel", () => {
  it("remonte la ligne modèle et ses overrides de contexte", async () => {
    mockSelect.mockResolvedValueOnce([{
      id: "provider-1",
      name: "LM Studio",
      api_family: "openai",
      base_url: "http://localhost:1234/v1",
      model_row_id: "model-row-1",
      model_id: "qwen3.5-9b",
      context_window_override: 8192,
      max_output_tokens_override: 1024,
    }])

    expect(await getActiveModel()).toMatchObject({
      modelRowId: "model-row-1",
      modelId: "qwen3.5-9b",
      contextWindowOverride: 8192,
      maxOutputTokensOverride: 1024,
    })
  })

  it("conserve null quand les overrides sont automatiques", async () => {
    mockSelect.mockResolvedValueOnce([{
      id: "provider-1",
      name: "OpenRouter",
      api_family: "openai",
      base_url: "https://openrouter.ai/api/v1",
      model_row_id: "model-row-1",
      model_id: "openai/gpt-4o-mini",
      context_window_override: null,
      max_output_tokens_override: null,
    }])

    expect(await getActiveModel()).toMatchObject({
      contextWindowOverride: null,
      maxOutputTokensOverride: null,
    })
  })
})
