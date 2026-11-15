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
    // Borne haute volontaire : le défaut vitest (CPUs - 1) sature la machine
    // quand cargo compile en parallèle et les workers dépassaient leur délai
    // de démarrage ("Timeout waiting for worker to respond", 19 fichiers
    // perdus lors de la gate v3.4.0). Un pool borné reste plus rapide qu'un
    // run à relancer.
    poolOptions: {
      threads: {
        maxThreads: 8,
        minThreads: 1,
      },
    },
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
