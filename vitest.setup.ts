import { afterEach, vi } from "vitest"
import { cleanup } from "@testing-library/react"
import "@testing-library/jest-dom/vitest"

afterEach(() => {
  cleanup()
})

// Make act available globally for tests that need it (only in jsdom)
if (typeof window !== "undefined") {
  import("react-dom/test-utils").then(({ act }) => {
    global.act = act
  })
}

// Mock Tauri path API pour les tests (jsdom sans Tauri)
vi.mock("@tauri-apps/api/path", () => ({
  appConfigDir: vi.fn(() => Promise.resolve("/mock/app/config")),
  appDataDir: vi.fn(() => Promise.resolve("/mock/app/data")),
  appLocalDataDir: vi.fn(() => Promise.resolve("/mock/app/local-data")),
  appCacheDir: vi.fn(() => Promise.resolve("/mock/app/cache")),
  appLogDir: vi.fn(() => Promise.resolve("/mock/app/log")),
}))
