// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { t } from "@/i18n/fr"

const mockConnectorGithub = vi.hoisted(() => ({
  listRepos: vi.fn(),
  listBranches: vi.fn(),
}))

vi.mock("@/lib/connectors/client", () => ({
  connectorGithub: mockConnectorGithub,
}))

vi.mock("./TauriLink", () => ({
  TauriLink: ({ children, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement>) => (
    <a {...props}>{children}</a>
  ),
}))

import { GithubRepoPickerDialog } from "./GithubRepoPickerDialog"

const repos = [
  {
    fullName: "acme/public-app",
    isPrivate: false,
    defaultBranch: "main",
    updatedAt: "2026-11-15T10:00:00Z",
  },
  {
    fullName: "acme/private-api",
    isPrivate: true,
    defaultBranch: "stable",
    updatedAt: "2026-11-14T10:00:00Z",
  },
]

beforeEach(() => {
  vi.clearAllMocks()
  mockConnectorGithub.listRepos.mockResolvedValue({ repos, page: 1, hasMore: false })
  mockConnectorGithub.listBranches.mockResolvedValue(["main"])
})

afterEach(cleanup)

describe("GithubRepoPickerDialog", () => {
  it("charge les dépôts, indique les privés et filtre localement", async () => {
    render(<GithubRepoPickerDialog isOpen onClose={vi.fn()} onAttach={vi.fn()} />)

    await waitFor(() => expect(screen.getByText("acme/public-app")).toBeTruthy())
    expect(mockConnectorGithub.listRepos).toHaveBeenCalledWith(1)
    expect(screen.getByLabelText(t.connectors.repoPicker.private)).toBeTruthy()

    fireEvent.change(screen.getByPlaceholderText(t.connectors.repoPicker.search), {
      target: { value: "private" },
    })

    expect(screen.queryByText("acme/public-app")).toBeNull()
    expect(screen.getByText("acme/private-api")).toBeTruthy()
  })

  it("charge et ajoute la page suivante sans perdre la première", async () => {
    mockConnectorGithub.listRepos
      .mockResolvedValueOnce({ repos: [repos[0]], page: 1, hasMore: true })
      .mockResolvedValueOnce({ repos: [repos[1]], page: 2, hasMore: false })
    render(<GithubRepoPickerDialog isOpen onClose={vi.fn()} onAttach={vi.fn()} />)

    await waitFor(() => expect(screen.getByText("acme/public-app")).toBeTruthy())
    fireEvent.click(screen.getByRole("button", { name: t.connectors.repoPicker.loadMore }))

    await waitFor(() => expect(screen.getByText("acme/private-api")).toBeTruthy())
    expect(screen.getByText("acme/public-app")).toBeTruthy()
    expect(mockConnectorGithub.listRepos).toHaveBeenNthCalledWith(2, 2)
  })

  it("charge les branches et transmet owner, name et ref à l’attachement", async () => {
    const onAttach = vi.fn()
    const onClose = vi.fn()
    mockConnectorGithub.listRepos.mockResolvedValueOnce({ repos: [repos[0]], page: 1, hasMore: false })
    mockConnectorGithub.listBranches.mockResolvedValueOnce(["main", "develop"])
    render(<GithubRepoPickerDialog isOpen onClose={onClose} onAttach={onAttach} />)

    await waitFor(() => expect(screen.getByText("acme/public-app")).toBeTruthy())
    fireEvent.click(screen.getByText("acme/public-app"))
    await waitFor(() => expect(mockConnectorGithub.listBranches).toHaveBeenCalledWith("acme", "public-app"))

    const branch = screen.getByLabelText(t.connectors.repoPicker.branch)
    fireEvent.change(branch, { target: { value: "develop" } })
    fireEvent.click(screen.getByRole("button", { name: t.connectors.repoPicker.attach }))

    expect(onAttach).toHaveBeenCalledWith({ owner: "acme", name: "public-app", ref: "develop" })
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it("ferme avec Échap puis rend le focus à l’élément précédent", async () => {
    const onClose = vi.fn()
    const trigger = document.createElement("button")
    document.body.appendChild(trigger)
    trigger.focus()
    const { rerender } = render(<GithubRepoPickerDialog isOpen onClose={onClose} onAttach={vi.fn()} />)

    await waitFor(() => expect(screen.getByPlaceholderText(t.connectors.repoPicker.search)).toBe(document.activeElement))
    fireEvent.keyDown(document, { key: "Escape" })
    expect(onClose).toHaveBeenCalledTimes(1)

    rerender(<GithubRepoPickerDialog isOpen={false} onClose={onClose} onAttach={vi.fn()} />)
    expect(document.activeElement).toBe(trigger)
    trigger.remove()
  })
})
