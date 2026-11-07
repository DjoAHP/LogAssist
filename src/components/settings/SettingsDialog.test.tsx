// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { render, screen, fireEvent, waitFor, cleanup, within } from "@testing-library/react"
import { SettingsDialog } from "./SettingsDialog"

function hasClass(element: HTMLElement | SVGElement | null, className: string): boolean {
  return element?.classList.contains(className) ?? false
}

const mockExecute = vi.hoisted(() => vi.fn())
const mockSelect = vi.hoisted(() => vi.fn())
const mockSecretsGet = vi.hoisted(() => vi.fn())
const mockTestConnection = vi.hoisted(() => vi.fn())
const mockListRemoteModels = vi.hoisted(() => vi.fn())
const mockDialogConfirm = vi.hoisted(() => vi.fn())
const mockLoggerError = vi.hoisted(() => vi.fn())

vi.mock("@/lib/db/database", () => ({
  execute: mockExecute,
  select: mockSelect,
}))
vi.mock("@/lib/secrets/service", () => ({ secrets: { set: vi.fn(), get: mockSecretsGet, remove: vi.fn() } }))
vi.mock("@tauri-apps/plugin-dialog", () => ({ confirm: mockDialogConfirm, ask: vi.fn() }))
vi.mock("@/lib/ai/factory", () => ({
  createProvider: () => ({ testConnection: mockTestConnection, listRemoteModels: mockListRemoteModels }),
  buildPreview: (p: string, m: string) => `${p} › ${m}`,
}))
vi.mock("@/lib/logger", () => ({
  logger: { debug: vi.fn(), error: mockLoggerError },
}))
vi.mock("./ProviderForm", () => ({ ProviderForm: () => <div data-testid="form-stub" /> }))

import { type ProviderRow, type ModelRow } from "@/lib/db/providers"
import { t } from "@/i18n/fr"

const providerRow: ProviderRow = {
  id: "p1", name: "OpenRouter", api_family: "openai", base_url: "https://openrouter.ai/api/v1", created_at: "2026-01-01",
}
const secondProviderRow: ProviderRow = {
  id: "p2",
  name: "LM Studio",
  api_family: "openai",
  base_url: "http://localhost:1234/v1",
  created_at: "2026-01-02",
}
const existingModel: ModelRow = {
  id: "rm1", provider_id: "p1", model_id: "existing/model", supports_images: 0, is_default: 1,
}

// Faux runtime : état SQL minimal pour refléter INSERT/DELETE entre les relectures.
const dbState = {
  providers: [providerRow, secondProviderRow],
  models: [existingModel] as ModelRow[],
  reset() {
    this.providers = [providerRow, secondProviderRow]
    this.models = [existingModel]
  },
}

beforeEach(() => {
  vi.clearAllMocks()
  mockDialogConfirm.mockResolvedValue(false)
  dbState.reset()
  mockSelect.mockImplementation((sql, bind) => {
    const s = String(sql)
    const firstBind = (bind as unknown[] | undefined)?.[0]
    if (s.includes("FROM models WHERE provider_id = ?")) {
      return Promise.resolve(dbState.models.filter((model) => model.provider_id === firstBind))
    }
    if (s.includes("FROM models WHERE id = ?")) {
      return Promise.resolve(dbState.models.filter((model) => model.id === firstBind))
    }
    return Promise.resolve(dbState.providers)
  })
  mockExecute.mockImplementation((sql, bind) => {
    const s = String(sql)
    if (s.includes("INSERT INTO models")) {
      dbState.models = [...dbState.models, {
        id: (bind as unknown[])[0] as string, provider_id: (bind as unknown[])[1] as string,
        model_id: (bind as unknown[])[2] as string, supports_images: 0, is_default: 0,
      }]
    }
    if (s.includes("DELETE FROM providers")) {
      const providerId = (bind as unknown[])[0]
      dbState.providers = dbState.providers.filter((provider) => provider.id !== providerId)
      dbState.models = dbState.models.filter((model) => model.provider_id !== providerId)
    }
    return Promise.resolve(undefined)
  })
  mockSecretsGet.mockResolvedValue("sk-x")
})

afterEach(cleanup)

function renderDialog() {
  return render(<SettingsDialog onClose={() => {}} onChanged={() => {}} />)
}

async function fetchButton(): Promise<HTMLElement> {
  const el = await screen.findByText("OpenRouter")
  const row = el.closest('[data-testid="provider-card"]')!
  const btn = row.querySelector('[data-action="fetch-models"]')
  expect(btn).not.toBeNull()
  return btn as HTMLElement
}

async function testButton(): Promise<HTMLElement> {
  const providerName = await screen.findByText("OpenRouter")
  const card = providerName.closest('[data-testid="provider-card"]')
  expect(card).not.toBeNull()
  return within(card as HTMLElement).getByRole("button", { name: t.settings.test })
}

