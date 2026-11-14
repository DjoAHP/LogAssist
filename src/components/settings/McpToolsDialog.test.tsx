// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { afterEach, expect, it, vi } from "vitest"
import { McpToolsDialog } from "./McpToolsDialog"
import { server, tool } from "@/test/mcpFixtures"

afterEach(cleanup)

function renderDialog(props: Partial<Parameters<typeof McpToolsDialog>[0]> = {}) {
  const onToggleAll = props.onToggleAll ?? vi.fn()
  render(
    <McpToolsDialog
      server={props.server ?? server()}
      tools={props.tools ?? [tool()]}
      onToggle={props.onToggle ?? vi.fn()}
      onToggleAll={onToggleAll}
      onApprovalMode={props.onApprovalMode ?? vi.fn()}
      onRun={props.onRun ?? vi.fn()}
      onConfirmRisk={props.onConfirmRisk ?? vi.fn().mockResolvedValue(true)}
      onClose={props.onClose ?? vi.fn()}
    />
  )
  return { onToggleAll }
}

const globalCheckbox = () =>
  screen.getByRole("checkbox", { name: /Tous les outils/ }) as HTMLInputElement

it("affiche l'état global indéterminé et bascule tous les outils affichés", () => {
  const { onToggleAll } = renderDialog({
    tools: [
      tool({ native_name: "echo_one", enabled: 1 }),
      tool({ native_name: "echo_two", enabled: 0 }),
      tool({ native_name: "other", enabled: 1 }),
    ],
  })

  const global = globalCheckbox()
  expect(global.checked).toBe(false)
  expect(global.indeterminate).toBe(true)
  expect(global.disabled).toBe(false)

  fireEvent.click(global)
  expect(onToggleAll).toHaveBeenCalledWith(true, ["echo_one", "echo_two", "other"])
})

it("bascule vers la désactivation quand tout est déjà activé", () => {
  const { onToggleAll } = renderDialog({
    tools: [
      tool({ native_name: "echo_one", enabled: 1 }),
      tool({ native_name: "echo_two", enabled: 1 }),
    ],
  })

  const global = globalCheckbox()
  expect(global.checked).toBe(true)
  expect(global.indeterminate).toBe(false)

  fireEvent.click(global)
  expect(onToggleAll).toHaveBeenCalledWith(false, ["echo_one", "echo_two"])
})

it("limite la bascule globale aux résultats de recherche", () => {
  const { onToggleAll } = renderDialog({
    tools: [
      tool({ native_name: "echo_one", enabled: 1 }),
      tool({ native_name: "echo_two", enabled: 0 }),
      tool({ native_name: "other", enabled: 0 }),
    ],
  })

  fireEvent.change(screen.getByRole("searchbox"), { target: { value: "echo" } })

  const global = globalCheckbox()
  expect(global.getAttribute("aria-label")).toContain("(1/2)")
  expect(global.indeterminate).toBe(true)

  // Sans recherche, la bascule couvre tout le serveur ; avec recherche,
  // seulement les outils affichés (décision utilisateur).
  fireEvent.click(global)
  expect(onToggleAll).toHaveBeenCalledWith(true, ["echo_one", "echo_two"])
})

it("désactive la case globale sans résultats de recherche", () => {
  renderDialog({ tools: [tool({ native_name: "echo" })] })
  fireEvent.change(screen.getByRole("searchbox"), { target: { value: "inexistant" } })

  const global = globalCheckbox()
  expect(global.getAttribute("aria-label")).toContain("(0/0)")
  expect(global.disabled).toBe(true)
})

it("ferme le dialog avec la touche Escape", () => {
  const onClose = vi.fn()
  renderDialog({ onClose })
  fireEvent.keyDown(document, { key: "Escape" })
  expect(onClose).toHaveBeenCalledTimes(1)
})

it("affiche un fallback pour input_schema invalide sans planter", () => {
  renderDialog({ tools: [tool({ native_name: "echo", input_schema: "bad json" })] })
  expect(screen.getByText("(schéma invalide)")).toBeTruthy()
})

it("active explicitement un outil et interdit auto si risqué", () => {
  const onToggle = vi.fn()
  renderDialog({
    tools: [tool({ annotations: "{\"destructiveHint\":true}" })],
    onToggle,
  })
  fireEvent.click(screen.getByRole("checkbox", { name: /Activer delete_data/ }))
  expect(onToggle).toHaveBeenCalledWith("delete_data", true)
  expect((screen.getByRole("combobox", { name: /Politique delete_data/ }) as HTMLSelectElement).disabled).toBe(true)
})

it("valide les arguments JSON avant la console", async () => {
  const onRun = vi.fn().mockResolvedValue({ content: "ok", media: [], resourceLinks: [], sources: [], isError: false })
  renderDialog({
    tools: [tool({ native_name: "echo" })],
    onRun,
  })
  fireEvent.change(screen.getByLabelText("Arguments JSON"), { target: { value: "{bad" } })
  fireEvent.click(screen.getByRole("button", { name: "Exécuter l'outil" }))
  expect(await screen.findByRole("alert")).toBeTruthy()
  expect(onRun).not.toHaveBeenCalled()
  fireEvent.change(screen.getByLabelText("Arguments JSON"), { target: { value: "{\"text\":\"bonjour\"}" } })
  fireEvent.click(screen.getByRole("button", { name: "Exécuter l'outil" }))
  await waitFor(() => expect(onRun).toHaveBeenCalledWith("echo", { text: "bonjour" }))
})