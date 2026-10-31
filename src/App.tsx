import { useCallback, useEffect, useState } from "react"
import { BookOpen, Settings as SettingsIcon } from "lucide-react"
import logoSrc from "@/assets/logo.png"
import { t } from "@/i18n/fr"
import { conversations } from "@/lib/db/conversations"
import { getActiveModel, type ActiveModel } from "@/lib/db/activeModel"
import { providers, type ProviderRow, type ModelRow } from "@/lib/db/providers"
import { useConversations } from "@/hooks/useConversations"
import { useChat, type Attachment } from "@/hooks/useChat"
import { Sidebar } from "@/components/sidebar/Sidebar"
import { ChatView } from "@/components/chat/ChatView"
import { InputBar } from "@/components/chat/InputBar"
import { SettingsDialog } from "@/components/settings/SettingsDialog"
import { AssistantDialog } from "@/components/settings/AssistantDialog"
import { appVersion } from "@/lib/appVersion"

const DEFAULT_SIDEBAR_WIDTH = 280

function App() {
  const { list, refresh } = useConversations()
  const [activeId, setActiveId] = useState<string | null>(null)
  const [activeModel, setActiveModel] = useState<ActiveModel | null>(null)
  const [modelOptions, setModelOptions] = useState<{ rowId: string; label: string; isDefault: boolean; supportsImages: boolean }[]>([])
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [assistantOpen, setAssistantOpen] = useState(false)
  const [sidebarWidth, setSidebarWidth] = useState(DEFAULT_SIDEBAR_WIDTH)
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)

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
            supportsImages: m.supports_images === 1,
          })),
        ),
      )
    })().catch(console.error)
  }, [])

  useEffect(() => {
    void (async () => {
      await providers.seedDefaultProvider()
      refetchActiveModel()
      refetchModelOptions()
    })()
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
    ? {
        provider: activeModel.provider,
        modelId: activeModel.modelId,
        supportsImages: modelOptions.find((o) => o.isDefault)?.supportsImages ?? false,
      }
    : null
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

  const onRename = useCallback(
    async (id: string, newTitle: string) => {
      await conversations.rename(id, newTitle)
      await refresh()
    },
    [refresh],
  )

  const onSend = useCallback(
    (text: string, attachments: Attachment[]): Promise<boolean> => {
      if (!activeId) return Promise.resolve(false)
      // send ne rejette jamais : false = échec de persistance (InputBar
      // restaurera le contenu), true en fin de stream.
      return send(activeId, text, attachments)
    },
    [activeId, send],
  )

  const toggleSidebar = useCallback(() => {
    setSidebarCollapsed((prev) => !prev)
  }, [])

  return (
    <main className="flex h-screen overflow-hidden">
      <Sidebar
        conversations={list}
        activeId={activeId}
        onSelect={setActiveId}
        onNew={() => void onNew().catch(console.error)}
        onDelete={(id) => void onDelete(id).catch(console.error)}
        onRename={onRename}
        width={sidebarWidth}
        onWidthChange={setSidebarWidth}
        collapsed={sidebarCollapsed}
        onToggleCollapse={toggleSidebar}
      />
      <section className="flex flex-1 flex-col overflow-hidden">
        <header className="flex items-center justify-between border-b border-border px-4 py-3">
          <div className="flex items-center gap-2.5">
            <span className="brand-mark" aria-hidden="true">
              <img src={logoSrc} alt="" className="size-full object-contain" />
            </span>
            <div>
              <h1 className="text-base font-semibold">
                {t.app.title}
                <span className="ml-1.5 align-baseline text-xs font-normal text-muted-foreground">
                  v{appVersion}
                </span>
              </h1>
              <p className="text-xs text-muted-foreground">{t.app.subtitle}</p>
            </div>
          </div>
        <div className="flex items-center gap-1">
          <button
            aria-label={t.assistant.title}
            onClick={() => setAssistantOpen(true)}
            className="rounded-md p-1.5 hover:bg-foreground/5"
          >
            <BookOpen className="size-4" />
          </button>
          <button
            aria-label={t.settings.title}
            onClick={() => setSettingsOpen(true)}
            className="rounded-md p-1.5 hover:bg-foreground/5"
          >
            <SettingsIcon className="size-4" />
          </button>
        </div>
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
      {assistantOpen && <AssistantDialog onClose={() => setAssistantOpen(false)} />}
    </main>
  )
}

export default App
