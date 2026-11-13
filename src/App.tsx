import { useCallback, useEffect, useState } from "react"
import { Sun, Moon } from "lucide-react"
import { BookIcon, McpIcon, ParaGenIcon, ReglageIcon } from "@/icons"
import logoSrc from "@/assets/logo.png"
import bgDark from "@/assets/background_dark_logassist.png"
import bgLight from "@/assets/background_light_logassist.png"
import { t } from "@/i18n/fr"
import { conversations } from "@/lib/db/conversations"
import { getActiveModel, type ActiveModel } from "@/lib/db/activeModel"
import { providers, type ProviderRow, type ModelRow } from "@/lib/db/providers"
import { useConversations } from "@/hooks/useConversations"
import { useChat, type Attachment, type SendOptions } from "@/hooks/useChat"
import { useMcpRuntime } from "@/hooks/useMcpRuntime"
import { Sidebar } from "@/components/sidebar/Sidebar"
import { ChatView } from "@/components/chat/ChatView"
import { InputBar } from "@/components/chat/InputBar"
import { ProvidersDialog } from "@/components/settings/ProvidersDialog"
import { GeneralSettingsDialog } from "@/components/settings/GeneralSettingsDialog"
import { LockGate } from "@/components/settings/LockGate"
import { isLockActive } from "@/lib/applock/service"
import { AssistantDialog } from "@/components/settings/AssistantDialog"
import { McpDialog } from "@/components/settings/McpDialog"

const DEFAULT_SIDEBAR_WIDTH = 280

