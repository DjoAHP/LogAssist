import { useCallback, useEffect, useState } from "react"
import { t } from "@/i18n/fr"
import { conversations } from "@/lib/db/conversations"
import { getActiveModel, type ActiveModel } from "@/lib/db/activeModel"
import { useConversations } from "@/hooks/useConversations"
import { useChat } from "@/hooks/useChat"
import { Sidebar } from "@/components/sidebar/Sidebar"
import { ChatView } from "@/components/chat/ChatView"
import { InputBar } from "@/components/chat/InputBar"

function App() {
  const { list, refresh } = useConversations()
  const [activeId, setActiveId] = useState<string | null>(null)
  const [activeModel, setActiveModel] = useState<ActiveModel | null>(null)

  // Lecture du modèle actif (minimal avant Task 10 : modèle par défaut en base).
  useEffect(() => {
    void getActiveModel()
      .then(setActiveModel)
      .catch(console.error)
  }, [])

  const modelSelection = activeModel
  const { vm, busy, send, interrupt, load } = useChat(modelSelection)

  // Chargement de l'historique à chaque changement de conversation active.
  useEffect(() => {
    if (!activeId) return
    void load(activeId).catch(console.error)
  }, [activeId, load])

  // Reload post-stream (done/erreur/interruption) : le useChat ne réordonne pas
  // les inserts async (onDone/onError s'exécutent en tâche de fond après la
  // résolution du stream) — on recharge la conversation active depuis la DB
  // dès que busy repasse à false pour garantir affiché = persisté.
  useEffect(() => {
    if (!busy && activeId) void load(activeId).catch(console.error)
  }, [busy])

  const onNew = useCallback(async () => {
    const row = await conversations.create()
    await refresh()
    setActiveId(row.id)
  }, [refresh])

  const onDelete = useCallback(
    async (id: string) => {
      await conversations.remove(id) // cascade messages via FK
      await refresh()
      if (id === activeId) setActiveId(null)
    },
    [refresh, activeId],
  )

  const onSend = useCallback(
    (text: string) => {
      if (!activeId) return
      void send(activeId, text).catch(console.error)
    },
    [activeId, send],
  )

  return (
    <main className="flex h-screen overflow-hidden">
      <Sidebar
        conversations={list}
        activeId={activeId}
        onSelect={setActiveId}
        onNew={() => void onNew().catch(console.error)}
        onDelete={(id) => void onDelete(id).catch(console.error)}
      />
      <section className="flex flex-1 flex-col overflow-hidden">
        <header className="border-b border-border px-4 py-3">
          <h1 className="text-base font-semibold">{t.app.title}</h1>
          <p className="text-xs text-muted-foreground">{t.app.subtitle}</p>
        </header>
        <ChatView
          vm={vm}
          hasModel={modelSelection !== null}
          showConversation={activeId !== null}
        />
        <InputBar
          disabled={activeId === null || modelSelection === null}
          busy={busy}
          onSend={onSend}
          onInterrupt={interrupt}
        />
      </section>
    </main>
  )
}

export default App
