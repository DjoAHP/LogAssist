// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest"
import { render, screen, fireEvent, cleanup } from "@testing-library/react"
import { GeneralSettingsDialog } from "./GeneralSettingsDialog"

// Le panneau est stub : son comportement est couvert par LockPanel.test.tsx.
vi.mock("./LockPanel", () => ({ LockPanel: () => <div data-testid="lock-panel-stub" /> }))

import { t } from "@/i18n/fr"

afterEach(cleanup)

describe("GeneralSettingsDialog — squelette miniature", () => {
  it("affiche le titre, la catégorie Mot de passe et le panneau verrou", () => {
    render(<GeneralSettingsDialog onClose={() => {}} />)
    expect(screen.getByRole("dialog", { name: t.generalSettings.title })).not.toBeNull()
    expect(screen.getByRole("button", { name: t.generalSettings.categories.lock })).not.toBeNull()
    expect(screen.getByTestId("lock-panel-stub")).not.toBeNull()
  })

  it("ferme au clic sur la croix", () => {
    const onClose = vi.fn()
    render(<GeneralSettingsDialog onClose={onClose} />)
    fireEvent.click(screen.getByRole("button", { name: t.generalSettings.close }))
    expect(onClose).toHaveBeenCalledTimes(1)
  })
})
