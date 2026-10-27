import { invoke } from "@tauri-apps/api/core"

export const secrets = {
  set: (secretRef: string, value: string) => invoke<void>("set_secret", { secretRef, value }),
  get: async (secretRef: string): Promise<string | null> => invoke<string | null>("get_secret", { secretRef }),
  remove: (secretRef: string) => invoke<void>("delete_secret", { secretRef }),
}
