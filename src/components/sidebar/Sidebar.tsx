import { useState } from "react"
import { Plus, Search, Trash2 } from "lucide-react"
import { t } from "@/i18n/fr"
import type { ConversationRow } from "@/lib/db/conversations"

interface Props {
  conversations: ConversationRow[]
  activeId: string | null
  onSelect: (id: string) => void
  onNew: () => void
  onDelete: (id: string) => void
}

export function Sidebar({ conversations, activeId, onSelect, onNew, onDelete }: Props) {
  const [query, setQuery] = useState("")
  const filtered = conversations.filter((c) => c.title.toLowerCase().includes(query.toLowerCase()))
  return (
    <aside className="flex h-full w-64 flex-shrink-0 flex-col gap-2 border-r border-border bg-background p-2">
      <button
        onClick={onNew}
        className="flex items-center gap-2 rounded-md border border-border px-3 py-2 text-sm hover:bg-foreground/5"
      >
        <Plus className="size-4" /> {t.sidebar.newConversation}
      </button>
      <div className="flex items-center gap-2 rounded-md border border-border px-2 py-1">
        <Search className="size-4 opacity-50" />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t.sidebar.search}
          className="w-full bg-transparent text-sm outline-none"
        />
      </div>
      <nav className="flex-1 space-y-1 overflow-y-auto">
        {filtered.map((c) => (
          <div
            key={c.id}
            role="button"
            tabIndex={0}
            aria-label={c.title.trim() || t.sidebar.newConversation}
            aria-current={c.id === activeId ? "true" : undefined}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") onSelect(c.id)
            }}
            className={`group flex cursor-pointer items-center justify-between rounded-md px-2 py-1.5 text-sm ${
              c.id === activeId ? "bg-foreground/10" : "hover:bg-foreground/5"
            }`}
            onClick={() => onSelect(c.id)}
          >
            <span className="truncate">{c.title.trim() || t.sidebar.newConversation}</span>
            <button
              aria-label={t.sidebar.delete}
              className="opacity-0 focus-visible:opacity-100 group-hover:opacity-60 hover:!opacity-100"
              onClick={(e) => {
                e.stopPropagation()
                onDelete(c.id)
              }}
            >
              <Trash2 className="size-3.5" />
            </button>
          </div>
        ))}
      </nav>
    </aside>
  )
}
