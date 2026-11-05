import { describe, expect, it } from "vitest"
import { formatCostMicrousd, formatTokens } from "./format"

describe("token formatters", () => {
  it("convertit les microdollars en dollars avant formatage", () => {
    expect(formatCostMicrousd(450)).toBe("$0.0005")
    expect(formatCostMicrousd(450_000)).toBe("$0.450")
  })

  it("compacte les volumes de tokens", () => {
    expect(formatTokens(1_200)).toBe("1.2k")
    expect(formatTokens(120)).toBe("120")
  })
})
