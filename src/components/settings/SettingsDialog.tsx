import { useCallback, useEffect, useState } from "react"
import { Check, Plus, Star, Trash2, X } from "lucide-react"
import { t } from "@/i18n/fr"
import { createProvider } from "@/lib/ai/factory"
import { KIND_TO_KEY } from "@/lib/ai/errors"
import { providers, secretRefFor, type ProviderRow, type ModelRow } from "@/lib/db/providers"
import { secrets } from "@/lib/secrets/service"
import { ProviderForm } from "./ProviderForm"

type TestStatus = { state: "idle" } | { state: "testing" } | { state: "ok" } | { state: "fail"; message: string }

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
      setTestStatus((s) => ({
        ...s,
        [p.id]: res.ok
          ? { state: "ok" }
          : { state: "fail", message: t.errors[KIND_TO_KEY[res.error!.kind]] },
      }))
    } catch (e) {
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

                    <div className="mt-2 space-y-1">
                      <p className="text-xs text-muted-foreground">{t.settings.models}</p>
                      {(models[p.id]?.length ?? 0) === 0 ? (
                        <p className="text-xs text-muted-foreground">{t.settings.noModels}</p>
                      ) : (
                        <div className="flex flex-wrap gap-1.5">
                          {(models[p.id] ?? []).map((m) => (
                            <span
                              key={m.id}
                              className="flex items-center gap-1 rounded-full border border-border px-2 py-0.5 text-xs"
                            >
                              {m.is_default === 1 && <Star className="size-3 text-amber-500" />}
                              {m.model_id}
                              <button
                                aria-label={t.settings.setDefault}
                                onClick={() => {
                                  if (m.is_default === 1) return
                                  void providers
                                    .setDefaultModel(m.id)
                                    .then(afterChange)
                                    .catch(console.error)
                                }}
                                className="hover:opacity-70"
                              >
                                <Star className={`size-3 ${m.is_default === 1 ? "fill-amber-500 text-amber-500" : ""}`} />
                              </button>
                              <button
                                aria-label={t.settings.delete}
                                onClick={() => {
                                  void providers
                                    .removeModel(m.id)
                                    .then(afterChange)
                                    .catch(console.error)
                                }}
                                className="hover:opacity-70"
                              >
                                <Trash2 className="size-3" />
                              </button>
                            </span>
                          ))}
                        </div>
                      )}
                      <div className="flex gap-1.5">
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
                          className="w-48 rounded-md border border-border bg-transparent px-2 py-1 text-xs outline-none"
                        />
                        <button
                          onClick={() => void addModel(p).catch(console.error)}
                          className="rounded-md border border-border px-2 py-1 text-xs hover:bg-foreground/5"
                        >
                          <Plus className="size-3" />
                        </button>
                      </div>
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
