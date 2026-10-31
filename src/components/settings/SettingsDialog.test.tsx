// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react"
import { SettingsDialog } from "./SettingsDialog"

const mockExecute = vi.hoisted(() => vi.fn())
const mockSelect = vi.hoisted(() => vi.fn())
const mockSecretsGet = vi.hoisted(() => vi.fn())
const mockTestConnection = vi.hoisted(() => vi.fn())
const mockListRemoteModels = vi.hoisted(() => vi.fn())

vi.mock("@/lib/db/database", () => ({
  execute: mockExecute,
  select: mockSelect,
}))
vi.mock("@/lib/secrets/service", () => ({ secrets: { set: vi.fn(), get: mockSecretsGet, remove: vi.fn() } }))
vi.mock("@/lib/ai/factory", () => ({
  createProvider: () => ({ testConnection: mockTestConnection, listRemoteModels: mockListRemoteModels }),
  buildPreview: (p: string, m: string) => `${p} › ${m}`,
}))
vi.mock("./ProviderForm", () => ({ ProviderForm: () => <div data-testid="form-stub" /> }))

import { type ProviderRow, type ModelRow } from "@/lib/db/providers"

const providerRow: ProviderRow = {
  id: "p1", name: "OpenRouter", api_family: "openai", base_url: "https://openrouter.ai/api/v1", created_at: "2026-01-01",
}
const existingModel: ModelRow = {
  id: "rm1", provider_id: "p1", model_id: "existing/model", supports_images: 0, is_default: 1,
}

beforeEach(() => {
  vi.clearAllMocks()
  mockSelect.mockImplementation((sql) => {
    const s = String(sql)
    return s.includes("FROM models") ? Promise.resolve([existingModel]) : Promise.resolve([providerRow])
  })
  mockExecute.mockResolvedValue(undefined)
  mockSecretsGet.mockResolvedValue("sk-x")
})

afterEach(cleanup)

function renderDialog() {
  return render(<SettingsDialog onClose={() => {}} onChanged={() => {}} />)
}

async function fetchButton(): Promise<HTMLElement> {
  const el = await screen.findByText("OpenRouter")
  const row = el.closest("li")!
  const btn = row.querySelector('[data-action="fetch-models"]')
  expect(btn).not.toBeNull()
  return btn as HTMLElement
}

describe("SettingsDialog — récupération des modèles", () => {
  it("sans clé API : statut fail noKey, aucun appel réseau", async () => {
    mockSecretsGet.mockResolvedValue(null)
    renderDialog()
    fireEvent.click(await fetchButton())
    await waitFor(() => {
      const row = screen.getByText("OpenRouter").closest("li")!
      expect(row.querySelector('[data-fetch-status]')?.textContent).toContain("Aucune clé")
    })
    expect(mockListRemoteModels).not.toHaveBeenCalled()
  })

  it("avec clé : filtre doublons (existants + retours identiques), n'ajoute que du nouveau", async () => {
    mockListRemoteModels.mockResolvedValue(["m1", "m1", "m2", "existing/model"])
    renderDialog()
    fireEvent.click(await fetchButton())
    await waitFor(() => expect(mockExecute).toHaveBeenCalled())
    const added = mockExecute.mock.calls
      .filter(([sql]) => String(sql).includes("INSERT INTO models"))
      .map(([, bind]) => (bind as unknown[])[2])
    // existing/model déjà en base (exclu), m1 dupliqué dans le retour (ajouté 1 fois)
    expect(added).toEqual(["m1", "m2"])
  })

  it("erreur API : statut fail avec message i18n", async () => {
    mockListRemoteModels.mockRejectedValue({ kind: "auth", message: "bad key" })
    renderDialog()
    fireEvent.click(await fetchButton())
    await waitFor(() => expect(mockListRemoteModels).toHaveBeenCalled())
    await waitFor(() => {
      const row = screen.getByText("OpenRouter").closest("li")!
      expect(row.querySelector('[data-fetch-status]')?.textContent).toContain("Clé API invalide")
    })
  })

  it("succès : statut ok affichant le nombre ajouté", async () => {
    mockListRemoteModels.mockResolvedValue(["m2"])
    renderDialog()
    fireEvent.click(await fetchButton())
    await waitFor(() => {
      const row = screen.getByText("OpenRouter").closest("li")!
      expect(row.querySelector('[data-fetch-status]')?.textContent).toContain("1")
    })
  })
})
