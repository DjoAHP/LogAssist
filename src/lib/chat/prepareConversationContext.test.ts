import { beforeEach, describe, expect, it, vi } from "vitest"
import type { IProvider } from "@/lib/ai/openai-compat"
import type { ProviderConfig } from "@/lib/ai/types"
import type { ContextSession, ContextTokenEstimator } from "@/lib/context"
import type { KnowledgeRow } from "@/lib/db/knowledge"
import { prepareConversationContext } from "./prepareConversationContext"

const provider: ProviderConfig = {
  id: "lm-studio",
  name: "LM Studio",
  apiFamily: "openai",
  baseUrl: "http://localhost:1234/v1",
  secretRef: "logassist/provider/lm-studio",
}

function knowledgeRow(): KnowledgeRow {
  return {
    id: "k1",
    name: "HISE",
    content: "# Gain\nRégler gain",
    enabled: 1,
    sort_order: 3,
    created_at: "2026-01-01 00:00:00",
  }
}

function createEstimator(): ContextTokenEstimator {
  return {
    kind: "conservative",
    countText: (text) => Math.ceil(text.length / 4),
    countMessage: vi.fn(),
    countMessages: vi.fn(),
    countTools: vi.fn(),
    countImage: vi.fn(),
    dispose: vi.fn(),
  }
}

const session = (): ContextSession => ({
  prepareRound: vi.fn(),
  estimateOutput: vi.fn(),
  dispose: vi.fn(),
}) as unknown as ContextSession

