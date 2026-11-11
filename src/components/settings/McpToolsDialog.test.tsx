// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { afterEach, expect, it, vi } from "vitest"
import { McpToolsDialog } from "./McpToolsDialog"
import { server, tool } from "@/test/mcpFixtures"

afterEach(cleanup)

it("ferme le dialog avec la touche Escape", () => {
  const onClose = vi.fn()
  render(
    <McpToolsDialog
      server={server()}
      tools={[tool({ native_name: "echo" })]}
      onToggle={vi.fn()}
      onApprovalMode={vi.fn()}
      onRun={vi.fn()}
      onConfirmRisk={vi.fn().mockResolvedValue(true)}
      onClose={onClose}
    />
  )
  fireEvent.keyDown(document, { key: "Escape" })
  expect(onClose).toHaveBeenCalledTimes(1)
})

it("affiche un fallback pour input_schema invalide sans planter", () => {
  render(
    <McpToolsDialog
      server={server()}
      tools={[tool({ native_name: "echo", input_schema: "bad json" })]}
      onToggle={vi.fn()}
      onApprovalMode={vi.fn()}
      onRun={vi.fn()}
      onConfirmRisk={vi.fn().mockResolvedValue(true)}
      onClose={vi.fn()}
    />
  )
  expect(screen.getByText("(schéma invalide)")).toBeTruthy()
})

it("active explicitement un outil et interdit auto si risqué", () => {
  const onToggle = vi.fn()
  render(
    <McpToolsDialog
      server={server()}
      tools={[tool({ annotations: "{\"destructiveHint\":true}" })]}
      onToggle={onToggle}
      onApprovalMode={vi.fn()}
      onRun={vi.fn()}
      onConfirmRisk={vi.fn().mockResolvedValue(true)}
      onClose={vi.fn()}
    />
  )
  fireEvent.click(screen.getByRole("checkbox", { name: /Activer delete_data/ }))
  expect(onToggle).toHaveBeenCalledWith("delete_data", true)
  expect((screen.getByRole("combobox", { name: /Politique delete_data/ }) as HTMLSelectElement).disabled).toBe(true)
})

it("valide les arguments JSON avant la console", async () => {
  const onRun = vi.fn().mockResolvedValue({ content: "ok", media: [], resourceLinks: [], sources: [], isError: false })
  render(
    <McpToolsDialog
      server={server()}
      tools={[tool({ native_name: "echo" })]}
      onToggle={vi.fn()}
      onApprovalMode={vi.fn()}
      onRun={onRun}
      onConfirmRisk={vi.fn().mockResolvedValue(true)}
      onClose={vi.fn()}
    />
  )
  fireEvent.change(screen.getByLabelText("Arguments JSON"), { target: { value: "{bad" } })
  fireEvent.click(screen.getByRole("button", { name: "Exécuter l'outil" }))
  expect(await screen.findByRole("alert")).toBeTruthy()
  expect(onRun).not.toHaveBeenCalled()
  fireEvent.change(screen.getByLabelText("Arguments JSON"), { target: { value: "{\"text\":\"bonjour\"}" } })
  fireEvent.click(screen.getByRole("button", { name: "Exécuter l'outil" }))
  await waitFor(() => expect(onRun).toHaveBeenCalledWith("echo", { text: "bonjour" }))
})