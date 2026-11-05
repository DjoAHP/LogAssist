// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest"
import { render, screen, fireEvent, act, cleanup } from "@testing-library/react"
import { Sidebar } from "@/components/sidebar/Sidebar"
import type { ConversationRow } from "@/lib/db/conversations"

afterEach(cleanup)

const conversations: ConversationRow[] = [
  { id: "c1", project_id: null, title: "Première conv", archived: 0, pinned: 0, created_at: "2026-01-01 00:00:00", updated_at: "2026-01-01 00:00:00" },
  { id: "c2", project_id: null, title: "Conv épinglée", archived: 0, pinned: 1, created_at: "2026-01-01 00:00:00", updated_at: "2026-01-02 00:00:00" },
]

function setup(list = conversations) {
  const onDelete = vi.fn().mockResolvedValue(undefined)
  const onTogglePin = vi.fn().mockResolvedValue(undefined)
  render(
    <Sidebar
      conversations={list}
      activeId={null}
      onSelect={() => {}}
      onNew={() => {}}
      onDelete={onDelete}
      onRename={() => {}}
      onTogglePin={onTogglePin}
      width={280}
      onWidthChange={() => {}}
      collapsed={false}
      onToggleCollapse={() => {}}
    />,
  )
  return { onDelete, onTogglePin }
}

const deleteBtn = (title = "Première conv") => {
  const row = screen.getByText(title).closest('[role="button"]')!
  return row.querySelector('[aria-label="Supprimer"]')!
}
const confirmBtn = () => screen.getByRole("button", { name: "Confirmer la suppression ?" })

describe("Sidebar — épinglage", () => {
  it("conversation épinglée : aria-pressed, icône toujours visible, clic désépingle", () => {
    const { onTogglePin } = setup()
    const pinC2 = screen.getByRole("button", { name: "Désépingler" })
    expect(pinC2.getAttribute("aria-pressed")).toBe("true")
    fireEvent.click(pinC2)
    expect(onTogglePin).toHaveBeenCalledWith("c2", false)
  })

  it("conversation non épinglée : aria-pressed false, clic épingle", () => {
    const { onTogglePin } = setup()
    const pinC1 = screen.getByRole("button", { name: "Épingler" })
    expect(pinC1.getAttribute("aria-pressed")).toBe("false")
    fireEvent.click(pinC1)
    expect(onTogglePin).toHaveBeenCalledWith("c1", true)
  })
})

describe("Sidebar — titres de sections épinglé/chat", () => {
  it("affiche « Épingler » au-dessus des épinglées puis « Chat » au-dessus des autres (ordre DOM)", () => {
    setup()
    const body = document.body.textContent ?? ""
    expect(body.indexOf("Épingler")).toBeGreaterThan(-1)
    expect(body.indexOf("Chat")).toBeGreaterThan(-1)
    // Ordre : titre Épingler < conv épinglée < titre Chat < conv non épinglée
    expect(body.indexOf("Épingler")).toBeLessThan(body.indexOf("Conv épinglée"))
    expect(body.indexOf("Conv épinglée")).toBeLessThan(body.lastIndexOf("Chat"))
    expect(body.lastIndexOf("Chat")).toBeLessThan(body.indexOf("Première conv"))
  })

  it("masque le titre d'une section vide (uniquement non épinglées)", () => {
    setup([conversations[0]])
    expect(screen.queryByText("Épingler")).toBeNull()
    expect(screen.getByText("Chat")).toBeTruthy()
  })

  it("masque le titre Chat si tout est épinglé", () => {
    setup([conversations[1]])
    expect(screen.getByText("Épingler")).toBeTruthy()
    expect(screen.queryByText("Chat")).toBeNull()
  })

  it("liste vide : aucune section", () => {
    setup([])
    expect(screen.queryByText("Épingler")).toBeNull()
    expect(screen.queryByText("Chat")).toBeNull()
  })
})

describe("Sidebar — suppression avec confirmation", () => {
  it("premier clic : n'appelle PAS onDelete, affiche l'état de confirmation", () => {
    const { onDelete } = setup()
    fireEvent.click(deleteBtn())
    expect(onDelete).not.toHaveBeenCalled()
    expect(screen.getByRole("button", { name: "Confirmer la suppression ?" })).toBeTruthy()
  })

  it("deuxième clic rapide : appelle onDelete avec l'id", () => {
    const { onDelete } = setup()
    fireEvent.click(deleteBtn())
    fireEvent.click(confirmBtn())
    expect(onDelete).toHaveBeenCalledWith("c1")
  })

  it("Escape désarme la confirmation : retour à l'état normal, pas de suppression", () => {
    const { onDelete } = setup()
    fireEvent.click(deleteBtn())
    expect(confirmBtn()).toBeTruthy()
    fireEvent.keyDown(confirmBtn(), { key: "Escape" })
    // l'élément « Confirmer » a disparu, le bouton poubelle est de retour
    expect(screen.queryByRole("button", { name: "Confirmer la suppression ?" })).toBeNull()
    // re-armement puis toujours pas de suppression sans second clic
    fireEvent.click(deleteBtn())
    expect(onDelete).not.toHaveBeenCalled()
  })

  it("timeout 3 s : retour automatique à l'état normal", () => {
    vi.useFakeTimers()
    try {
      const { onDelete } = setup()
      fireEvent.click(deleteBtn())
      act(() => {
        vi.advanceTimersByTime(3100)
      })
      expect(screen.queryByRole("button", { name: "Confirmer la suppression ?" })).toBeNull()
      expect(onDelete).not.toHaveBeenCalled()
    } finally {
      vi.useRealTimers()
    }
  })
})
