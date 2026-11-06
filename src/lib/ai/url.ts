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
