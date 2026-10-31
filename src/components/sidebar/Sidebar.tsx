import { useEffect, useRef, useState } from "react"
import { ChevronLeft, ChevronRight, Plus, Search, Trash2, Edit2, GripVertical, Pin, PinOff } from "lucide-react"
import { t } from "@/i18n/fr"
import type { ConversationRow } from "@/lib/db/conversations"

interface Props {
  conversations: ConversationRow[]
  activeId: string | null
  onSelect: (id: string) => void
  onNew: () => void
  onDelete: (id: string) => void
  onRename: (id: string, newTitle: string) => void
  // Épinglage (migration V4) : un flip → refetch parent → tri SQL pinned DESC
  onTogglePin: (id: string, pinned: boolean) => void
  width: number
  onWidthChange: (width: number) => void
  collapsed: boolean
  onToggleCollapse: () => void
}

const MIN_WIDTH = 200
const MAX_WIDTH = 400
const COLLAPSED_WIDTH = 48

export function Sidebar({
  conversations,
  activeId,
  onSelect,
  onNew,
  onDelete,
  onRename,
  onTogglePin,
  width,
  onWidthChange,
  collapsed,
  onToggleCollapse,
}: Props) {
  const [query, setQuery] = useState("")
  const [renamingId, setRenamingId] = useState<string | null>(null)
  const [renameValue, setRenameValue] = useState("")
  const renameInputRef = useRef<HTMLInputElement>(null)
  const isResizing = useRef(false)
  const startX = useRef(0)
  const startWidth = useRef(0)
  // Suppression en 2 temps : premier clic = armer (bouton « Confirmer ? »),
  // deuxième clic = exécuter. Auto-désarmement 3 s, Escape désarme.
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null)
  const deleteTimerRef = useRef<number | undefined>(undefined)

  const disarmDelete = () => {
    setConfirmDeleteId(null)
    if (deleteTimerRef.current !== undefined) {
      clearTimeout(deleteTimerRef.current)
      deleteTimerRef.current = undefined
    }
  }

  // Nettoyage du timer au démontage
  useEffect(() => () => disarmDelete(), [])

  const handleDeleteClick = (e: React.MouseEvent, id: string) => {
    e.stopPropagation()
    if (confirmDeleteId === id) {
      disarmDelete()
      onDelete(id)
    } else {
      disarmDelete()
      setConfirmDeleteId(id)
      deleteTimerRef.current = window.setTimeout(disarmDelete, 3000)
    }
  }

  const filtered = conversations.filter((c) => c.title.toLowerCase().includes(query.toLowerCase()))

  // --- Global resize listeners ---
  useEffect(() => {
    const onMouseMove = (e: MouseEvent) => {
      if (!isResizing.current) return
      const delta = e.clientX - startX.current
      const newWidth = Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, startWidth.current + delta))
      onWidthChange(newWidth)
    }

    const onMouseUp = () => {
      if (isResizing.current) {
        isResizing.current = false
        document.body.style.cursor = ""
        document.body.style.userSelect = ""
      }
    }

    window.addEventListener("mousemove", onMouseMove)
    window.addEventListener("mouseup", onMouseUp)
    return () => {
      window.removeEventListener("mousemove", onMouseMove)
      window.removeEventListener("mouseup", onMouseUp)
    }
  }, [onWidthChange])

  // --- Resize handler ---
  const onMouseDown = (e: React.MouseEvent) => {
    if (collapsed) return
    isResizing.current = true
    startX.current = e.clientX
    startWidth.current = width
    document.body.style.cursor = "col-resize"
    document.body.style.userSelect = "none"
    e.preventDefault()
  }

  // --- Rename handlers ---
  const startRename = (c: ConversationRow) => {
    setRenamingId(c.id)
    setRenameValue(c.title.trim() || t.sidebar.newConversation)
    // Focus au prochain tick
    setTimeout(() => renameInputRef.current?.focus(), 0)
  }

  const confirmRename = (id: string) => {
    const trimmed = renameValue.trim()
    if (trimmed && trimmed !== conversations.find((c) => c.id === id)?.title) {
      onRename(id, trimmed)
    }
    setRenamingId(null)
    setRenameValue("")
  }

  const cancelRename = () => {
    setRenamingId(null)
    setRenameValue("")
  }

  const handleRenameKeyDown = (e: React.KeyboardEvent, id: string) => {
    if (e.key === "Enter") confirmRename(id)
    else if (e.key === "Escape") cancelRename()
  }

  // Double-click pour renommer
  const onDoubleClick = (c: ConversationRow) => {
    if (!collapsed) startRename(c)
  }

  if (collapsed) {
    return (
      <aside
        className="flex h-full flex-shrink-0 flex-col border-r border-border bg-background"
        style={{ width: COLLAPSED_WIDTH }}
      >
        <button
          onClick={onToggleCollapse}
          aria-label={t.sidebar.expand}
          className="flex h-10 items-center justify-center rounded-md hover:bg-foreground/5 mx-1 mt-2"
        >
          <ChevronRight className="size-5" />
        </button>
        <div className="flex-1 overflow-hidden" />
        <button
          onClick={onNew}
          aria-label={t.sidebar.newConversation}
          className="flex h-10 items-center justify-center rounded-md hover:bg-foreground/5 mx-1 mb-2"
        >
          <Plus className="size-5" />
        </button>
      </aside>
    )
  }

  return (
    <aside
      className="relative flex h-full flex-shrink-0 flex-col border-r border-border bg-background"
      style={{ width }}
    >
      <header className="flex items-center justify-between gap-2 p-2">
        <button
          onClick={onNew}
          className="flex items-center gap-2 rounded-md border border-border px-3 py-2 text-sm hover:bg-foreground/5 flex-1 truncate"
        >
          <Plus className="size-4 flex-shrink-0" />
          <span className="truncate">{t.sidebar.newConversation}</span>
        </button>
        <button
          onClick={onToggleCollapse}
          aria-label={t.sidebar.collapse}
          className="flex h-10 items-center justify-center rounded-md hover:bg-foreground/5 flex-shrink-0"
        >
          <ChevronLeft className="size-5" />
        </button>
      </header>

      <div className="flex items-center gap-2 rounded-md border border-border px-2 py-1 mx-2">
        <Search className="size-4 opacity-50 flex-shrink-0" />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t.sidebar.search}
          className="w-full bg-transparent text-sm outline-none"
        />
      </div>

      <nav className="flex-1 space-y-1 overflow-y-auto px-2">
        {filtered.map((c) => (
          <div
            key={c.id}
            role="button"
            tabIndex={0}
            aria-label={c.title.trim() || t.sidebar.newConversation}
            aria-current={c.id === activeId ? "true" : undefined}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") onSelect(c.id)
              else if (e.key === "F2") startRename(c)
            }}
            onDoubleClick={() => onDoubleClick(c)}
            className={`group flex cursor-pointer items-center justify-between rounded-md px-2 py-1.5 text-sm transition-colors ${
              c.id === activeId ? "bg-foreground/10" : "hover:bg-foreground/5"
            }`}
            onClick={() => {
              disarmDelete()
              onSelect(c.id)
            }}
          >
            {renamingId === c.id ? (
              <input
                ref={renameInputRef}
                value={renameValue}
                onChange={(e) => setRenameValue(e.target.value)}
                onBlur={() => confirmRename(c.id)}
                onKeyDown={(e) => handleRenameKeyDown(e, c.id)}
                className="w-full bg-background border border-primary px-2 py-1 text-sm outline-none focus:border-primary"
                autoFocus
              />
            ) : (
              <>
                <span className="truncate flex-1 min-w-0 pr-2">{c.title.trim() || t.sidebar.newConversation}</span>
                <div
                  className={`flex items-center gap-1 transition-opacity ${
                    confirmDeleteId === c.id || c.pinned === 1
                      ? "opacity-100"
                      : "opacity-0 group-hover:opacity-100"
                  }`}
                >
                  <button
                    onClick={(e) => {
                      e.stopPropagation()
                      onTogglePin(c.id, c.pinned === 0)
                    }}
                    aria-label={c.pinned === 0 ? t.sidebar.pin : t.sidebar.unpin}
                    aria-pressed={c.pinned === 0 ? "false" : "true"}
                    className={`rounded p-1 hover:bg-foreground/10 ${c.pinned === 0 ? "" : "text-[#D64627]"}`}
                    title={c.pinned === 0 ? t.sidebar.pin : t.sidebar.unpin}
                  >
                    {c.pinned === 0 ? <Pin className="size-3.5" /> : <PinOff className="size-3.5" />}
                  </button>
                  <button
                    onClick={(e) => {
                      e.stopPropagation()
                      startRename(c)
                    }}
                    aria-label={t.sidebar.rename}
                    className="rounded p-1 hover:bg-foreground/10"
                    title={t.sidebar.rename}
                  >
                    <Edit2 className="size-3.5" />
                  </button>
                  {confirmDeleteId === c.id ? (
                    <button
                      onClick={(e) => handleDeleteClick(e, c.id)}
                      onKeyDown={(e) => {
                        if (e.key === "Escape") {
                          e.stopPropagation()
                          disarmDelete()
                        }
                      }}
                      aria-label={t.sidebar.deleteConfirm}
                      className="rounded bg-destructive/10 px-1.5 py-1 text-[11px] font-medium text-destructive"
                    >
                      {t.sidebar.deleteConfirm}
                    </button>
                  ) : (
                    <button
                      onClick={(e) => handleDeleteClick(e, c.id)}
                      aria-label={t.sidebar.delete}
                      className="rounded p-1 hover:bg-destructive/10 text-destructive"
                      title={t.sidebar.delete}
                    >
                      <Trash2 className="size-3.5" />
                    </button>
                  )}
                </div>
              </>
            )}
          </div>
        ))}
      </nav>

      {/* Resize handle - positioned absolutely on right edge */}
      {!collapsed && (
        <div
          onMouseDown={onMouseDown}
          className="absolute top-0 right-0 w-[4px] h-full cursor-col-resize hover:bg-border transition-colors select-none bg-transparent"
          style={{ zIndex: 10 }}
          aria-label="Redimensionner la barre latérale"
          role="separator"
          tabIndex={0}
        >
          <div className="w-full h-full flex items-center justify-center">
            <GripVertical className="size-4 text-muted-foreground/50 hover:text-muted-foreground transition-colors" />
          </div>
        </div>
      )}
    </aside>
  )
}
