// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react"
import { ProviderForm } from "./ProviderForm"

const mockCreate = vi.hoisted(() => vi.fn())
const mockUpdate = vi.hoisted(() => vi.fn())

vi.mock("@/lib/db/providers", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/db/providers")>()
  return {
    ...actual,
    providers: { ...actual.providers, create: mockCreate, update: mockUpdate },
  }
})
vi.mock("@/lib/secrets/service", () => ({ secrets: { set: vi.fn(), get: vi.fn(), remove: vi.fn() } }))

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
