// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import { McpImportDialog } from "./McpImportDialog"

afterEach(cleanup)

describe("McpImportDialog", () => {
  it("lit, valide et prévisualise sans appliquer immédiatement", async () => {
    const onValidate = vi.fn().mockResolvedValue(undefined)
    const onApply = vi.fn().mockResolvedValue(undefined)
    render(
      <McpImportDialog existing={[]} onValidate={onValidate} onApply={onApply} onClose={vi.fn()} />,
    )
    const file = new File(
      [
        JSON.stringify({
          version: 1,
          servers: [
            { id: "docs", name: "Docs", endpoint: "https://docs.example/mcp", transport: "streamable_http", auth: { type: "none" }, timeoutMs: 60000 },
          ],
        }),
      ],
      "mcp.json",
      { type: "application/json" },
    )
    fireEvent.change(screen.getByLabelText("Fichier de configuration MCP"), { target: { files: [file] } })
    expect(await screen.findByText("Création")).toBeTruthy()
    expect(onValidate).toHaveBeenCalledWith([expect.objectContaining({ id: "docs" })])
    expect(onApply).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole("button", { name: "Importer 1 serveur" }))
    await waitFor(() => expect(onApply).toHaveBeenCalledTimes(1))
  })

  it("affiche l'erreur sans mutation", async () => {
    const onApply = vi.fn()
    render(<McpImportDialog existing={[]} onValidate={vi.fn()} onApply={onApply} onClose={vi.fn()} />)
    const file = new File(["{bad"], "bad.json", { type: "application/json" })
    fireEvent.change(screen.getByLabelText("Fichier de configuration MCP"), { target: { files: [file] } })
    expect(await screen.findByRole("alert")).toBeTruthy()
    expect(onApply).not.toHaveBeenCalled()
  })
})