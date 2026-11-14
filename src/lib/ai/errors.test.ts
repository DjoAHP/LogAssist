import { describe, it, expect } from "vitest"
import {
  normalizeHttpStatus,
  normalizeNetworkError,
  normalizeApiErrorKind,
  redactSensitiveDetail,
  ApiError,
} from "@/lib/ai/errors"
import { API_ERROR_KINDS } from "@/lib/ai/types"

describe("redactSensitiveDetail", () => {
  it("masque un bearer token", () => {
    expect(redactSensitiveDetail("Bearer sk-secret-value"))
      .toBe("Bearer [REDACTED]")
  })

  it.each([
    ["Authorization: abc123", "Authorization: [REDACTED]"],
    ["Authorization: Basic abc123", "Authorization: [REDACTED]"],
    ["Authorization: Token abc123", "Authorization: [REDACTED]"],
    ["api_key=abc123", "api_key=[REDACTED]"],
    ["api-key: abc123", "api-key: [REDACTED]"],
    ["token=abc123", "token=[REDACTED]"],
  ])("masque %s", (input, expected) => {
    expect(redactSensitiveDetail(input)).toBe(expected)
  })

  it("arrête la redaction Authorization à la fin de ligne", () => {
    expect(redactSensitiveDetail("Authorization: Basic abc123\nstatus: denied"))
      .toBe("Authorization: [REDACTED]\nstatus: denied")
  })

  it("masque une valeur Digest complète avec virgules et points-virgules", () => {
    const redacted = redactSensitiveDetail(
      'Authorization: Digest username="admin", nonce="abc"; response="deadbeef"\nstatus: denied',
    )

    expect(redacted).toBe("Authorization: [REDACTED]\nstatus: denied")
    expect(redacted).not.toContain("nonce")
    expect(redacted).not.toContain("response")
  })

  it.each([
    ['{"api_key":"sk-secret"}', '{"api_key":"[REDACTED]"}'],
    ['{"token":"abc"}', '{"token":"[REDACTED]"}'],
    ['{"Authorization":"abc"}', '{"Authorization":"[REDACTED]"}'],
    ['{"Authorization":"Bearer sk-secret"}', '{"Authorization":"[REDACTED]"}'],
    ['{"api-key"  :  "abc123"}', '{"api-key"  :  "[REDACTED]"}'],
  ])("masque exactement le secret JSON dans %s", (input, expected) => {
    expect(redactSensitiveDetail(input)).toBe(expected)
  })

  it("conserve un message ordinaire utile", () => {
    const message = "Le fournisseur a refusé le modèle demandé"
    expect(redactSensitiveDetail(message)).toBe(message)
  })

  it.each([
    "Incorrect API key provided: sk-live-secret",
    "Credential sk-live-secret was rejected",
    "The supplied value sk-live-secret is invalid",
  ])("masque le secret exact dans une phrase libre : %s", (input) => {
    const redacted = redactSensitiveDetail(input, ["sk-live-secret"])

    expect(redacted).not.toContain("sk-live-secret")
    expect(redacted).toContain("[REDACTED]")
  })

  it("ignore les secrets exacts vides ou composés d'espaces", () => {
    expect(redactSensitiveDetail("message intact", ["", "   "])).toBe("message intact")
  })

  it("remplace littéralement un secret contenant des caractères regex", () => {
    const redacted = redactSensitiveDetail(
      "Credential sk.a+b/c= was rejected",
      ["sk.a+b/c="],
    )

    expect(redacted).toBe("Credential [REDACTED] was rejected")
  })

  it("masque par défense une clé OpenAI-like sans masquer sk- isolé", () => {
    expect(redactSensitiveDetail("clé sk-or-v1-history rejetée, marqueur sk- conservé"))
      .toBe("clé [REDACTED] rejetée, marqueur sk- conservé")
  })
})

describe("normalizeApiErrorKind", () => {
  it.each(API_ERROR_KINDS)("conserve le kind valide %s", (kind) => {
    expect(normalizeApiErrorKind(kind)).toBe(kind)
  })

  it.each(["custom", "CUSTOM.key+42/=", 401, null, undefined, {}])(
    "rabats une valeur runtime inconnue sur unknown : %o",
    (value) => {
      expect(normalizeApiErrorKind(value)).toBe("unknown")
    },
  )
})

describe("normalizeHttpStatus", () => {
  it("401 → auth", () => {
    const e = normalizeHttpStatus(401, '{"error":"bad key"}')
    expect(e.kind).toBe("auth")
    expect(e.detail).toContain("bad key")
  })
  it("403 → auth", () => { expect(normalizeHttpStatus(403, "").kind).toBe("auth") })
  it("404 → model_not_found", () => { expect(normalizeHttpStatus(404, "").kind).toBe("model_not_found") })
  it("429 avec retry-after → rate_limit et retryAfterMs", () => {
    const e = normalizeHttpStatus(429, "", 800)
    expect(e.kind).toBe("rate_limit")
    expect(e.retryAfterMs).toBe(800)
  })
  it("429 avec quota dans le corps / 402 → quota", () => {
    expect(normalizeHttpStatus(429, "insufficient_quota").kind).toBe("quota")
    expect(normalizeHttpStatus(402, "").kind).toBe("quota")
  })
  it("5xx → unavailable", () => {
    expect(normalizeHttpStatus(503, "").kind).toBe("unavailable")
    expect(normalizeHttpStatus(500, "").kind).toBe("unavailable")
  })
  it("400 avec image dans le corps → image_unsupported", () => {
    expect(normalizeHttpStatus(400, "image not supported").kind).toBe("image_unsupported")
  })
  it("400 avec \"multimodal\" dans le corps → image_unsupported", () => {
    expect(normalizeHttpStatus(400, "Multimodal inputs not supported").kind).toBe("image_unsupported")
  })
  it.each([
    "n_keep: 37609 >= n_ctx: 8192",
    "maximum context length is 8192 tokens",
    "prompt is too long for this model",
  ])("classe un dépassement de contexte : %s", (body) => {
    expect(normalizeHttpStatus(400, body)).toMatchObject({ kind: "context_length" })
  })
  it("400 sans motif connu → unknown avec détail", () => {
    const e = normalizeHttpStatus(400, '{"error": {"message": "foo"}}')
    expect(e.kind).toBe("unknown")
    expect(e.detail).toContain("foo")
  })
})

describe("normalizeNetworkError", () => {
  it("ECONNREFUSED → network", () => {
    expect((normalizeNetworkError(new Error("fetch failed: ECONNREFUSED")) as ApiError).kind).toBe("network")
  })
  it("getaddrinfo ENOTFOUND → network", () => {
    expect((normalizeNetworkError(new Error("getaddrinfo ENOTFOUND api.ex.test")) as ApiError).kind).toBe("network")
  })
  it("AbortError propagé tel quel (flux interrompu volontaire ≠ erreur)", () => {
    const abort = new Error("aborted"); abort.name = "AbortError"
    expect(normalizeNetworkError(abort)).toBe(abort)
  })
  it("message disconnected sans hint réseau → unknown (plus network)", () => {
    expect((normalizeNetworkError(new Error("session disconnected")) as ApiError).kind).toBe("unknown")
  })
  it("erreur inconnue → kind unknown", () => {
    expect((normalizeNetworkError("boom") as ApiError).kind).toBe("unknown")
  })
})

describe("ApiError", () => {
  it("porte kind, detail, retryAfterMs", () => {
    const e = new ApiError("quota", "q", "détail", 100)
    expect(e.kind).toBe("quota"); expect(e.detail).toBe("détail"); expect(e.retryAfterMs).toBe(100)
  })
})
