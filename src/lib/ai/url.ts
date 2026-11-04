// Nettoyage d'URL d'API partagé par le formulaire et l'adaptateur
// openai-compatible : un seul invariant, une seule implémentation testée.
// IMPORTANT : on ne retire que le suffixe FINAL (/chat/completions, /models)
// — retirer "/v1/models" entier ferait perdre le /v1 requis par les
// fournisseurs (LM Studio, Ollama, OpenRouter…).

export function cleanApiBaseUrl(url: string): string {
  return url.replace(/\/+$/, "").replace(/\/(chat\/completions|models)$/, "")
}
