// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, describe, expect, it, vi } from "vitest"
import { ConnectorsPanel } from "./ConnectorsPanel"
import { t } from "@/i18n/fr"

afterEach(cleanup)

vi.mock("@/icons", () => ({
  GithubConnecteurIcon: ({ className }: { className?: string }) => (
    <svg className={className} data-testid="github-icon" />
  ),
}))

describe("ConnectorsPanel", () => {
  it("affiche la tuile GitHub avec badge Non configuré", () => {
    render(
      <ConnectorsPanel
        statuses={{ github: { configured: false, login: null } }}
        onSelect={vi.fn()}
      />
    )
    const tile = screen.getByRole("button", { name: t.connectors.github })
    expect(tile).not.toBeNull()
    expect(tile).toHaveAttribute("data-connector-id", "github")
    const badge = tile.querySelector('[data-testid="connector-status"]')
    expect(badge).not.toBeNull()
    expect(badge?.textContent).toBe(t.connectors.status.notConfigured)
    expect(badge).toHaveClass("text-muted-foreground")
    const icon = screen.getByTestId("github-icon")
    expect(icon).toHaveClass("size-10")
    expect(icon).toHaveClass("text-[var(--brand-to)]")
  })

  it("affiche le badge Connecté avec @login quand configuré", () => {
    render(
      <ConnectorsPanel
        statuses={{ github: { configured: true, login: "octocat" } }}
        onSelect={vi.fn()}
      />
    )
    const tile = screen.getByRole("button", { name: t.connectors.github })
    const badge = tile.querySelector('[data-testid="connector-status"]')
    expect(badge?.textContent).toBe(t.connectors.status.connected.replace("{login}", "octocat"))
    expect(badge).toHaveClass("text-green-600")
  })

  it("n’affiche pas un @ vide pour une ancienne enveloppe sans login", () => {
    render(
      <ConnectorsPanel
        statuses={{ github: { configured: true, login: null } }}
        onSelect={vi.fn()}
      />,
    )

    const badge = screen.getByTestId("connector-status")
    expect(badge.textContent).toBe("Connecté")
  })

  it("appelle onSelect au clic", async () => {
    const onSelect = vi.fn()
    render(
      <ConnectorsPanel
        statuses={{ github: { configured: false, login: null } }}
        onSelect={onSelect}
      />
    )
    const tile = screen.getByRole("button", { name: t.connectors.github })
    await userEvent.click(tile)
    expect(onSelect).toHaveBeenCalledWith("github")
  })
})
