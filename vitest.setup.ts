import { afterEach } from "vitest"
import { cleanup } from "@testing-library/react"

afterEach(() => {
  cleanup()
})

// Make act available globally for tests that need it (only in jsdom)
if (typeof window !== "undefined") {
  import("react-dom/test-utils").then(({ act }) => {
    global.act = act
  })
}