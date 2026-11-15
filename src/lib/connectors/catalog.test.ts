import { describe, expect, it } from "vitest"
import { CONNECTORS } from "./catalog"

describe("CONNECTORS", () => {
  it("déclare github comme connecteur natif avec sa référence secrète", () => {
    expect(CONNECTORS).toHaveLength(1)
    const gh = CONNECTORS[0]
    expect(gh.id).toBe("github")
    expect(gh.backend).toBe("native")
    expect(gh.secretRef).toBe("logassist/connectors/github")
    expect(gh.name).toBe("GitHub")
  })

  it("interdit les identifiants et références secrètes vides", () => {
    for (const c of CONNECTORS) {
      expect(c.id.length).toBeGreaterThan(0)
      expect(c.secretRef.length).toBeGreaterThan(0)
    }
  })
})
