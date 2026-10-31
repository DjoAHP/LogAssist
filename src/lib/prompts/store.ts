import { settings } from "@/lib/db/settings"
import { DEFAULT_GENERAL_INSTRUCTIONS, PROFILE_APPRENTISSAGE } from "./defaults"

export interface PromptSettings {
  general: string
  profile: string
}

export const PROMPT_KEYS = {
  general: "prompt.general",
  profile: "prompt.profile",
} as const

// Sémantique clé absente → défaut ; clé présente (même "") → choix de
// l'utilisateur. « Restaurer les défauts » supprimera la clé via set(defaults).
export async function loadPromptSettings(): Promise<PromptSettings> {
  const [general, profile] = await Promise.all([
    settings.get(PROMPT_KEYS.general),
    settings.get(PROMPT_KEYS.profile),
  ])
  return {
    general: general ?? DEFAULT_GENERAL_INSTRUCTIONS,
    profile: profile ?? PROFILE_APPRENTISSAGE,
  }
}

export async function savePromptSettings(next: { general: string; profile: string }): Promise<void> {
  await settings.set(PROMPT_KEYS.general, next.general)
  await settings.set(PROMPT_KEYS.profile, next.profile)
}
