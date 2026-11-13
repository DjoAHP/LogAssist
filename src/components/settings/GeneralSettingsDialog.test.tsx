// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest"
import { render, screen, fireEvent, cleanup } from "@testing-library/react"
import { GeneralSettingsDialog } from "./GeneralSettingsDialog"

// Le panneau est stub : son comportement est couvert par LockPanel.test.tsx.
vi.mock("./LockPanel", () => ({ LockPanel: () => <div data-testid="lock-panel-stub" /> }))

import { t } from "@/i18n/fr"

afterEach(cleanup)

describe("GeneralSettingsDialog — squelette miniature", () => {
  it("affiche le titre avec l'icône à droite, la catégorie avec son icône et le panneau verrou", () => {
    render(<GeneralSettingsDialog onClose={() => {}} />)
    const dialog = screen.getByRole("dialog", { name: t.generalSettings.title })
    expect(dialog).not.toBeNull()
    // Icône à droite du titre : dans le header, le <h2> précède le <svg>.
    const headerTitle = dialog.querySelector("h2")!
    expect(headerTitle.textContent).toBe(t.generalSettings.title)
    expect(headerTitle.nextElementSibling?.tagName.toLowerCase()).toBe("svg")
    // Catégorie avec icône lucide à gauche du libellé.
    const categoryButton = screen.getByRole("button", { name: t.generalSettings.categories.lock })
    const firstIcon = categoryButton.querySelector("svg")
    expect(firstIcon).not.toBeNull()
    expect(categoryButton.textContent).toContain(t.generalSettings.categories.lock)
    expect(screen.getByTestId("lock-panel-stub")).not.toBeNull()
  })

  it("ferme au clic sur la croix", () => {
    const onClose = vi.fn()
    render(<GeneralSettingsDialog onClose={onClose} />)
    fireEvent.click(screen.getByRole("button", { name: t.generalSettings.close }))
    expect(onClose).toHaveBeenCalledTimes(1)
  })
})
