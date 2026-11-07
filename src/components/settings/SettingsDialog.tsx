import { useCallback, useEffect, useState } from "react"
import { Plus, Search, X } from "lucide-react"
import { ReglageIcon } from "@/icons"
import { confirm as dialogConfirm } from "@tauri-apps/plugin-dialog"
import { t } from "@/i18n/fr"
import { logger } from "@/lib/logger"
import { createProvider } from "@/lib/ai/factory"
import { KIND_TO_KEY, redactSensitiveDetail } from "@/lib/ai/errors"
import { providers, secretRefFor, type ProviderRow, type ModelRow } from "@/lib/db/providers"
import { secrets } from "@/lib/secrets/service"
import { ProviderForm } from "./ProviderForm"
import { LocalModelsPanel } from "./LocalModelsPanel"
import { ModelPickerModal } from "./ModelPickerModal"
import { HEADER_TOOL_DIALOG_SIZE_CLASS } from "./headerToolDialog"
import {
  ProviderCard,
  type ProviderConnectionStatus,
  type ProviderFetchStatus,
} from "./ProviderCard"

interface Props {
  onClose: () => void
  onChanged: () => void
}

function errorMessageForKind(error: unknown): string | undefined {
  if (typeof error !== "object" || error === null || !("kind" in error)) return undefined
  const kind = error.kind
  if (typeof kind !== "string" || !Object.prototype.hasOwnProperty.call(KIND_TO_KEY, kind)) {
    return undefined
  }
  return t.errors[KIND_TO_KEY[kind as keyof typeof KIND_TO_KEY]]
}

function safeSettingsErrorMessage(
  error: unknown,
  exactSecrets: readonly string[] = [],
): string {
  const message = error instanceof Error ? error.message : String(error)
  return redactSensitiveDetail(message, exactSecrets)
}

function logSettingsError(
  context: string,
  error: unknown,
  exactSecrets: readonly string[] = [],
): void {
  logger.error({ context, message: safeSettingsErrorMessage(error, exactSecrets) })
}

