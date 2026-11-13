import { describe, it, expect } from "vitest"
import { cleanApiBaseUrl, isOfficialOpenAiBaseUrl } from "./url"
import * as urlTools from "./url"

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

describe("isLoopbackApiBaseUrl", () => {
  const isLoopbackApiBaseUrl = (urlTools as typeof urlTools & {
    isLoopbackApiBaseUrl(baseUrl: string): boolean
  }).isLoopbackApiBaseUrl

  it.each([
    "http://localhost:1234/v1",
    "http://127.0.0.1:1234/v1",
    "http://[::1]:1234/v1",
  ])("reconnaît une API loopback : %s", (baseUrl) => {
    expect(urlTools).toHaveProperty("isLoopbackApiBaseUrl")
    expect(isLoopbackApiBaseUrl(baseUrl)).toBe(true)
  })

  it.each([
    "https://openrouter.ai/api/v1",
    "http://192.168.1.20:1234/v1",
    "https://example.com/v1",
  ])("refuse une API non loopback : %s", (baseUrl) => {
    expect(urlTools).toHaveProperty("isLoopbackApiBaseUrl")
    expect(isLoopbackApiBaseUrl(baseUrl)).toBe(false)
  })
})
