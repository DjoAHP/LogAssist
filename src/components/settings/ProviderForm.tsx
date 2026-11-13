import { useState } from "react"
import { t } from "@/i18n/fr"
import { redactSensitiveDetail } from "@/lib/ai/errors"
import { isLocalBaseUrl } from "@/lib/ai/local"
import { cleanApiBaseUrl } from "@/lib/ai/url"
import { providers, type ProviderRow } from "@/lib/db/providers"
import { logger } from "@/lib/logger"

interface Props {
  initial?: ProviderRow
  onSaved: (row: ProviderRow) => void
  onCancel: () => void
}

// Formulaire d'un fournisseur (création ou édition inline dans ProvidersDialog).
// La clé API ne vit jamais en base : transmise à providers.create/update qui
// la délègue au Credential Manager via secretRefFor(id).
export function ProviderForm({ initial, onSaved, onCancel }: Props) {
  const editing = initial !== undefined
  const [name, setName] = useState(initial?.name ?? "")
  const [family, setFamily] = useState<"openai" | "gemini">(initial?.api_family ?? "openai")
  const [baseUrl, setBaseUrl] = useState(initial?.base_url ?? "")
  const [secret, setSecret] = useState("")
  const [replaceKey, setReplaceKey] = useState(!editing)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const submit = async () => {
    if (!name.trim()) { setError(t.providers.nameRequired); return }
    // Nettoyage unique : helper partagé avec l'adaptateur (le /v1 est préservé).
    const cleanedBaseUrl = cleanApiBaseUrl(baseUrl.trim())
    // Invariant sécurité : https distant OU boucle locale (LM Studio/Ollama).
    // Un http:// externe reste refusé — la boucle locale est la seule exception.
    if (!cleanedBaseUrl.startsWith("https://") && !isLocalBaseUrl(cleanedBaseUrl)) {
      setError(t.providers.invalidUrl)
      return
    }
    setSaving(true)
    setError(null)
    try {
      const row = editing
        ? await updateExisting(initial, name.trim(), family, cleanedBaseUrl, replaceKey ? secret : undefined)
        : await providers.create(name.trim(), family, cleanedBaseUrl, secret || undefined)
      onSaved(row)
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e)
      setError(t.providers.saveFailed)
      logger.error({
        context: "ProviderForm.save",
        message: redactSensitiveDetail(message, [secret]),
      })
    } finally {
      setSaving(false)
    }
  }

  return (
    <form
      className="space-y-3"
      onSubmit={(e) => {
        e.preventDefault()
        void submit()
      }}
    >
      <p className="text-sm font-semibold">{editing ? t.providers.editProvider : t.providers.addProvider}</p>
      <label className="block space-y-1">
        <span className="text-xs text-muted-foreground">{t.providers.name}</span>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="w-full rounded-md border border-border bg-transparent px-2 py-1.5 text-sm outline-none"
        />
      </label>
      <label className="block space-y-1">
        <span className="text-xs text-muted-foreground">{t.providers.family}</span>
        <select
          value={family}
          onChange={(e) => setFamily(e.target.value === "gemini" ? "gemini" : "openai")}
          className="w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm outline-none"
        >
          <option value="openai">openai-compatible</option>
          <option value="gemini" disabled>gemini (V2)</option>
        </select>
      </label>
      <label className="block space-y-1">
        <span className="text-xs text-muted-foreground">{t.providers.baseUrl}</span>
        <input
          value={baseUrl}
          onChange={(e) => setBaseUrl(e.target.value)}
          placeholder="https://openrouter.ai/api/v1 (sans /models ni /chat/completions)"
          className="w-full rounded-md border border-border bg-transparent px-2 py-1.5 text-sm outline-none"
        />
      </label>
      <div className="space-y-1">
        <div className="flex items-center justify-between">
          <span className="text-xs text-muted-foreground">{t.providers.apiKey}</span>
          {editing && !replaceKey && (
            <button type="button" className="text-xs underline hover:opacity-80" onClick={() => setReplaceKey(true)}>
              {t.providers.replaceKey}
            </button>
          )}
        </div>
        {!replaceKey ? (
          <p className="text-xs text-muted-foreground">{t.providers.apiKeyStored}</p>
        ) : (
          <input
            type="password"
            value={secret}
            onChange={(e) => setSecret(e.target.value)}
            className="w-full rounded-md border border-border bg-transparent px-2 py-1.5 text-sm outline-none"
          />
        )}
      </div>
      {error && <p className="text-xs text-destructive">{error}</p>}
      <div className="flex justify-end gap-2">
        <button
          type="button"
          onClick={onCancel}
          className="rounded-md border border-border px-3 py-1.5 text-sm hover:bg-foreground/5"
        >
          {t.providers.cancel}
        </button>
        <button
          type="submit"
          disabled={saving}
          className="rounded-md border border-border bg-foreground/10 px-3 py-1.5 text-sm hover:bg-foreground/20 disabled:opacity-50"
        >
          {t.providers.save}
        </button>
      </div>
    </form>
  )
}

async function updateExisting(
  initial: ProviderRow,
  name: string,
  family: "openai" | "gemini",
  baseUrl: string,
  secret: string | undefined,
): Promise<ProviderRow> {
  await providers.update(initial.id, { name, apiFamily: family, baseUrl }, secret)
  // Providers.update ne renvoie pas de row : on reconstruit la row mise à jour.
  return { ...initial, name, api_family: family, base_url: baseUrl }
}
