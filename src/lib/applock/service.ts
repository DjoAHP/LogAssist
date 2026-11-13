// Pont du verrou de confort : commandes Rust dédiées (hachage/vérification) +
// flag d'activation dans la table settings. Le hash vit uniquement dans le
// Credential Manager (logassist/lock) — jamais en SQLite ni en localStorage.
// Le mot de passe en clair ne traverse que ces appels invoke, jamais un log.
import { invoke } from "@tauri-apps/api/core"
import { settings } from "@/lib/db/settings"

export const LOCK_ENABLED_KEY = "lock.enabled"

export const applock = {
  async isEnabled(): Promise<boolean> {
    return (await settings.get(LOCK_ENABLED_KEY)) === "1"
  },
  async setEnabled(enabled: boolean): Promise<void> {
    await settings.set(LOCK_ENABLED_KEY, enabled ? "1" : "0")
  },
  set(password: string): Promise<void> {
    return invoke<void>("set_applock_secret", { password })
  },
  async verify(candidate: string): Promise<boolean> {
    return invoke<boolean>("verify_applock_secret", { candidate })
  },
  async isConfigured(): Promise<boolean> {
    return invoke<boolean>("applock_configured")
  },
  remove(): Promise<void> {
    return invoke<void>("remove_applock_secret")
  },
}

// Verrou actif = flag activé ET hash présent. Si le hash a disparu du
// Credential Manager (entrée effacée à la main), fail-open : le flag est
// remis à zéro pour ne jamais bloquer l'app de façon irrécupérable.
export async function isLockActive(): Promise<boolean> {
  if (!(await applock.isEnabled())) return false
  if (await applock.isConfigured()) return true
  await applock.setEnabled(false)
  return false
}
