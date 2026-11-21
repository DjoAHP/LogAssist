import { afterEach, describe, expect, it, vi } from "vitest"

afterEach(() => {
  vi.unstubAllEnvs()
  vi.resetModules()
})

describe("édition compilée", () => {
  it("vaut desktop quand VITE_EDITION est absente (développement et tests)", async () => {
    vi.stubEnv("VITE_EDITION", "")
    vi.resetModules()
    const { isPortableEdition } = await import("./edition")
    expect(isPortableEdition).toBe(false)
  })

  it("vaut portable quand VITE_EDITION=portable", async () => {
    vi.stubEnv("VITE_EDITION", "portable")
    vi.resetModules()
    const { isPortableEdition } = await import("./edition")
    expect(isPortableEdition).toBe(true)
  })
})
