import { describe, it, expect } from "vitest"
import { API_ERROR_KINDS } from "@/lib/ai/types"
import { KIND_TO_KEY } from "@/lib/ai/errors"
import { t } from "@/i18n/fr"

describe("garde-fou i18n des erreurs", () => {
  it("chaque ApiErrorKind a une entrée traduite", () => {
    for (const k of API_ERROR_KINDS) expect(t.errors[KIND_TO_KEY[k]]).toBeTruthy()
  })
  it("le mapping couvre exactement les 8 kinds", () => {
    expect(Object.keys(KIND_TO_KEY)).toHaveLength(API_ERROR_KINDS.length)
  })
})
