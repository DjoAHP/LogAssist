import { describe, it, expect } from "vitest"
import { API_ERROR_KINDS } from "@/lib/ai/types"
import { t } from "@/i18n/fr"

// Mapping kind -> clé i18n (fr.ts utilise du camelCase)
const KIND_TO_KEY: Record<string, keyof typeof t.errors> = {
  auth: "auth",
  model_not_found: "modelNotfound",
  network: "network",
  rate_limit: "rateLimit",
  quota: "quota",
  unavailable: "unavailable",
  image_unsupported: "imageUnsupported",
  unknown: "unknown",
}

describe("garde-fou i18n des erreurs", () => {
  it("chaque ApiErrorKind a une entrée traduite", () => {
    for (const k of API_ERROR_KINDS) expect(t.errors[KIND_TO_KEY[k]]).toBeTruthy()
  })
  it("le mapping couvre exactement les 8 kinds", () => {
    expect(Object.keys(KIND_TO_KEY)).toHaveLength(API_ERROR_KINDS.length)
  })
})
