import { describe, it, expect } from "vitest"
import { cleanApiBaseUrl } from "./url"

describe("cleanApiBaseUrl", () => {
  it("retire les trailing slashes et le suffixe finales connus, sans toucher au /v1", () => {
    expect(cleanApiBaseUrl("https://openrouter.ai/api/v1/")).toBe("https://openrouter.ai/api/v1")
    expect(cleanApiBaseUrl("https://openrouter.ai/api/v1/models")).toBe("https://openrouter.ai/api/v1")
    expect(cleanApiBaseUrl("http://localhost:1234/v1/chat/completions")).toBe("http://localhost:1234/v1")
    expect(cleanApiBaseUrl("http://localhost:1234/v1")).toBe("http://localhost:1234/v1")
    expect(cleanApiBaseUrl("http://localhost:1234/v1/models/")).toBe("http://localhost:1234/v1")
  })
})
