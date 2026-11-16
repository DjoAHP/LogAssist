// @vitest-environment jsdom
import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it, vi } from "vitest"
import { UpdateBanner } from "./UpdateBanner"

const available = { phase: "available", version: "3.5.0" } as const

describe("UpdateBanner", () => {
  it("n'affiche rien quand il n'y a rien à signaler", () => {
    const states = [
      { phase: "idle" },
      { phase: "upToDate" },
    ] as const
    for (const state of states) {
      const { unmount } = render(<UpdateBanner state={state} onInstall={vi.fn()} />)
      expect(screen.queryByTestId("update-banner")).not.toBeInTheDocument()
      unmount()
    }
  })

  it("annonce la version disponible avec un bouton d'installation", async () => {
    const onInstall = vi.fn()
    render(<UpdateBanner state={available} onInstall={onInstall} />)

    expect(screen.getByTestId("update-banner")).toHaveTextContent("LogAssist v3.5.0 est disponible")
    await userEvent.click(screen.getByRole("button", { name: "Installer" }))
    expect(onInstall).toHaveBeenCalledTimes(1)
  })

  it("signale le téléchargement en cours sans bouton d'installation", () => {
    render(
      <UpdateBanner
        state={{ phase: "downloading", version: "3.5.0", received: 10, total: 20 }}
        onInstall={vi.fn()}
      />,
    )
    expect(screen.getByTestId("update-banner")).toHaveTextContent("Téléchargement de la mise à jour… 50 %")
    expect(screen.queryByRole("button", { name: "Installer" })).not.toBeInTheDocument()
  })

  it.each([
    [{ phase: "error", operation: "check" } as const, "Vérification impossible. Réessayez plus tard."],
    [{ phase: "error", operation: "install" } as const, "L'installation a échoué. Réessayez plus tard."],
  ])("affiche l'erreur correspondant à l'opération", (state, message) => {
    render(<UpdateBanner state={state} onInstall={vi.fn()} />)

    expect(screen.getByRole("status")).toHaveTextContent(message)
  })

  it("peut être masquée", async () => {
    render(<UpdateBanner state={available} onInstall={vi.fn()} />)
    await userEvent.click(screen.getByRole("button", { name: "Masquer" }))
    expect(screen.queryByTestId("update-banner")).not.toBeInTheDocument()
  })
})
