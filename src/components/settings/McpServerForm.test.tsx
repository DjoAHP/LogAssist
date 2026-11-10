// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { afterEach, expect, it, vi } from "vitest"
import { McpServerForm } from "./McpServerForm"
import type { McpServerConfig } from "@/lib/mcp/types"

afterEach(cleanup)

function server(overrides: Partial<McpServerConfig> = {}): McpServerConfig {
  const base: McpServerConfig = {
    id: "docs",
    name: "Docs",
    endpoint: "https://docs.example/mcp",
    transport: "streamable_http",
    auth: { type: "bearer" },
    timeoutMs: 60_000,
    enabled: false,
    builtin: false,
  }
  return { ...base, ...overrides }
}

it("ne préremplit jamais le secret", () => {
  render(
    <McpServerForm
      initial={server({ auth: { type: "bearer" } })}
      authStatus="configured"
      onSave={vi.fn()}
      onConfigureSecret={vi.fn()}
      onDeleteSecret={vi.fn()}
      onCancel={vi.fn()}
    />
  )
  expect((screen.getByLabelText("Nouveau secret") as HTMLInputElement).value).toBe("")
  expect(screen.getByText("Identifiant stocké")).toBeTruthy()
})

it("verrouille endpoint et authentification TinyFish", () => {
  render(
    <McpServerForm
      initial={server({ id: "tinyfish", builtin: true })}
      authStatus="configured"
      onSave={vi.fn()}
      onConfigureSecret={vi.fn()}
      onDeleteSecret={vi.fn()}
      onCancel={vi.fn()}
    />
  )
  expect((screen.getByLabelText("Endpoint MCP") as HTMLInputElement).disabled).toBe(true)
  expect((screen.getByLabelText("Authentification") as HTMLSelectElement).disabled).toBe(true)
})

it("enregistre les métadonnées puis teste le secret séparément", async () => {
  const onSave = vi.fn().mockResolvedValue(undefined)
  const onConfigureSecret = vi.fn().mockResolvedValue(undefined)
  render(
    <McpServerForm
      initial={server()}
      authStatus="missing"
      onSave={onSave}
      onConfigureSecret={onConfigureSecret}
      onDeleteSecret={vi.fn()}
      onCancel={vi.fn()}
    />
  )
  fireEvent.change(screen.getByLabelText("Nouveau secret"), { target: { value: "candidate" } })
  fireEvent.click(screen.getByRole("button", { name: "Tester et enregistrer" }))
  await waitFor(() =>
    expect(onConfigureSecret).toHaveBeenCalledWith(expect.objectContaining({ id: "docs" }), "candidate")
  )
  expect(onSave).not.toHaveBeenCalled()
})

it("trimme le nom et l'endpoint à l'enregistrement", async () => {
  const onSave = vi.fn().mockResolvedValue(undefined)
  render(
    <McpServerForm
      initial={server({ name: "", endpoint: "" })}
      authStatus="missing"
      onSave={onSave}
      onConfigureSecret={vi.fn()}
      onDeleteSecret={vi.fn()}
      onCancel={vi.fn()}
    />
  )
  fireEvent.change(screen.getByLabelText("Nom du serveur"), { target: { value: "  Docs  " } })
  fireEvent.change(screen.getByLabelText("Endpoint MCP"), { target: { value: "https://docs.example/mcp " } })
  fireEvent.click(screen.getByRole("button", { name: "Enregistrer les paramètres" }))
  await waitFor(() =>
    expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({ name: "Docs", endpoint: "https://docs.example/mcp" })
    )
  )
})

it("passe l'id du serveur à onDeleteSecret", async () => {
  const onDeleteSecret = vi.fn().mockResolvedValue(undefined)
  render(
    <McpServerForm
      initial={server({ id: "my-server" })}
      authStatus="configured"
      onSave={vi.fn()}
      onConfigureSecret={vi.fn()}
      onDeleteSecret={onDeleteSecret}
      onCancel={vi.fn()}
    />
  )
  fireEvent.click(screen.getByRole("button", { name: "Supprimer l'identifiant" }))
  await waitFor(() =>
    expect(onDeleteSecret).toHaveBeenCalledWith("my-server")
  )
})