// Overlay plein écran simple M1 (pas de shadcn Dialog avant V1.1) :
// liste des fournisseurs + CRUD inline, test connexion, gestion des modèles.
export function SettingsDialog({ onClose, onChanged }: Props) {
  const [rows, setRows] = useState<ProviderRow[]>([])
  const [models, setModels] = useState<Record<string, ModelRow[]>>({})
  const [editing, setEditing] = useState<ProviderRow | "new" | null>(null)
  const [testStatus, setTestStatus] = useState<Record<string, ProviderConnectionStatus>>({})
  const [fetchStatus, setFetchStatus] = useState<Record<string, ProviderFetchStatus | undefined>>({})
  const [browsing, setBrowsing] = useState<ProviderRow | null>(null)
  const [providerQuery, setProviderQuery] = useState("")
  // Onglet par défaut = « Fournisseurs » : le comportement historique reste
  // identique (tests existants inchangés) ; « Modèles local » est à côté.
  const [tab, setTab] = useState<"providers" | "local">("providers")

  const refresh = useCallback(async () => {
    const list = await providers.list()
    setRows(list)
    const entries = await Promise.all(
      list.map(async (p) => [p.id, await providers.listModels(p.id)] as const),
    )
    setModels(Object.fromEntries(entries))
  }, [])

  useEffect(() => {
    void refresh().catch((error) => logSettingsError("settings.refresh", error))
  }, [refresh])

  // Escape ferme (globale : focus pouvant être dans n'importe quel input) ;
  // le modal de parcourt a priorité : il est fermé en premier, pas le dialog.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (browsing) setBrowsing(null)
        else onClose()
      }
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [onClose, browsing])

  const afterChange = useCallback(async () => {
    await refresh()
    onChanged()
  }, [refresh, onChanged])

  const test = async (p: ProviderRow) => {
    setTestStatus((s) => ({ ...s, [p.id]: { state: "testing" } }))
    let activeKey = ""
    try {
      const prov = createProvider({
        id: p.id, name: p.name, apiFamily: p.api_family, baseUrl: p.base_url, secretRef: secretRefFor(p.id),
      })
      activeKey = (await secrets.get(secretRefFor(p.id))) ?? ""
      if (!activeKey) {
        setTestStatus((s) => ({ ...s, [p.id]: { state: "fail", message: t.settings.noKey } }))
        return
      }
      // Signature exacte (Task 5) : { ok: boolean; error?: ApiError } — pas de latence.
      const res = await prov.testConnection(activeKey)
      setTestStatus((s) => ({
        ...s,
        [p.id]: res.ok
          ? { state: "ok" }
          : { state: "fail", message: errorMessageForKind(res.error) ?? t.settings.fail },
      }))
    } catch (e) {
      logSettingsError("settings.testConnection", e, [activeKey])
      setTestStatus((s) => ({
        ...s,
        [p.id]: { state: "fail", message: errorMessageForKind(e) ?? t.settings.fail },
      }))
    }
  }

  const addModel = async (p: ProviderRow, modelId: string) => {
    const trimmed = modelId.trim()
    if (!trimmed) return
    await providers.addModel(p.id, trimmed)
    await afterChange()
  }

  const removeProvider = async (p: ProviderRow) => {
    // Dialogue natif du plugin (pas window.confirm) : la webview Tauri
    // n'affiche pas les dialogues JS synchrones de façon fiable.
    const ok = await dialogConfirm(t.settings.deleteConfirm, {
      title: p.name,
      kind: "warning",
    })
    if (!ok) return
    await providers.remove(p.id) // secret + cascade models via FK
    await afterChange()
  }

  // Récupération des modèles annoncés par le fournisseur (GET /models) —
  // dédoublonnage contre la base ET contre les doublons du retour API.
  const fetchModels = async (p: ProviderRow) => {
    setFetchStatus((s) => ({ ...s, [p.id]: { state: "fetching" } }))
    let activeKey = ""
    try {
      activeKey = (await secrets.get(secretRefFor(p.id))) ?? ""
      if (!activeKey) {
        setFetchStatus((s) => ({ ...s, [p.id]: { state: "fail", message: t.settings.noKey } }))
        return
      }
      const ids = await createProvider({
        id: p.id, name: p.name, apiFamily: p.api_family, baseUrl: p.base_url, secretRef: secretRefFor(p.id),
      }).listRemoteModels(activeKey)
      if (ids.length === 0) {
        setFetchStatus((s) => ({ ...s, [p.id]: { state: "fail", message: t.settings.fetchFail } }))
        return
      }
      const existing = new Set((await providers.listModels(p.id)).map((m) => m.model_id))
      // Dédoublonnage : contre la base (existing) + doublons du retour API
      const seen = new Set<string>()
      const newModels = ids.filter((id) => !existing.has(id) && !seen.has(id) && (seen.add(id), true))
      if (newModels.length === 0) {
        setFetchStatus((s) => ({ ...s, [p.id]: { state: "fail", message: t.settings.fetchFail } }))
        return
      }
      // Auto-ajout en base
      let added = 0
      for (const modelId of newModels) {
        await providers.addModel(p.id, modelId)
        added++
      }
      // Refresh pour recharger models depuis la DB (inclut les nouveaux)
      await afterChange()
      setFetchStatus((s) => ({ ...s, [p.id]: { state: "ok", added } }))
    } catch (e) {
      logSettingsError("settings.fetchModels", e, [activeKey])
      setFetchStatus((s) => ({
        ...s,
        [p.id]: { state: "fail", message: errorMessageForKind(e) ?? t.settings.fetchFail },
      }))
    }
  }

  const normalizedProviderQuery = providerQuery.trim().toLocaleLowerCase("fr")
  const filteredRows = normalizedProviderQuery
    ? rows.filter((provider) =>
        provider.name.toLocaleLowerCase("fr").includes(normalizedProviderQuery)
        || provider.base_url.toLocaleLowerCase("fr").includes(normalizedProviderQuery))
    : rows

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
      onClick={onClose}
      data-testid="settings-dialog"
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={t.settings.title}
        className={`${HEADER_TOOL_DIALOG_SIZE_CLASS} overflow-y-auto rounded-lg border border-border bg-background p-4`}
        onClick={(e) => e.stopPropagation()}
      >
        <header className="mb-3 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <h2 className="text-base font-semibold">{t.settings.title}</h2>
            <ReglageIcon
              data-testid="settings-dialog-icon"
              className="size-4 text-muted-foreground opacity-70"
            />
          </div>
          <button aria-label={t.settings.close} onClick={onClose} className="rounded-md p-1 hover:bg-foreground/5">
            <X className="size-4" />
          </button>
        </header>

        {editing === null && <TabBar tab={tab} setTab={setTab} />}

        {editing !== null ? (
          <ProviderForm
            initial={editing === "new" ? undefined : editing}
            onSaved={() => {
              setEditing(null)
              void afterChange().catch((error) => logSettingsError("settings.afterChange", error))
            }}
            onCancel={() => setEditing(null)}
          />
        ) : tab === "local" ? (
          <LocalModelsPanel rows={rows} onChanged={afterChange} />
        ) : (
          <>
            <div className="relative mb-3">
              <Search
                aria-hidden="true"
                className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
              />
              <input
                type="search"
                value={providerQuery}
                onChange={(event) => setProviderQuery(event.target.value)}
                aria-label={t.settings.searchProviders}
                placeholder={t.settings.searchProvidersPlaceholder}
                className="w-full rounded-md border border-border bg-background py-2 pl-9 pr-3 text-sm outline-none placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-brand-to"
              />
            </div>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
              <button
                type="button"
                onClick={() => setEditing("new")}
                className="flex min-h-64 flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed border-border bg-background/50 p-5 outline-none transition-[border-color,background-color] hover:border-brand-to hover:bg-foreground/5 focus-visible:ring-2 focus-visible:ring-brand-to motion-reduce:transition-none"
              >
                <Plus aria-hidden="true" className="size-7 text-muted-foreground" />
                <span className="text-center text-sm font-medium text-muted-foreground">
                  {t.settings.addProvider}
                </span>
              </button>

              {rows.length === 0 && (
                <p className="col-span-full text-center text-sm text-muted-foreground">
                  {t.settings.noProviders}
                </p>
              )}

              {rows.length > 0 && filteredRows.length === 0 && (
                <p className="col-span-full text-center text-sm text-muted-foreground">
                  {t.settings.noProviderResults}
                </p>
              )}

              {filteredRows.map((provider) => (
                <ProviderCard
                  key={provider.id}
                  provider={provider}
                  modelCount={(models[provider.id] ?? []).length}
                  connectionStatus={testStatus[provider.id] ?? { state: "idle" }}
                  fetchStatus={fetchStatus[provider.id]}
                  onTest={() => void test(provider)}
                  onFetchModels={() => void fetchModels(provider)}
                  onEdit={() => setEditing(provider)}
                  onDelete={() => void removeProvider(provider).catch((error) =>
                    logSettingsError("settings.removeProvider", error))}
                  onBrowseModels={() => setBrowsing(provider)}
                />
              ))}
            </div>
          </>
        )}

        {/* Modal parcourt des modèles (au-dessus des réglages) */}
        {browsing && (
          <ModelPickerModal
            providerName={browsing.name}
            models={(models[browsing.id] ?? []).map((m) => ({
              id: m.id, label: m.model_id, isDefault: m.is_default === 1,
            }))}
            onAddModel={async (modelId) => {
              if (!browsing) return
              await addModel(browsing, modelId)
            }}
            onSelect={(modelRowId) => {
              setBrowsing(null)
              void providers
                .setDefaultModel(modelRowId)
                .then(afterChange)
                .catch((error) => logSettingsError("settings.selectModel", error))
            }}
            onClose={() => setBrowsing(null)}
          />
        )}
      </div>
    </div>
  )
}

// Deux onglets « Fournisseurs » / « Modèles local » — même style que les
// listes de cartes (border-border, hint muted) pour rester cohérent.
function TabBar({ tab, setTab }: { tab: "providers" | "local"; setTab: (t: "providers" | "local") => void }) {
  const tabs = [
    { id: "providers" as const, label: t.settings.tabProviders },
    { id: "local" as const, label: t.settings.tabLocal },
  ]
  return (
    <div className="mb-3 flex gap-1 rounded-md border border-border p-1">
      {tabs.map((item) => (
        <button
          key={item.id}
          data-tab={item.id}
          aria-current={tab === item.id}
          onClick={() => setTab(item.id)}
          className={
            tab === item.id
              ? "flex-1 rounded-md bg-foreground/10 px-3 py-1.5 text-sm font-medium"
              : "flex-1 rounded-md px-3 py-1.5 text-sm text-muted-foreground hover:bg-foreground/5"
          }
        >
          {item.label}
        </button>
      ))}
    </div>
  )
}
