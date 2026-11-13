import { defineConfig } from "vitest/config"
import path from "node:path"
import { versionDefine } from "./shared/buildVersion"

export default defineConfig({
  resolve: { alias: { "@": path.resolve(import.meta.dirname, "./src") } },
  define: versionDefine,
  test: {
    environment: "node",
    include: ["src/**/*.{test,spec}.{ts,tsx}"],
    pool: "threads",
    // isolate: true (défaut vitest) : avec isolate:false, le cache de modules
    // partagé entre fichiers d'un même worker a laissé fuir des mocks
    // (conversations.test.ts a une fois reçu le VRAI plugin-sql → "window is
    // not defined"). Coût en temps, fiabilité du gate en échange.
    isolate: true,
    testTimeout: 30000,
    hookTimeout: 30000,
    globals: true,
    setupFiles: ["./vitest.setup.ts"],
  },
})
