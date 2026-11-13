import { describe, expect, it } from "vitest"
import type { ChatMessage, ToolDefinition } from "@/lib/ai/types"
import { createTokenEstimator } from "./tokenEstimator"

describe("createTokenEstimator", () => {
  it("utilise une heuristique conservatrice pour un modèle local", () => {
    const estimator = createTokenEstimator({
      baseUrl: "http://localhost:1234/v1",
      modelId: "qwen3.5-9b",
    })

    expect(estimator.kind).toBe("conservative")
    expect(estimator.countText("a".repeat(300))).toBeGreaterThanOrEqual(100)
    expect(estimator.countText("漢字".repeat(50))).toBeGreaterThanOrEqual(100)
    estimator.dispose()
  })

  it("utilise tiktoken uniquement pour un modèle OpenAI officiel connu", () => {
    const official = createTokenEstimator({
      baseUrl: "https://api.openai.com/v1",
      modelId: "gpt-4o-mini",
    })
    const proxy = createTokenEstimator({
      baseUrl: "https://openrouter.ai/api/v1",
      modelId: "openai/gpt-4o-mini",
    })

    expect(official.kind).toBe("openai_tiktoken")
    expect(proxy.kind).toBe("conservative")
    official.dispose()
    proxy.dispose()
  })

  it("ne fait jamais dépendre le coût image de la longueur Base64", () => {
    const estimator = createTokenEstimator({
      baseUrl: "http://localhost:1234/v1",
      modelId: "qwen",
    })
    const short = estimator.countImage({
      base64: "A",
      mimeType: "image/png",
      width: 1024,
      height: 768,
    })
    const long = estimator.countImage({
      base64: "A".repeat(1_000_000),
      mimeType: "image/png",
      width: 1024,
      height: 768,
    })

    expect(short).toBe(long)
    expect(short).toBeGreaterThan(0)
    estimator.dispose()
  })

  it("réserve 4096 tokens si les dimensions image sont inconnues", () => {
    const estimator = createTokenEstimator({ baseUrl: "https://example.com/v1", modelId: "m" })
    expect(estimator.countImage({ base64: "A", mimeType: "image/png" })).toBe(4096)
    estimator.dispose()
  })

  it("compte les schémas et descriptions d’outils", () => {
    const estimator = createTokenEstimator({ baseUrl: "https://example.com/v1", modelId: "m" })
    const tools: ToolDefinition[] = [{
      type: "function",
      function: {
        name: "search",
        description: "Recherche documentaire détaillée",
        parameters: { type: "object", properties: { query: { type: "string" } } },
      },
    }]

    expect(estimator.countTools(tools)).toBeGreaterThan(estimator.countTools([]))
    estimator.dispose()
  })

  it("compte le contenu, les rôles et les appels d’outils sans muter le message", () => {
    const estimator = createTokenEstimator({ baseUrl: "https://example.com/v1", modelId: "m" })
    const message: ChatMessage = {
      role: "assistant",
      content: "Résultat",
      toolCalls: [{ id: "c1", name: "search", arguments: { query: "Tauri" } }],
    }
    const original = structuredClone(message)

    expect(estimator.countMessage(message)).toBeGreaterThan(estimator.countText(message.content))
    expect(message).toEqual(original)
    estimator.dispose()
  })
})
