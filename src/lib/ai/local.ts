// Modèles locaux (LM Studio, Ollama) : les deux serveurs parlent le dialecte
// OpenAI-compatible. La boucle locale est la SEULE exception autorisée au
// http non chiffré — tout le reste du trafic LLM reste en https.

export interface LocalLlmPreset {
  id: "lmstudio" | "ollama"
  name: string
  url: string
}

// Ports canoniques : LM Studio 1234, Ollama 11434. La boucle locale
// exclusive (localhost / 127.0.0.1) empêche toute IP réseau externe.
export const LOCAL_LLM_PRESETS: readonly LocalLlmPreset[] = [
  { id: "lmstudio", name: "LM Studio", url: "http://localhost:1234/v1" },
  { id: "ollama", name: "Ollama", url: "http://localhost:11434/v1" },
] as const

// Les serveurs locaux ignorent l'en-tête Bearer : ce secret factice existe
// uniquement pour que testConnection / listRemoteModels passent la garde "noKey".
export const LOCAL_DUMMY_SECRET = "not-needed"

// true ssi boucle locale : http://localhost:<port> ou http://127.0.0.1:<port>,
// port arbitraire, chemin libre (/v1…). Ni https, ni IP LAN, ni hostname.
export function isLocalBaseUrl(url: string): boolean {
  return /^http:\/\/(localhost|127\.0\.0\.1):\d+(\/|$)/.test(url)
}