describe("prepareConversationContext", () => {
  const inspectModelContext = vi.fn()
  const providerAdapter = { inspectModelContext } as unknown as IProvider

  beforeEach(() => {
    vi.clearAllMocks()
    inspectModelContext.mockResolvedValue({ contextWindowTokens: 8192, source: "loaded" })
  })

  it("prépare une session avec la dernière ligne user comme message courant", async () => {
    const estimator = createEstimator()
    const preparedSession = session()
    const createSession = vi.fn().mockReturnValue(preparedSession)
    const resolveProfile = vi.fn().mockResolvedValue({
      contextWindowTokens: 8192,
      maxOutputTokens: 1024,
      source: "provider_loaded",
      tokenizer: "openai_tiktoken",
    })

    const result = await prepareConversationContext({
      conversationId: "c1",
      history: [
        { id: "u1", role: "user", content: "Ancienne question" },
        { id: "a1", role: "assistant", content: "Ancienne réponse" },
        { id: "u2", role: "user", content: "Question courante" },
      ],
      currentImages: [{ base64: "PRIVATE_BASE64", mimeType: "image/png", width: 800, height: 600 }],
      provider,
      providerAdapter,
      apiKey: "PRIVATE_KEY",
      modelId: "qwen",
      contextWindowOverride: null,
      maxOutputTokensOverride: null,
      webEnabled: true,
    }, {
      loadPromptSettings: vi.fn().mockResolvedValue({ general: "GEN", profile: "PROF" }),
      loadKnowledge: vi.fn().mockResolvedValue([knowledgeRow()]),
      resolveProfile,
      createEstimator: vi.fn().mockReturnValue(estimator),
      createSession,
    })

    expect(result).toBe(preparedSession)
    expect(createSession).toHaveBeenCalledWith(expect.objectContaining({
      baseSystem: expect.stringMatching(/GEN[\s\S]*PROF[\s\S]*contenu Web externe/),
      documents: [{ id: "k1", name: "HISE", content: "# Gain\nRégler gain", sortOrder: 3 }],
      history: [
        { id: "u1", role: "user", content: "Ancienne question" },
        { id: "a1", role: "assistant", content: "Ancienne réponse" },
      ],
      currentUser: expect.objectContaining({
        content: "Question courante",
        images: [expect.objectContaining({ width: 800, height: 600 })],
      }),
      retrievalQuery: expect.stringMatching(/Question courante[\s\S]*Ancienne question/),
      profile: expect.objectContaining({ tokenizer: "conservative" }),
      onDiagnostic: expect.any(Function),
    }))
    const resolutionInput = resolveProfile.mock.calls[0][0]
    expect(resolutionInput).toMatchObject({
      cacheKey: "lm-studio/qwen",
      contextWindowOverride: null,
      maxOutputTokensOverride: null,
      registryContextWindow: null,
    })
    await expect(resolutionInput.inspect()).resolves.toEqual({ contextWindowTokens: 8192, source: "loaded" })
    expect(inspectModelContext).toHaveBeenCalledWith("PRIVATE_KEY", "qwen")
  })

  it("borne la requête de retrieval aux deux derniers users antérieurs", async () => {
    const createSession = vi.fn().mockReturnValue(session())
    await prepareConversationContext({
      conversationId: "c1",
      history: [
        { id: "u0", role: "user", content: "TROP_ANCIEN" },
        { id: "u1", role: "user", content: `PRECEDENT_1 ${"a".repeat(3000)}` },
        { id: "u2", role: "user", content: `PRECEDENT_2 ${"b".repeat(3000)}` },
        { id: "u3", role: "user", content: "COURANT" },
      ],
      currentImages: [],
      provider,
      providerAdapter,
      apiKey: "key",
      modelId: "qwen",
      contextWindowOverride: null,
      maxOutputTokensOverride: null,
      webEnabled: false,
    }, {
      loadPromptSettings: vi.fn().mockResolvedValue({ general: "", profile: "" }),
      loadKnowledge: vi.fn().mockResolvedValue([]),
      resolveProfile: vi.fn().mockResolvedValue({
        contextWindowTokens: 4096,
        maxOutputTokens: 1024,
        source: "fallback",
        tokenizer: "conservative",
      }),
      createEstimator: vi.fn().mockReturnValue(createEstimator()),
      createSession,
    })

    const query = createSession.mock.calls[0][0].retrievalQuery as string
    expect(query).toContain("COURANT")
    expect(query).toContain("PRECEDENT_1")
    expect(query).toContain("PRECEDENT_2")
    expect(query).not.toContain("TROP_ANCIEN")
    expect(Array.from(query).length).toBeLessThanOrEqual(4000 + "COURANT".length + 4)
  })

  it("refuse un historique dont la dernière ligne n’est pas user", async () => {
    const loadPromptSettings = vi.fn()
    await expect(prepareConversationContext({
      conversationId: "c1",
      history: [{ id: "a1", role: "assistant", content: "Réponse orpheline" }],
      currentImages: [],
      provider,
      providerAdapter,
      apiKey: "key",
      modelId: "qwen",
      contextWindowOverride: null,
      maxOutputTokensOverride: null,
      webEnabled: false,
    }, {
      loadPromptSettings,
      loadKnowledge: vi.fn(),
      resolveProfile: vi.fn(),
      createEstimator: vi.fn(),
      createSession: vi.fn(),
    })).rejects.toThrow("dernier message")
    expect(loadPromptSettings).not.toHaveBeenCalled()
  })

  it("libère l’estimateur si la création de session échoue", async () => {
    const estimator = createEstimator()
    await expect(prepareConversationContext({
      conversationId: "c1",
      history: [{ id: "u1", role: "user", content: "Question" }],
      currentImages: [],
      provider,
      providerAdapter,
      apiKey: "key",
      modelId: "qwen",
      contextWindowOverride: null,
      maxOutputTokensOverride: null,
      webEnabled: false,
    }, {
      loadPromptSettings: vi.fn().mockResolvedValue({ general: "", profile: "" }),
      loadKnowledge: vi.fn().mockResolvedValue([]),
      resolveProfile: vi.fn().mockResolvedValue({
        contextWindowTokens: 4096,
        maxOutputTokens: 1024,
        source: "fallback",
        tokenizer: "conservative",
      }),
      createEstimator: vi.fn().mockReturnValue(estimator),
      createSession: vi.fn(() => { throw new Error("session failed") }),
    })).rejects.toThrow("session failed")
    expect(estimator.dispose).toHaveBeenCalledTimes(1)
  })
})