describe("SettingsDialog — recherche des fournisseurs", () => {
  it("filtre par nom sans tenir compte de la casse", async () => {
    renderDialog()
    const search = await screen.findByRole("searchbox", {
      name: t.settings.searchProviders,
    })

    fireEvent.change(search, { target: { value: "lm STUDIO" } })

    expect(screen.queryByText("OpenRouter")).toBeNull()
    expect(screen.getByText("LM Studio")).not.toBeNull()
  })

  it("filtre par URL partielle", async () => {
    renderDialog()
    const search = await screen.findByRole("searchbox", {
      name: t.settings.searchProviders,
    })

    fireEvent.change(search, { target: { value: "openrouter.ai" } })

    expect(screen.getByText("OpenRouter")).not.toBeNull()
    expect(screen.queryByText("LM Studio")).toBeNull()
  })

  it("affiche un état sans résultat tout en conservant la carte d’ajout", async () => {
    renderDialog()
    const search = await screen.findByRole("searchbox", {
      name: t.settings.searchProviders,
    })

    fireEvent.change(search, { target: { value: "fournisseur-inconnu" } })

    expect(screen.getByText(t.settings.noProviderResults)).not.toBeNull()
    expect(screen.getByRole("button", { name: t.settings.addProvider })).not.toBeNull()
  })
})

describe("SettingsDialog — cartes fournisseur", () => {
  it("présente les commandes sans afficher la liste des modèles dans la carte", async () => {
    renderDialog()

    const providerName = await screen.findByText("OpenRouter")
    const card = providerName.closest('[data-testid="provider-card"]') as HTMLElement

    expect(within(card).getByRole("button", { name: t.settings.test })).not.toBeNull()
    expect(within(card).getByRole("button", { name: t.settings.fetchModels })).not.toBeNull()
    expect(within(card).getByRole("button", { name: t.settings.edit })).not.toBeNull()
    expect(within(card).getByRole("button", {
      name: `${t.settings.browseModels} (1)`,
    })).not.toBeNull()
    expect(within(card).queryByText("existing/model")).toBeNull()
  })

  it("aligne la hauteur de la carte d'ajout sur le format compact", async () => {
    renderDialog()

    const addButton = screen.getByRole("button", { name: t.settings.addProvider })
    expect(hasClass(addButton, "min-h-64")).toBe(true)
    expect(hasClass(addButton, "min-h-72")).toBe(false)
    expect(hasClass(addButton, "min-h-80")).toBe(false)
  })
})