function App() {
  const { list, refresh } = useConversations()
  const [activeId, setActiveId] = useState<string | null>(null)
  const [activeModel, setActiveModel] = useState<ActiveModel | null>(null)
  const [modelOptions, setModelOptions] = useState<{ rowId: string; label: string; isDefault: boolean; supportsImages: boolean }[]>([])
  const [providersOpen, setProvidersOpen] = useState(false)
  const [generalSettingsOpen, setGeneralSettingsOpen] = useState(false)
  // Verrou de confort : null = état inconnu (lecture du flag en cours),
  // true = LockGate, false = app déverrouillée. Le fail-open (hash absent)
  // est déjà géré dans isLockActive.
  const [locked, setLocked] = useState<boolean | null>(null)
  const [assistantOpen, setAssistantOpen] = useState(false)
  const [mcpOpen, setMcpOpen] = useState(false)
  const [sidebarWidth, setSidebarWidth] = useState(DEFAULT_SIDEBAR_WIDTH)
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)

  const { snapshot: mcpRuntime, refresh: refreshMcpRuntime } = useMcpRuntime()

  // Dark mode (défaut dark) — persisté dans localStorage
  const [isDark, setIsDark] = useState(() => {
    if (typeof window !== "undefined") {
      const stored = localStorage.getItem("logassist:dark")
      if (stored !== null) return JSON.parse(stored)
    }
    return true // défaut dark
  })

  // Applique la classe .dark sur <html> au montage et à chaque changement
  useEffect(() => {
    const root = document.documentElement
    if (isDark) root.classList.add("dark")
    else root.classList.remove("dark")
    localStorage.setItem("logassist:dark", JSON.stringify(isDark))
  }, [isDark])

  // Lecture de l'état du verrou au démarrage ; une erreur du pont (invoke
  // indisponible) laisse l'app ouverte plutôt que bloquée.
  useEffect(() => {
    void isLockActive()
      .then(setLocked)
      .catch((e) => {
        console.error(e)
        setLocked(false)
      })
  }, [])

  const toggleDark = useCallback(() => setIsDark((d: boolean) => !d), [])

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
        modelRowId: activeModel.modelRowId,
        modelId: activeModel.modelId,
        supportsImages: modelOptions.find((o) => o.isDefault)?.supportsImages ?? false,
        contextWindowOverride: activeModel.contextWindowOverride,
        maxOutputTokensOverride: activeModel.maxOutputTokensOverride,
      }
    : null
  const {
    vm,
    busy,
    send,
    retryLast,
    regenerateLast,
    interrupt,
    load,
    webToolsUnsupported,
    allowTool,
    denyTool,
  } = useChat(modelSelection, mcpRuntime)

  // Chargement de l'historique à chaque changement de conversation active.
  useEffect(() => {
    if (!activeId) return
    void load(activeId).catch(console.error)
  }, [activeId, load])

  // Après la persistance attendue par useChat, ce rechargement réconcilie la
  // vue avec l'état canonique de la conversation stocké dans SQLite.
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

  const onTogglePin = useCallback(
    async (id: string, pinned: boolean) => {
      await conversations.setPinned(id, pinned)
      await refresh()
    },
    [refresh],
  )

  const onSend = useCallback(
    (text: string, attachments: Attachment[], options: SendOptions): Promise<boolean> => {
      if (!activeId) return Promise.resolve(false)
      // send ne rejette jamais : false = échec de persistance (InputBar
      // restaurera le contenu), true en fin de stream.
      return send(activeId, text, attachments, options)
    },
    [activeId, send],
  )

  const onRetry = useCallback(
    (messageId: string): Promise<boolean> =>
      activeId ? retryLast(activeId, messageId) : Promise.resolve(false),
    [activeId, retryLast],
  )

  const onRegenerate = useCallback(
    (messageId: string): Promise<boolean> =>
      activeId ? regenerateLast(activeId, messageId) : Promise.resolve(false),
    [activeId, regenerateLast],
  )

  const selectConversation = useCallback(
    (id: string) => {
      if (busy) interrupt()
      setActiveId(id)
    },
    [busy, interrupt],
  )

  const toggleSidebar = useCallback(() => {
    setSidebarCollapsed((prev) => !prev)
  }, [])

  // Tant que l'état du verrou est inconnu : calque opaque (pas de flash de
  // contenu). Verrou actif : LockGate en calque assombri au-dessus de
  // l'interface (compromis assumé du verrou de confort — l'interface n'est
  // ni cliquable ni lisible derrière le calque).
  if (locked === null) return <div className="fixed inset-0 z-[60] bg-background" aria-hidden="true" />

  return (
    <main className="flex h-screen overflow-hidden">
      <Sidebar
        conversations={list}
        activeId={activeId}
        onSelect={selectConversation}
        onNew={() => void onNew().catch(console.error)}
        onDelete={(id) => void onDelete(id).catch(console.error)}
        onRename={onRename}
        onTogglePin={onTogglePin}
        width={sidebarWidth}
        onWidthChange={setSidebarWidth}
        collapsed={sidebarCollapsed}
        onToggleCollapse={toggleSidebar}
      />
      <section
        className="flex flex-1 flex-col overflow-hidden bg-cover bg-center"
        style={{ backgroundImage: `url(${isDark ? bgDark : bgLight})` }}
      >
        <header className="flex items-center justify-between border-b border-border px-4 py-3">
          <div className="flex items-center gap-2.5">
            <span className="brand-mark" aria-hidden="true">
              <img src={logoSrc} alt="" className="size-full object-contain" />
            </span>
            <div>
              <h1 className="text-base font-semibold">{t.app.title}</h1>
              <p className="text-xs text-muted-foreground">{t.app.subtitle}</p>
            </div>
          </div>
        <div className="flex items-center gap-1">
          {/* Dark mode toggle */}
          <button
            aria-label={isDark ? t.chat.darkMode : t.chat.lightMode}
            title={isDark ? t.chat.darkMode : t.chat.lightMode}
            onClick={toggleDark}
            className="rounded-md p-1.5 hover:bg-foreground/5 transition-colors"
          >
            {isDark ? <Moon className="size-[22px]" /> : <Sun className="size-[22px]" />}
          </button>
          {/* Séparateur discret */}
           <div className="w-px h-5 bg-border mx-1" aria-hidden="true" />
           <button
            aria-label={t.mcp.open}
             title={t.mcp.title}
             onClick={() => setMcpOpen(true)}
             className="rounded-md p-1.5 hover:bg-foreground/5"
           >
             <McpIcon className="size-[22px]" />
           </button>
           <button
            aria-label={t.assistant.title}
             title={t.assistant.title}
            onClick={() => setAssistantOpen(true)}
            className="rounded-md p-1.5 hover:bg-foreground/5"
          >
            <BookIcon className="size-[22px]" />
          </button>
          <button
            aria-label={t.providers.modelsSettings}
            title={t.providers.modelsSettings}
            onClick={() => setProvidersOpen(true)}
            className="rounded-md p-1.5 hover:bg-foreground/5"
          >
            <ReglageIcon className="size-[22px]" />
          </button>
          {/* Séparateur discret */}
          <div className="w-px h-5 bg-border mx-1" aria-hidden="true" />
          <button
            aria-label={t.generalSettings.open}
            title={t.generalSettings.open}
            onClick={() => setGeneralSettingsOpen(true)}
            className="rounded-md p-1.5 hover:bg-foreground/5"
          >
            <ParaGenIcon className="size-[22px]" />
          </button>
        </div>
        </header>
        <ChatView
          vm={vm}
          hasModel={modelSelection !== null}
          showConversation={activeId !== null}
          conversationId={activeId}
          isGenerating={busy}
          onRetry={onRetry}
          onRegenerate={onRegenerate}
          modelSelector={{
            options: modelOptions,
            onSelect: onModelSelect,
          }}
          onAllowTool={allowTool}
          onDenyTool={denyTool}
        />
        <InputBar
          disabled={activeId === null || modelSelection === null}
          busy={busy}
          onSend={onSend}
          onInterrupt={interrupt}
          webAvailable={mcpRuntime.webAccess.enabled && mcpRuntime.webAccess.configured && !webToolsUnsupported}
          webUnavailableReason={webToolsUnsupported ? t.chat.webModelUnsupported : t.chat.webUnavailable}
        />
      </section>
      {providersOpen && (
        <ProvidersDialog onClose={() => setProvidersOpen(false)} onChanged={onSettingsChanged} />
      )}
      {generalSettingsOpen && (
        <GeneralSettingsDialog onClose={() => setGeneralSettingsOpen(false)} />
      )}
      {assistantOpen && <AssistantDialog onClose={() => setAssistantOpen(false)} conversationId={activeId} />}
      {locked && <LockGate onUnlock={() => setLocked(false)} />}
      {mcpOpen && (
        <McpDialog
          snapshot={mcpRuntime}
          onClose={() => setMcpOpen(false)}
          onChanged={async () => {
            await refreshMcpRuntime()
            // Note: refetchWebAccess is no longer needed as webAccess comes from mcpRuntime
          }}
        />
      )}
    </main>
  )
}

export default App
