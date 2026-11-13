// Nettoyage d'URL d'API partagé par le formulaire et l'adaptateur
// openai-compatible : un seul invariant, une seule implémentation testée.
// IMPORTANT : on ne retire que le suffixe FINAL (/chat/completions, /models)
// — retirer "/v1/models" entier ferait perdre le /v1 requis par les
// fournisseurs (LM Studio, Ollama, OpenRouter…).

export function cleanApiBaseUrl(url: string): string {
  return url.replace(/\/+$/, "").replace(/\/(chat\/completions|models)$/, "")
}

/**
 * Reconnaît uniquement l'origine HTTPS officielle OpenAI. Le chemin reste
 * libre (`/v1`, `/v1/chat/completions`…), mais aucun proxy ni credential URL
 * ne doit pouvoir hériter des options ou tarifs réservés à OpenAI.
 */
export function isOfficialOpenAiBaseUrl(baseUrl: string): boolean {
  try {
    const endpoint = new URL(baseUrl)
    return endpoint.protocol === "https:" &&
      endpoint.hostname === "api.openai.com" &&
      endpoint.port === "" &&
      endpoint.username === "" &&
      endpoint.password === ""
  } catch {
    return false
  }
}

/** Autorise uniquement une API HTTP(S) liée à la boucle locale. */
export function isLoopbackApiBaseUrl(baseUrl: string): boolean {
  try {
    const url = new URL(baseUrl)
    if (url.protocol !== "http:" && url.protocol !== "https:") return false
    const host = url.hostname.replace(/^\[|\]$/g, "").toLowerCase()
    return host === "localhost" || host === "::1" || /^127(?:\.\d{1,3}){3}$/.test(host)
  } catch {
    return false
  }
}
