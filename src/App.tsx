import { useCallback, useEffect, useState } from "react"
import { Settings as SettingsIcon } from "lucide-react"
import { t } from "@/i18n/fr"
import { conversations } from "@/lib/db/conversations"
import { getActiveModel, type ActiveModel } from "@/lib/db/activeModel"
import { providers, type ProviderRow, type ModelRow } from "@/lib/db/providers"
import { useConversations } from "@/hooks/useConversations"
import { useChat } from "@/hooks/useChat"
import { Sidebar } from "@/components/sidebar/Sidebar"
import { ChatView } from "@/components/chat/ChatView"
import { InputBar } from "@/components/chat/InputBar"
import { SettingsDialog } from "@/components/settings/SettingsDialog"

function App() {
  const { list, refresh } = useConversations()
  const [activeId, setActiveId] = useState<string | null>(null)
  const [activeModel, setActiveModel] = useState<ActiveModel | null>(null)
  const [modelOptions, setModelOptions] = useState<{ rowId: string; label: string; isDefault: boolean }[]>([])
  const [settingsOpen, setSettingsOpen] = useState(false)

  // Lecture refetchable du modèle actif (erreurs → null : l'UI affiche
  // l'état « non configuré » plutôt qu'un écran vide).
  const refetchActiveModel = useCallback(() => {
    void getActiveModel()
      .then(setActiveModel)
      .catch((e) => {
        console.error(e)
        setActiveModel(null)
      })
  }, [])

  // Lecture des options du sélecteur : providers › modèles aplatis.
  const refetchModelOptions = useCallback(() => {
    void (async () => {
      const providerRows: ProviderRow[] = await providers.list()
      const modelLists: ModelRow[][] = await Promise.all(providerRows.map((p) => providers.listModels(p.id)))
      setModelOptions(
        providerRows.flatMap((p, i) =>
          modelLists[i].map((m) => ({
            rowId: m.id,
            label: `${p.name} › ${m.model_id}`,
            isDefault: m.is_default === 1,
          })),
        ),
      )
    })().catch(console.error)
  }, [])

  useEffect(() => {
    refetchActiveModel()
    refetchModelOptions()
  }, [refetchActiveModel, refetchModelOptions])

  // Rafraîchit providers + activeModel après tout changement du dialog.
  const onSettingsChanged = useCallback(() => {
    refetchActiveModel()
    refetchModelOptions()
  }, [refetchActiveModel, refetchModelOptions])

  const onModelSelect = useCallback(
    (rowId: string) => {
      void providers
        .setDefaultModel(rowId)
        .then(() => {
          refetchActiveModel()
          refetchModelOptions()
        })
        .catch(console.error)
    },
    [refetchActiveModel, refetchModelOptions],
  )

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
        <header className="flex items-center justify-between border-b border-border px-4 py-3">
          <div>
            <h1 className="text-base font-semibold">{t.app.title}</h1>
            <p className="text-xs text-muted-foreground">{t.app.subtitle}</p>
          </div>
          <button
            aria-label={t.settings.title}
            onClick={() => setSettingsOpen(true)}
            className="rounded-md p-1.5 hover:bg-foreground/5"
          >
            <SettingsIcon className="size-4" />
          </button>
        </header>
        <ChatView
          vm={vm}
          hasModel={modelSelection !== null}
          showConversation={activeId !== null}
          modelSelector={{
            options: modelOptions,
            onSelect: onModelSelect,
          }}
        />
        <InputBar
          disabled={activeId === null || modelSelection === null}
          busy={busy}
          onSend={onSend}
          onInterrupt={interrupt}
        />
      </section>
      {settingsOpen && (
        <SettingsDialog onClose={() => setSettingsOpen(false)} onChanged={onSettingsChanged} />
      )}
    </main>
  )
}

export default App
