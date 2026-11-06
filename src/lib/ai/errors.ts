import type { ApiErrorKind } from "./types"
import { t } from "@/i18n/fr"

// Mapping kind -> clé i18n (fr.ts utilise du camelCase), source unique partagée
// par ChatView et SettingsDialog. Le garde-fou errors.i18n.test.ts garantit
// la complétude avec API_ERROR_KINDS.
export const KIND_TO_KEY: Record<ApiErrorKind, keyof typeof t.errors> = {
  auth: "auth",
  model_not_found: "modelNotfound",
  network: "network",
  rate_limit: "rateLimit",
  quota: "quota",
  unavailable: "unavailable",
  image_unsupported: "imageUnsupported",
  unknown: "unknown",
}

export class ApiError extends Error {
  kind: ApiErrorKind
  detail?: string
  retryAfterMs?: number

  constructor(kind: ApiErrorKind, message: string, detail?: string, retryAfterMs?: number) {
    super(message)
    this.name = "ApiError"
    this.kind = kind
    this.detail = detail
    this.retryAfterMs = retryAfterMs
  }
}

const JSON_NAMED_SECRET = /("(?:authorization|api[_-]?key|token)"\s*:\s*")(?:Bearer\s+)?[^"]*(")/gi
const AUTHORIZATION_SECRET = /(\bAuthorization\s*:\s*)(?:Bearer\s+)?[^\s,;]+/gi
const NAMED_SECRET = /(\b(?:api[_-]?key|token)\s*[:=]\s*)[^\s,;&]+/gi
const BEARER_SECRET = /(\bBearer)\s+[^\s,;"']+/gi

export function redactSensitiveDetail(value: string): string {
  return value
    .replace(JSON_NAMED_SECRET, "$1[REDACTED]$2")
    .replace(AUTHORIZATION_SECRET, "$1[REDACTED]")
    .replace(NAMED_SECRET, "$1[REDACTED]")
    .replace(BEARER_SECRET, "$1 [REDACTED]")
}

// Le suffixe (?:\b|_) étend \b : snake_case (insufficient_quota) et codes réseau
// (EAI_AGAIN) n'ont pas de \b devant un underscore, l'underscore est un caractère de mot.
const QUOTA_HINTS = /\b(quota|credit|billing|insufficient)(?:\b|_)/i
const IMAGE_HINTS = /\b(image|vision|multimodal?)(?:\b|_)/i
// "failed to fetch" : rejet du fetch navigateur — CORS bloqué ou réseau coupé.
// Le reste : erreurs Node/Rust ("fetch failed").
const NETWORK_HINTS =
  /\b(getaddrinfo|enotfound|econnrefused|etimedout|econnreset|eai_again|dns|socket|tls|certificate|fetch failed|failed to fetch|cors)(?:\b|_)/i

export function normalizeHttpStatus(status: number, body: string, retryAfterMs?: number): ApiError {
  const detail = body.slice(0, 500) || undefined

  if (status === 401 || status === 403) return new ApiError("auth", "Clé API invalide ou expirée", detail)
  if (status === 404) return new ApiError("model_not_found", "Modèle inexistant chez ce fournisseur", detail)
  if (status === 429) {
    if (QUOTA_HINTS.test(body)) return new ApiError("quota", "Quota ou crédit épuisé", detail)
    return new ApiError("rate_limit", "Limite de débit atteinte", detail, retryAfterMs)
  }
  if (status === 402) return new ApiError("quota", "Quota ou crédit épuisé", detail)
  if (status >= 500) return new ApiError("unavailable", "Service momentanément indisponible", detail)
  if (status >= 400) {
    if (IMAGE_HINTS.test(body)) return new ApiError("image_unsupported", "Images non supportées par ce modèle", detail)
    return new ApiError("unknown", "Erreur inattendue du fournisseur", detail)
  }
  return new ApiError("unknown", "Erreur inattendue du fournisseur", detail)
}

export function normalizeNetworkError(err: unknown): ApiError | Error {
  if (err instanceof Error && err.name === "AbortError") return err
  const msg = err instanceof Error ? err.message : String(err)
  if (NETWORK_HINTS.test(msg))
    return new ApiError("network", "Fournisseur injoignable — vérifiez l'URL et votre connexion", msg)
  return new ApiError("unknown", "Erreur inattendue du fournisseur", msg)
}
