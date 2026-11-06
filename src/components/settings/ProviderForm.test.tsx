// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react"
import { ProviderForm } from "./ProviderForm"

const mockCreate = vi.hoisted(() => vi.fn())
const mockUpdate = vi.hoisted(() => vi.fn())
const mockLoggerError = vi.hoisted(() => vi.fn())

vi.mock("@/lib/db/providers", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/db/providers")>()
  return {
    ...actual,
    providers: { ...actual.providers, create: mockCreate, update: mockUpdate },
  }
})
vi.mock("@/lib/secrets/service", () => ({ secrets: { set: vi.fn(), get: vi.fn(), remove: vi.fn() } }))
vi.mock("@/lib/logger", () => ({
  logger: { debug: vi.fn(), error: mockLoggerError },
}))

import { t } from "@/i18n/fr"

function type(selector: string, value: string) {
  fireEvent.change(screen.getByLabelText(selector), { target: { value } })
}

beforeEach(() => {
  vi.clearAllMocks()
  mockCreate.mockResolvedValue({
    id: "p-new", name: "LM Studio", api_family: "openai", base_url: "http://localhost:1234/v1", created_at: "x",
  })
})

afterEach(cleanup)

function submitForm() {
  fireEvent.click(screen.getByText(t.settings.save))
}

describe("ProviderForm — validation boucle locale", () => {
  it("accepte une URL locale http://localhost:1234/v1", async () => {
    render(<ProviderForm onSaved={() => {}} onCancel={() => {}} />)
    type(t.settings.name, "LM Studio")
    type(t.settings.baseUrl, "http://localhost:1234/v1")
    submitForm()
    await waitFor(() => {
      expect(mockCreate).toHaveBeenCalledWith("LM Studio", "openai", "http://localhost:1234/v1", undefined)
    })
  })

  it("accepte une URL locale avec suffixe /v1/models après nettoyage", async () => {
    render(<ProviderForm onSaved={() => {}} onCancel={() => {}} />)
    type(t.settings.name, "LM Studio")
    type(t.settings.baseUrl, "http://localhost:1234/v1/models")
    submitForm()
    await waitFor(() => {
      expect(mockCreate).toHaveBeenCalledWith("LM Studio", "openai", "http://localhost:1234/v1", undefined)
    })
  })

  it("refuse http://example.com:1234/v1 avec le message invalidUrl, sans create", async () => {
    render(<ProviderForm onSaved={() => {}} onCancel={() => {}} />)
    type(t.settings.name, "Externe")
    type(t.settings.baseUrl, "http://example.com:1234/v1")
    submitForm()
    await screen.findByText(t.settings.invalidUrl)
    expect(mockCreate).not.toHaveBeenCalled()
  })

  it("refuse une URL sans scheme http(s)", async () => {
    render(<ProviderForm onSaved={() => {}} onCancel={() => {}} />)
    type(t.settings.name, "Neant")
    type(t.settings.baseUrl, "ftp://x")
    submitForm()
    await screen.findByText(t.settings.invalidUrl)
    expect(mockCreate).not.toHaveBeenCalled()
  })
})

describe("ProviderForm — erreur d'enregistrement", () => {
  it("n'expose pas la clé ni l'erreur brute et journalise un message reconstruit", async () => {
    const secret = "CUSTOM.key+42/="
    mockCreate.mockRejectedValueOnce(new Error(`Credential ${secret} rejected`))
    render(<ProviderForm onSaved={() => {}} onCancel={() => {}} />)
    type(t.settings.name, "Fournisseur distant")
    type(t.settings.baseUrl, "https://api.example.test/v1")
    fireEvent.change(document.querySelector('input[type="password"]') as HTMLInputElement, {
      target: { value: secret },
    })

    submitForm()

    await screen.findByText(t.settings.saveFailed)
    expect(document.body.textContent).not.toContain(secret)
    expect(document.body.textContent).not.toContain("Credential")
    expect(mockLoggerError).toHaveBeenCalledWith({
      context: "ProviderForm.save",
      message: "Credential [REDACTED] rejected",
    })
    const serializedLogs = JSON.stringify(mockLoggerError.mock.calls)
    expect(serializedLogs).toContain("[REDACTED]")
    expect(serializedLogs).not.toContain(secret)
  })
})
