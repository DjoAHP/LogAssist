// Logger unique : debug no-op en production, erreurs toujours visibles.
// Garde-fou console-log.guard.test.ts : aucun console.log direct hors ce module.
const enabled = import.meta.env.DEV

export const logger = {
  debug: (...args: unknown[]) => {
    if (enabled) console.log(...args)
  },
  error: (e: unknown) => {
    console.error(e)
  },
}
