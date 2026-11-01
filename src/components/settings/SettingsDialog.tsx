import { useCallback, useEffect, useMemo, useState } from "react"
import { Check, Plus, Trash2, X } from "lucide-react"
import { t } from "@/i18n/fr"
import { logger } from "@/lib/logger"
import { createProvider } from "@/lib/ai/factory"
import { KIND_TO_KEY } from "@/lib/ai/errors"
import { providers, secretRefFor, type ProviderRow, type ModelRow } from "@/lib/db/providers"
import { secrets } from "@/lib/secrets/service"
import { ProviderForm } from "./ProviderForm"
import { ModelDropdown } from "./ModelDropdown"

type TestStatus = { state: "idle" } | { state: "testing" } | { state: "ok" } | { state: "fail"; message: string }
type FetchStatus =
  | { state: "fetching" }
  | { state: "ok"; added: number }
  | { state: "fail"; message: string }

interface Props {
  onClose: () => void
  onChanged: () => void
}

// Overlay plein écran simple M1 (pas de shadcn Dialog avant V1.1) :
// liste des fournisseurs + CRUD inline, test connexion, gestion des modèles.
export function SettingsDialog({ onClose, onChanged }: Props) {
  const [rows, setRows] = useState<ProviderRow[]>([])
  const [models, setModels] = useState<Record<string, ModelRow[]>>({})
  const [editing, setEditing] = useState<ProviderRow | "new" | null>(null)
  const [testStatus, setTestStatus] = useState<Record<string, TestStatus>>({})
  const [newModel, setNewModel] = useState<Record<string, string>>({})
  const [fetchStatus, setFetchStatus] = useState<Record<string, FetchStatus | undefined>>({})
  const [fetchedModels, setFetchedModels] = useState<Record<string, string[]>>({})
  const [fetchOpen, setFetchOpen] = useState<string | null>(null)
  const [modelSearch, setModelSearch] = useState<Record<string, string>>({})
  // Provider pour lequel on attend la fin du refresh avant d'ouvrir le dropdown
  const [pendingFetchOpen, setPendingFetchOpen] = useState<string | null>(null)

  // Modèles combinés (BDD + fraîchement récupérés) par provider
  const combinedModels = useMemo(() => {
    const result: Record<string, Array<{ id: string; label: string; inDb: boolean; isDefault: boolean }>> = {}
    for (const p of rows) {
      const dbModels = (models[p.id] ?? []).map((m) => ({
        id: m.id, label: m.model_id, inDb: true, isDefault: m.is_default === 1,
      }))
      const fetched = (fetchedModels[p.id] ?? []).map((m) => ({
        id: `fetched-${m}`, label: m, inDb: false, isDefault: false,
      }))
      const all = [...dbModels, ...fetched]
      // Dédup par label
      const seen = new Set<string>()
      result[p.id] = all.filter((m) => !seen.has(m.label) && !seen.add(m.label))
    }
    return result
  }, [rows, models, fetchedModels])

  // Modèles filtrés par recherche
  const filteredModels = useMemo(() => {
    const result: Record<string, typeof combinedModels[string]> = {}
    for (const [pid, ms] of Object.entries(combinedModels)) {
      const search = (modelSearch[pid] ?? "").toLowerCase()
      result[pid] = ms.filter((m) => m.label.toLowerCase().includes(search))
    }
    return result
  }, [combinedModels, modelSearch])

  const refresh = useCallback(async () => {
    const list = await providers.list()
    setRows(list)
    const entries = await Promise.all(
      list.map(async (p) => [p.id, await providers.listModels(p.id)] as const),
    )
    setModels(Object.fromEntries(entries))
  }, [])

  useEffect(() => {
    void refresh().catch(console.error)
  }, [refresh])

  // Escape ferme (globale : focus pouvant être dans n'importe quel input).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose()
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [onClose])

  // Ouvre le dropdown APRÈS que le refresh a peuplé models[providerId]
  useEffect(() => {
    const pid = pendingFetchOpen
    if (pid && models[pid] && models[pid].length > 0) {
      setFetchOpen(pid)
      setPendingFetchOpen(null)
    }
  }, [pendingFetchOpen, models])

  const afterChange = useCallback(async () => {
    await refresh()
    onChanged()
  }, [refresh, onChanged])

  const test = async (p: ProviderRow) => {
    setTestStatus((s) => ({ ...s, [p.id]: { state: "testing" } }))
    try {
      const prov = createProvider({
        id: p.id, name: p.name, apiFamily: p.api_family, baseUrl: p.base_url, secretRef: secretRefFor(p.id),
      })
      const key = await secrets.get(secretRefFor(p.id))
      if (!key) {
        setTestStatus((s) => ({ ...s, [p.id]: { state: "fail", message: t.settings.noKey } }))
        return
      }
      // Signature exacte (Task 5) : { ok: boolean; error?: ApiError } — pas de latence.
      const res = await prov.testConnection(key)
        logger.debug("[SettingsDialog] testConnection result:", res)
      setTestStatus((s) => ({
        ...s,
        [p.id]: res.ok
          ? { state: "ok" }
          : { state: "fail", message: t.errors[KIND_TO_KEY[res.error!.kind]] },
      }))
    } catch (e) {
      console.error("[SettingsDialog] testConnection error:", e)
      setTestStatus((s) => ({ ...s, [p.id]: { state: "fail", message: e instanceof Error ? e.message : String(e) } }))
    }
  }

  const addModel = async (p: ProviderRow) => {
    const modelId = (newModel[p.id] ?? "").trim()
    if (!modelId) return
    await providers.addModel(p.id, modelId)
    setNewModel((s) => ({ ...s, [p.id]: "" }))
    await afterChange()
  }

  const removeProvider = async (p: ProviderRow) => {
    if (!window.confirm(t.settings.deleteConfirm)) return
    await providers.remove(p.id) // secret + cascade models via FK
    await afterChange()
  }

  // Récupération des modèles annoncés par le fournisseur (GET /models) —
  // dédoublonnage contre la base ET contre les doublons du retour API.
  const fetchModels = async (p: ProviderRow) => {
    setFetchStatus((s) => ({ ...s, [p.id]: { state: "fetching" } }))
    try {
      const key = await secrets.get(secretRefFor(p.id))
      if (!key) {
        setFetchStatus((s) => ({ ...s, [p.id]: { state: "fail", message: t.settings.noKey } }))
        return
      }
      const ids = await createProvider({
        id: p.id, name: p.name, apiFamily: p.api_family, baseUrl: p.base_url, secretRef: secretRefFor(p.id),
      }).listRemoteModels(key)
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
      // Demande l'ouverture APRÈS le prochain render où models sera peuplé
      setPendingFetchOpen(p.id)
      // Nettoie fetchedModels (plus utile, les modèles sont en base)
      setFetchedModels((s) => { const n = { ...s }; delete n[p.id]; return n })
      setFetchStatus((s) => ({ ...s, [p.id]: { state: "ok", added } }))
    } catch (e) {
      const api = e as { kind?: keyof typeof KIND_TO_KEY }
      const key = api.kind && KIND_TO_KEY[api.kind] ? KIND_TO_KEY[api.kind] : undefined
      setFetchStatus((s) => ({
        ...s,
        [p.id]: { state: "fail", message: key ? t.errors[key] : e instanceof Error ? e.message : String(e) },
      }))
    }
  }

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
        className="max-h-[85vh] w-[560px] max-w-[92vw] overflow-y-auto rounded-lg border border-border bg-background p-4"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="mb-3 flex items-center justify-between">
          <h2 className="text-base font-semibold">{t.settings.title}</h2>
          <button aria-label={t.settings.close} onClick={onClose} className="rounded-md p-1 hover:bg-foreground/5">
            <X className="size-4" />
          </button>
        </header>

        {editing !== null ? (
          <ProviderForm
            initial={editing === "new" ? undefined : editing}
            onSaved={() => {
              setEditing(null)
              void afterChange().catch(console.error)
            }}
            onCancel={() => setEditing(null)}
          />
        ) : (
          <>
            <button
              onClick={() => setEditing("new")}
              className="mb-3 flex items-center gap-2 rounded-md border border-border px-3 py-1.5 text-sm hover:bg-foreground/5"
            >
              <Plus className="size-4" /> {t.settings.addProvider}
            </button>

            {rows.length === 0 && <p className="text-sm text-muted-foreground">{t.settings.noProviders}</p>}

            <ul className="space-y-3">
              {rows.map((p) => {
                const status = testStatus[p.id] ?? { state: "idle" as const }
                const fetchSt = fetchStatus[p.id]
                return (
                  <li key={p.id} className="rounded-md border border-border p-3">
                    <div className="flex items-center justify-between gap-2">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium">{p.name}</p>
                        <p className="truncate text-xs text-muted-foreground">{p.base_url}</p>
                      </div>
                      <div className="flex flex-shrink-0 items-center gap-1">
                        <button
                          onClick={() => void test(p).catch(console.error)}
                          disabled={status.state === "testing"}
                          className="rounded-md border border-border px-2 py-1 text-xs hover:bg-foreground/5 disabled:opacity-50"
                        >
                          {status.state === "testing" ? t.settings.testing : t.settings.test}
                        </button>
                        <button
                          data-action="fetch-models"
                          onClick={() => void fetchModels(p).catch(console.error)}
                          disabled={fetchStatus[p.id]?.state === "fetching"}
                          className="rounded-md border border-border px-2 py-1 text-xs hover:bg-foreground/5 disabled:opacity-50"
                        >
                          {fetchStatus[p.id]?.state === "fetching" ? t.settings.fetchingModels : t.settings.fetchModels}
                        </button>
                        <button
                          onClick={() => setEditing(p)}
                          className="rounded-md px-2 py-1 text-xs underline hover:opacity-80"
                        >
                          {t.settings.edit}
                        </button>
                        <button
                          aria-label={t.settings.delete}
                          onClick={() => void removeProvider(p).catch(console.error)}
                          className="rounded-md p-1 hover:bg-foreground/5"
                        >
                          <Trash2 className="size-3.5" />
                        </button>
                      </div>
                    </div>

                    {status.state === "ok" && (
                      <p className="mt-2 flex items-center gap-1 text-xs text-green-600">
                        <Check className="size-3.5" /> {t.settings.ok}
                      </p>
                    )}
                    {status.state === "fail" && (
                      <p className="mt-2 text-xs text-destructive">{t.settings.fail} — {status.message}</p>
                    )}

                    {fetchSt?.state === "ok" && (
                      <p data-fetch-status className="mt-2 text-xs text-green-600">
                        {fetchSt.added} {t.settings.fetchOkAdded}
                      </p>
                    )}
                    {fetchSt?.state === "fail" && (
                      <p data-fetch-status className="mt-2 text-xs text-destructive">
                        {t.settings.fetchFail} — {fetchSt.message}
                      </p>
                    )}

                    {/* Dropdown unifié modèles (BDD + fraîchement récupérés) avec recherche */}
                    <ModelDropdown
                      models={filteredModels[p.id] ?? []}
                      search={modelSearch[p.id] ?? ""}
                      onSearchChange={(q) => setModelSearch((s) => ({ ...s, [p.id]: q }))}
                      fetchOpen={fetchOpen === p.id ? p.id : null}
                      onFetchToggle={(open) => setFetchOpen(open ? p.id : null)}
                      onAddFetched={async (label) => {
                        await providers.addModel(p.id, label)
                        await afterChange()
                      }}
                    />

                    <div className="mt-2 flex gap-1.5">
                      <input
                        value={newModel[p.id] ?? ""}
                        onChange={(e) => setNewModel((s) => ({ ...s, [p.id]: e.target.value }))}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") {
                            e.preventDefault()
                            void addModel(p).catch(console.error)
                          }
                        }}
                        aria-label={t.settings.addModel}
                        placeholder={t.settings.addModelPlaceholder}
                        className="flex-1 min-w-0 rounded-md border border-border bg-transparent px-2 py-1 text-xs outline-none"
                      />
                      <button
                        onClick={() => void addModel(p).catch(console.error)}
                        className="rounded-md border border-border px-2 py-1 text-xs hover:bg-foreground/5 flex-shrink-0"
                      >
                        <Plus className="size-3" />
                      </button>
                    </div>
                  </li>
                )
              })}
            </ul>
          </>
        )}
      </div>
    </div>
  )
}
