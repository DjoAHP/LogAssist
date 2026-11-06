import { describe, it, expect } from "vitest"
import { cleanApiBaseUrl, isOfficialOpenAiBaseUrl } from "./url"

describe("cleanApiBaseUrl", () => {
  it("retire les trailing slashes et le suffixe finales connus, sans toucher au /v1", () => {
    expect(cleanApiBaseUrl("https://openrouter.ai/api/v1/")).toBe("https://openrouter.ai/api/v1")
    expect(cleanApiBaseUrl("https://openrouter.ai/api/v1/models")).toBe("https://openrouter.ai/api/v1")
    expect(cleanApiBaseUrl("http://localhost:1234/v1/chat/completions")).toBe("http://localhost:1234/v1")
    expect(cleanApiBaseUrl("http://localhost:1234/v1")).toBe("http://localhost:1234/v1")
    expect(cleanApiBaseUrl("http://localhost:1234/v1/models/")).toBe("http://localhost:1234/v1")
  })
})

describe("isOfficialOpenAiBaseUrl", () => {
  it.each([
    "https://api.openai.com/v1",
    "HTTPS://API.OPENAI.COM/V1/chat/completions",
    "https://api.openai.com:443/v1",
  ])("reconnaît l'endpoint officiel strict : %s", (baseUrl) => {
    expect(isOfficialOpenAiBaseUrl(baseUrl)).toBe(true)
  })

  it.each([
    "https://api.openai.com.evil.test/v1",
    "https://openrouter.ai/api/v1",
    "http://api.openai.com/v1",
    "https://api.openai.com:444/v1",
    "https://user:pass@api.openai.com/v1",
    "http://localhost:1234/v1",
    "invalid",
  ])("refuse un endpoint non officiel : %s", (baseUrl) => {
    expect(isOfficialOpenAiBaseUrl(baseUrl)).toBe(false)
  })
})
