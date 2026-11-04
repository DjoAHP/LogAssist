import { describe, it, expect } from "vitest"
import { isLocalBaseUrl, LOCAL_LLM_PRESETS, LOCAL_DUMMY_SECRET } from "./local"

describe("isLocalBaseUrl", () => {
  it("accepte localhost et 127.0.0.1 sur port arbitraire, avec ou sans /v1", () => {
    expect(isLocalBaseUrl("http://localhost:1234/v1")).toBe(true)
    expect(isLocalBaseUrl("http://localhost:1234/v1/models")).toBe(true)
    expect(isLocalBaseUrl("http://127.0.0.1:11434/v1")).toBe(true)
    expect(isLocalBaseUrl("http://localhost:9000")).toBe(true)
  })
  it("refuse le http externe : IP LAN, https distant, hostname quelconque", () => {
    expect(isLocalBaseUrl("http://192.168.1.5:1234/v1")).toBe(false)
    expect(isLocalBaseUrl("https://localhost:1234/v1")).toBe(false)
    expect(isLocalBaseUrl("http://myserver:1234/v1")).toBe(false)
    expect(isLocalBaseUrl("https://openrouter.ai/api/v1")).toBe(false)
  })
})

describe("LOCAL_LLM_PRESETS", () => {
  it("contient exactement LM Studio et Ollama aux URLs canoniques", () => {
    expect(LOCAL_LLM_PRESETS.map((p) => p.id)).toEqual(["lmstudio", "ollama"])
    expect(LOCAL_LLM_PRESETS.map((p) => p.url)).toEqual(["http://localhost:1234/v1", "http://localhost:11434/v1"])
    expect(LOCAL_DUMMY_SECRET).toBe("not-needed")
  })
})
