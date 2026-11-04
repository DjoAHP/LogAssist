// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react"
import { LocalModelsPanel } from "./LocalModelsPanel"

const mockCreate = vi.hoisted(() => vi.fn())
vi.mock("@/lib/db/providers", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/db/providers")>()
  return {
    ...actual,
    providers: { ...actual.providers, create: mockCreate },
  }
})
vi.mock("@/lib/secrets/service", () => ({ secrets: { set: vi.fn(), get: vi.fn(), remove: vi.fn() } }))

import { t } from "@/i18n/fr"
import type { ProviderRow } from "@/lib/db/providers"

const localRow: ProviderRow = {
  id: "p-local", name: "LM Studio", api_family: "openai", base_url: "http://localhost:1234/v1", created_at: "x",
}

const onChanged = vi.fn()

beforeEach(() => {
  vi.clearAllMocks()
  mockCreate.mockResolvedValue(localRow)
})

afterEach(cleanup)

describe("LocalModelsPanel — presets LM Studio / Ollama", () => {
  it("affiche les deux cartes presets avec leur URL", () => {
    render(<LocalModelsPanel rows={[]} onChanged={onChanged} />)
    expect(screen.getByText("LM Studio")).toBeTruthy()
    expect(screen.getByText("Ollama")).toBeTruthy()
    expect(screen.getByText("http://localhost:1234/v1")).toBeTruthy()
    expect(screen.getByText("http://localhost:11434/v1")).toBeTruthy()
  })

  it("état non configuré : bouton Ajouter; clic → create avec preset + clé factice", async () => {
    render(<LocalModelsPanel rows={[]} onChanged={onChanged} />)
    fireEvent.click(screen.getAllByText(t.settings.localAdd)[0])
    await waitFor(() => {
      expect(mockCreate).toHaveBeenCalledWith("LM Studio", "openai", "http://localhost:1234/v1", "not-needed")
    })
    expect(onChanged).toHaveBeenCalled()
  })

  it("état déjà configuré : pas de bouton, libellé déjà configuré", () => {
    render(<LocalModelsPanel rows={[localRow]} onChanged={onChanged} />)
    const buttonCount = screen.queryAllByText(t.settings.localAdd).length
    expect(buttonCount).toBe(1) // Ollama seul reste ajoutable
    expect(screen.queryAllByText(t.settings.localConfigured).length).toBe(1)
  })

  it("double-clic rapide : un seul create (anti-doublon via busy global)", async () => {
    render(<LocalModelsPanel rows={[]} onChanged={onChanged} />)
    const buttons = screen.getAllByText(t.settings.localAdd)
    fireEvent.click(buttons[0])
    fireEvent.click(buttons[0])
    await waitFor(() => {
      expect(mockCreate).toHaveBeenCalledTimes(1)
    })
    expect(mockCreate).toHaveBeenCalledWith("LM Studio", "openai", "http://localhost:1234/v1", "not-needed")
  })
})
