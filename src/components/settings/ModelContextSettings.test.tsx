// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest"
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { StrictMode, useState } from "react"
import { ModelContextSettings } from "./ModelContextSettings"

afterEach(cleanup)

describe("ModelContextSettings", () => {
  it("enregistre deux entiers valides", async () => {
    const onSave = vi.fn().mockResolvedValue(undefined)
    render(
      <ModelContextSettings
        modelLabel="qwen3.5-9b"
        contextWindowOverride={8192}
        maxOutputTokensOverride={1024}
        onSave={onSave}
        onClose={vi.fn()}
      />,
    )

    fireEvent.change(screen.getByLabelText("Fenêtre de contexte (tokens)"), {
      target: { value: "16384" },
    })
    fireEvent.change(screen.getByLabelText("Réserve maximale de sortie (tokens)"), {
      target: { value: "2048" },
    })
    fireEvent.click(screen.getByRole("button", { name: "Enregistrer le contexte" }))

    await waitFor(() => expect(onSave).toHaveBeenCalledWith({
      contextWindowOverride: 16384,
      maxOutputTokensOverride: 2048,
    }))
  })

  it("convertit deux champs vides en détection automatique", async () => {
    const onSave = vi.fn().mockResolvedValue(undefined)
    render(
      <ModelContextSettings
        modelLabel="qwen3.5-9b"
        contextWindowOverride={8192}
        maxOutputTokensOverride={1024}
        onSave={onSave}
        onClose={vi.fn()}
      />,
    )

    fireEvent.change(screen.getByLabelText("Fenêtre de contexte (tokens)"), {
      target: { value: "" },
    })
    fireEvent.change(screen.getByLabelText("Réserve maximale de sortie (tokens)"), {
      target: { value: "" },
    })
    fireEvent.click(screen.getByRole("button", { name: "Enregistrer le contexte" }))

    await waitFor(() => expect(onSave).toHaveBeenCalledWith({
      contextWindowOverride: null,
      maxOutputTokensOverride: null,
    }))
  })

  it("resynchronise les champs quand le modèle configuré change", () => {
    const { rerender } = render(
      <ModelContextSettings
        modelLabel="premier-modele"
        contextWindowOverride={8192}
        maxOutputTokensOverride={1024}
        onSave={vi.fn()}
        onClose={vi.fn()}
      />,
    )

    rerender(
      <ModelContextSettings
        modelLabel="second-modele"
        contextWindowOverride={null}
        maxOutputTokensOverride={null}
        onSave={vi.fn()}
        onClose={vi.fn()}
      />,
    )

    expect((screen.getByLabelText("Fenêtre de contexte (tokens)") as HTMLInputElement).value).toBe("")
    expect((screen.getByLabelText("Réserve maximale de sortie (tokens)") as HTMLInputElement).value).toBe("")
  })

  it("refuse une sortie supérieure ou égale à la fenêtre", async () => {
    const onSave = vi.fn()
    render(
      <ModelContextSettings
        modelLabel="qwen3.5-9b"
        contextWindowOverride={4096}
        maxOutputTokensOverride={1024}
        onSave={onSave}
        onClose={vi.fn()}
      />,
    )

    fireEvent.change(screen.getByLabelText("Réserve maximale de sortie (tokens)"), {
      target: { value: "4096" },
    })
    fireEvent.click(screen.getByRole("button", { name: "Enregistrer le contexte" }))

    expect(screen.getByRole("alert").textContent).toContain("inférieure à la fenêtre")
    expect(onSave).not.toHaveBeenCalled()
  })

  it("ferme avec Annuler sans enregistrer", () => {
    const onClose = vi.fn()
    const onSave = vi.fn()
    render(
      <ModelContextSettings
        modelLabel="qwen3.5-9b"
        contextWindowOverride={null}
        maxOutputTokensOverride={null}
        onSave={onSave}
        onClose={onClose}
      />,
    )

    fireEvent.click(screen.getByRole("button", { name: "Annuler" }))
    expect(onClose).toHaveBeenCalledTimes(1)
    expect(onSave).not.toHaveBeenCalled()
  })

  it("prend le focus, le contient puis le restaure à la fermeture", () => {
    const trigger = document.createElement("button")
    document.body.append(trigger)
    trigger.focus()
    const { unmount } = render(
      <ModelContextSettings
        modelLabel="qwen3.5-9b"
        contextWindowOverride={null}
        maxOutputTokensOverride={null}
        onSave={vi.fn()}
        onClose={vi.fn()}
      />,
    )
    const dialog = screen.getByRole("dialog")
    const firstInput = screen.getByLabelText("Fenêtre de contexte (tokens)")
    const closeButton = screen.getByRole("button", { name: "Fermer" })
    const saveButton = screen.getByRole("button", { name: "Enregistrer le contexte" })

    expect(document.activeElement).toBe(firstInput)
    saveButton.focus()
    fireEvent.keyDown(dialog, { key: "Tab" })
    expect(document.activeElement).toBe(closeButton)
    closeButton.focus()
    fireEvent.keyDown(dialog, { key: "Tab", shiftKey: true })
    expect(document.activeElement).toBe(saveButton)

    unmount()
    expect(document.activeElement).toBe(trigger)
    trigger.remove()
  })

  it("restaure le déclencheur devenu inert sous StrictMode", () => {
    function Harness() {
      const [open, setOpen] = useState(false)
      return (
        <>
          <div inert={open || undefined}>
            <button type="button" onClick={() => setOpen(true)}>Configurer</button>
          </div>
          {open && (
            <ModelContextSettings
              modelLabel="qwen3.5-9b"
              contextWindowOverride={null}
              maxOutputTokensOverride={null}
              onSave={vi.fn()}
              onClose={() => setOpen(false)}
            />
          )}
        </>
      )
    }
    render(<StrictMode><Harness /></StrictMode>)
    const trigger = screen.getByRole("button", { name: "Configurer" })
    const nativeFocus = trigger.focus.bind(trigger)
    trigger.focus = () => {
      if (!trigger.closest("[inert]")) nativeFocus()
    }
    trigger.focus()
    fireEvent.click(trigger)
    expect(document.activeElement).toBe(screen.getByLabelText("Fenêtre de contexte (tokens)"))

    fireEvent.click(screen.getByRole("button", { name: "Annuler" }))

    expect(document.activeElement).toBe(trigger)
  })

  it("empêche toute fermeture pendant une sauvegarde", async () => {
    let resolveSave: (() => void) | undefined
    const onSave = vi.fn(() => new Promise<void>((resolve) => {
      resolveSave = resolve
    }))
    const onClose = vi.fn()
    render(
      <ModelContextSettings
        modelLabel="qwen3.5-9b"
        contextWindowOverride={8192}
        maxOutputTokensOverride={1024}
        onSave={onSave}
        onClose={onClose}
      />,
    )

    const saveButton = screen.getByRole("button", { name: "Enregistrer le contexte" })
    saveButton.focus()
    fireEvent.click(saveButton)
    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1))
    const closeButton = screen.getByRole("button", { name: "Fermer" })
    expect((closeButton as HTMLButtonElement).disabled).toBe(true)
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Tab" })
    expect(document.activeElement).toBe(screen.getByLabelText("Fenêtre de contexte (tokens)"))
    fireEvent.click(closeButton)
    fireEvent.click(screen.getByTestId("model-context-settings"))
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" })
    expect(onClose).not.toHaveBeenCalled()

    resolveSave?.()
    await waitFor(() => expect((closeButton as HTMLButtonElement).disabled).toBe(false))
  })
})
