// @vitest-environment jsdom
import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it, vi } from "vitest"
import { UpdaterPanel } from "./UpdaterPanel"

const noop = () => undefined

describe("UpdaterPanel", () => {
  it("affiche la version installée et un bouton de vérification", async () => {
    const onCheck = vi.fn()
    render(<UpdaterPanel state={{ phase: "idle" }} onCheck={onCheck} onInstall={noop} />)

    expect(screen.getByText(/^Version installée : /)).toBeInTheDocument()
    await userEvent.click(screen.getByRole("button", { name: "Vérifier les mises à jour" }))
    expect(onCheck).toHaveBeenCalledTimes(1)
  })

  it("affiche 'à jour' après un check sans mise à jour", () => {
    render(<UpdaterPanel state={{ phase: "upToDate" }} onCheck={noop} onInstall={noop} />)
    expect(screen.getByText("LogAssist est à jour.")).toBeInTheDocument()
  })

  it("affiche l'erreur de vérification", () => {
    render(<UpdaterPanel state={{ phase: "error" }} onCheck={noop} onInstall={noop} />)
    expect(screen.getByText("Vérification impossible. Réessayez plus tard.")).toBeInTheDocument()
  })

  it("annonce la mise à jour disponible et permet d'installer", async () => {
    const onInstall = vi.fn()
    render(
      <UpdaterPanel
        state={{ phase: "available", version: "3.5.0" }}
        onCheck={noop}
        onInstall={onInstall}
      />,
    )
    expect(screen.getByText("LogAssist v3.5.0 est disponible")).toBeInTheDocument()
    await userEvent.click(screen.getByRole("button", { name: "Installer" }))
    expect(onInstall).toHaveBeenCalledTimes(1)
  })

  it("désactive la vérification pendant le téléchargement", () => {
    render(
      <UpdaterPanel
        state={{ phase: "downloading", version: "3.5.0", received: 0, total: null }}
        onCheck={noop}
        onInstall={noop}
      />,
    )
    expect(screen.getByRole("button", { name: "Vérifier les mises à jour" })).toBeDisabled()
    expect(screen.getByText("Téléchargement de la mise à jour…")).toBeInTheDocument()
  })
})
