// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest"
import { render, screen, fireEvent, act, cleanup } from "@testing-library/react"
import { Sidebar } from "@/components/sidebar/Sidebar"
import type { ConversationRow } from "@/lib/db/conversations"

afterEach(cleanup)

const conversations: ConversationRow[] = [
  { id: "c1", project_id: null, title: "Première conv", archived: 0, created_at: "2026-01-01 00:00:00", updated_at: "2026-01-01 00:00:00" },
]

function setup() {
  const onDelete = vi.fn().mockResolvedValue(undefined)
  render(
    <Sidebar
      conversations={conversations}
      activeId={null}
      onSelect={() => {}}
      onNew={() => {}}
      onDelete={onDelete}
      onRename={() => {}}
      width={280}
      onWidthChange={() => {}}
      collapsed={false}
      onToggleCollapse={() => {}}
    />,
  )
  return { onDelete }
}

const deleteBtn = () => screen.getByRole("button", { name: "Supprimer" })
const confirmBtn = () => screen.getByRole("button", { name: "Confirmer la suppression ?" })

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