describe("SettingsDialog — récupération des modèles", () => {
  it("sans clé API : statut fail noKey, aucun appel réseau", async () => {
    mockSecretsGet.mockResolvedValue(null)
    renderDialog()
    fireEvent.click(await fetchButton())
    await waitFor(() => {
      const row = screen.getByText("OpenRouter").closest('[data-testid="provider-card"]')!
      expect(row.querySelector('[data-testid="fetch-models-status"]')?.textContent).toContain("Aucune clé")
    })
    expect(mockListRemoteModels).not.toHaveBeenCalled()
  })

  it("avec clé : filtre doublons (existants + retours identiques), n'ajoute que du nouveau", async () => {
    mockListRemoteModels.mockResolvedValue(["m1", "m1", "m2", "existing/model"])
    renderDialog()
    fireEvent.click(await fetchButton())
    await waitFor(() => expect(mockExecute).toHaveBeenCalled(), { timeout: 3000 })
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
      const row = screen.getByText("OpenRouter").closest('[data-testid="provider-card"]')!
      expect(row.querySelector('[data-testid="fetch-models-status"]')?.textContent).toContain("Clé API invalide")
    })
  })

  it("masque la clé exacte d'une erreur inconnue de récupération", async () => {
    const opaqueKey = "CUSTOM.key+42/="
    mockSecretsGet.mockResolvedValue(opaqueKey)
    mockListRemoteModels.mockRejectedValue(
      new Error(`Credential ${opaqueKey} rejected`),
    )
    renderDialog()

    fireEvent.click(await fetchButton())

    await waitFor(() => {
      const row = screen.getByText("OpenRouter").closest('[data-testid="provider-card"]')!
      expect(row.querySelector('[data-testid="fetch-models-status"]')?.textContent).toContain(t.settings.fetchFail)
    })
    const sinks = JSON.stringify({ ui: document.body.textContent, logs: mockLoggerError.mock.calls })
    expect(sinks).not.toContain(opaqueKey)
    expect(JSON.stringify(mockLoggerError.mock.calls)).toContain("[REDACTED]")
  })

  it("succès : statut ok affichant le nombre ajouté", async () => {
    mockListRemoteModels.mockResolvedValue(["m2"])
    renderDialog()
    fireEvent.click(await fetchButton())
    await waitFor(() => {
      const row = screen.getByText("OpenRouter").closest('[data-testid="provider-card"]')!
      expect(row.querySelector('[data-testid="fetch-models-status"]')?.textContent).toContain("1")
    }, { timeout: 3000 })
  })

  it("Parcourir les modèles : ouvre le modal listant les modèles de la base", async () => {
    renderDialog()
    const row = (await screen.findByText("OpenRouter")).closest('[data-testid="provider-card"]')!
    fireEvent.click(row.querySelector('[data-action="browse-models"]') as HTMLElement)
    await waitFor(() => expect(screen.getByTestId("model-picker-modal")).not.toBeNull())
    expect(screen.queryAllByText("existing/model").length).toBeGreaterThan(0)
  })

  it("Parcourir les modèles : clic sur un modèle → setDefaultModel + modal fermé", async () => {
    renderDialog()
    const row = (await screen.findByText("OpenRouter")).closest('[data-testid="provider-card"]')!
    fireEvent.click(row.querySelector('[data-action="browse-models"]') as HTMLElement)
    await waitFor(() => expect(screen.getByTestId("model-picker-modal")).not.toBeNull())
    fireEvent.click(screen.getByText("existing/model", { selector: "span" }))
    await waitFor(() => {
      const updates = mockExecute.mock.calls.filter(([sql]) =>
        String(sql).includes("UPDATE models SET is_default = 1"),
      )
      expect(updates.length).toBe(1)
      expect((updates[0][1] as unknown[]).join(",")).toBe("rm1")
    })
    expect(screen.queryByTestId("model-picker-modal")).toBeNull()
  })

  it("Parcourir les modèles : ajout textuel dans le modal → INSERT INTO models", async () => {
    renderDialog()
    const row = (await screen.findByText("OpenRouter")).closest('[data-testid="provider-card"]')!
    fireEvent.click(row.querySelector('[data-action="browse-models"]') as HTMLElement)
    const modal = await screen.findByTestId("model-picker-modal")
    const input = screen.getByLabelText("Ajouter un modèle") as HTMLInputElement
    fireEvent.change(input, { target: { value: "openai/nouveau-modele" } })
    fireEvent.click(modal.querySelector('button[aria-label="Ajouter le modèle"]') as HTMLElement)
    await waitFor(() => {
      const inserts = mockExecute.mock.calls.filter(([sql]) => String(sql).includes("INSERT INTO models"))
      expect(inserts.some(([, bind]) => (bind as unknown[])[2] === "openai/nouveau-modele")).toBe(true)
    })
    // le modèle nouvellement ajouté apparaît ensuite dans la liste du modal
    expect(screen.queryAllByText("openai/nouveau-modele").length).toBeGreaterThan(0)
  })
})

describe("SettingsDialog — test de connexion", () => {
  it("masque la clé exacte d'une exception inconnue dans l'UI et les logs", async () => {
    const opaqueKey = "CUSTOM.key+42/="
    mockSecretsGet.mockResolvedValue(opaqueKey)
    mockTestConnection.mockRejectedValue(
      new Error(`Credential ${opaqueKey} rejected`),
    )
    renderDialog()

    fireEvent.click(await testButton())

    await waitFor(() => expect(screen.getByText(t.settings.fail, { exact: false })).not.toBeNull())
    const sinks = JSON.stringify({ ui: document.body.textContent, logs: mockLoggerError.mock.calls })
    expect(sinks).not.toContain(opaqueKey)
    expect(JSON.stringify(mockLoggerError.mock.calls)).toContain("[REDACTED]")
  })
})

describe("SettingsDialog — suppression fournisseur", () => {
  afterEach(cleanup)

  async function trashButton(): Promise<HTMLElement> {
    await screen.findByText("OpenRouter")
    const row = screen.getByText("OpenRouter").closest('[data-testid="provider-card"]')!
    const btn = row.querySelector(`[aria-label="${t.settings.delete}"]`)
    expect(btn).not.toBeNull()
    return btn as HTMLElement
  }

  it("refus de confirmation : rien n'est supprimé (ni DELETE, ni secret)", async () => {
    mockDialogConfirm.mockResolvedValue(false)
    renderDialog()
    fireEvent.click(await trashButton())
    await waitFor(() => expect(mockDialogConfirm).toHaveBeenCalled())
    const deleteCalls = mockExecute.mock.calls.filter(([sql]) => String(sql).includes("DELETE FROM providers"))
    expect(deleteCalls).toEqual([])
  })

  it("confirmation acceptée : DELETE providers exécuté", async () => {
    mockDialogConfirm.mockResolvedValue(true)
    renderDialog()
    fireEvent.click(await trashButton())
    await waitFor(() => {
      const deleteCalls = mockExecute.mock.calls.filter(([sql]) => String(sql).includes("DELETE FROM providers"))
      expect(deleteCalls.length).toBe(1)
    })
  })
})
