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
    isolate: false,
    testTimeout: 30000,
    hookTimeout: 30000,
  },
})
