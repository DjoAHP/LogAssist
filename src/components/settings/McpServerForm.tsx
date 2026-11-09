import { useState } from "react"
import { t } from "@/i18n/fr"
import { mcpUiError } from "@/lib/mcp/errorMessages"
import type { McpAuthStatus, McpServerConfig } from "@/lib/mcp/types"

interface Props {
  initial: McpServerConfig
  authStatus: McpAuthStatus
  onSave(server: McpServerConfig): Promise<void>
  onConfigureSecret(server: McpServerConfig, secret: string): Promise<void>
  onDeleteSecret(serverId: string): Promise<void>
  onCancel(): void
}

export function McpServerForm({
  initial,
  authStatus,
  onSave,
  onConfigureSecret,
  onDeleteSecret,
  onCancel,
}: Props) {
  const [server, setServer] = useState(initial)
  const [secret, setSecret] = useState("")
  const [error, setError] = useState<string>()
  const [busy, setBusy] = useState(false)

  const updateAuth = (type: McpServerConfig["auth"]["type"]) =>
    setServer((current) => ({
      ...current,
      auth: type === "api_key" ? { type, header: "X-API-Key" } : { type },
    }))

  const run = async (action: () => Promise<void>) => {
    setBusy(true)
    setError(undefined)
    try {
      await action()
    } catch (cause) {
      setError(mcpUiError(cause))
    } finally {
      setBusy(false)
    }
  }

  return (
    <form className="space-y-3" onSubmit={(event) => { event.preventDefault(); void run(() => onSave(server)) }}>
      <label className="block text-xs">
        {t.mcp.serverName}
        <input
          aria-label={t.mcp.serverName}
          disabled={server.builtin}
          value={server.name}
          onChange={(event) => setServer({ ...server, name: event.target.value })}
          className="mt-1 w-full rounded-md border border-border bg-background px-2 py-1.5 disabled:opacity-60"
        />
      </label>
      <label className="block text-xs">
        {t.mcp.endpoint}
        <input
          aria-label={t.mcp.endpoint}
          aria-describedby="endpoint-hint"
          disabled={server.builtin}
          value={server.endpoint}
          onChange={(event) => setServer({ ...server, endpoint: event.target.value })}
          className="mt-1 w-full rounded-md border border-border bg-background px-2 py-1.5 disabled:opacity-60"
        />
        <span id="endpoint-hint" className="mt-1 block text-[10px] text-muted-foreground">{t.mcp.endpointStoredHint}</span>
      </label>
      <label className="block text-xs">
        {t.mcp.authentication}
        <select
          aria-label={t.mcp.authentication}
          disabled={server.builtin}
          value={server.auth.type}
          onChange={(event) => updateAuth(event.target.value as McpServerConfig["auth"]["type"])}
          className="mt-1 w-full rounded-md border border-border bg-background px-2 py-1.5"
        >
          <option value="none">{t.mcp.authNone}</option>
          <option value="bearer">{t.mcp.authBearer}</option>
          <option value="api_key">{t.mcp.authApiKey}</option>
        </select>
      </label>
      {server.auth.type === "api_key" && (
        <label className="block text-xs">
          {t.mcp.headerName}
          <input
            aria-label={t.mcp.headerName}
            value={server.auth.header}
            onChange={(event) => setServer({ ...server, auth: { type: "api_key", header: event.target.value } })}
            className="mt-1 w-full rounded-md border border-border bg-background px-2 py-1.5"
          />
        </label>
      )}
      <label className="block text-xs">
        {t.mcp.timeout}
        <input
          aria-label={t.mcp.timeout}
          type="number"
          min={5000}
          max={300000}
          disabled={server.builtin}
          value={server.timeoutMs}
          onChange={(event) => setServer({ ...server, timeoutMs: Number(event.target.value) })}
          className="mt-1 w-full rounded-md border border-border bg-background px-2 py-1.5 disabled:opacity-60"
        />
      </label>
      {server.auth.type !== "none" && (
        <fieldset className="rounded-md border border-border p-3">
          <legend className="px-1 text-xs">{t.mcp.authentication}</legend>
          {authStatus === "configured" && <p className="text-xs text-muted-foreground">{t.mcp.storedCredential}</p>}
          <label className="mt-2 block text-xs">
            {t.mcp.newSecret}
            <input
              aria-label={t.mcp.newSecret}
              type="password"
              autoComplete="new-password"
              value={secret}
              onChange={(event) => setSecret(event.target.value)}
              className="mt-1 w-full rounded-md border border-border bg-background px-2 py-1.5"
            />
          </label>
          <div className="mt-2 flex gap-2">
            <button
              type="button"
              disabled={!secret.trim() || busy}
              onClick={() => void run(async () => { await onConfigureSecret(server, secret); setSecret("") })}
              className="rounded-md bg-brand-from px-3 py-1.5 text-xs text-brand-foreground disabled:opacity-50"
            >
              {t.mcp.testAndSave}
            </button>
            {authStatus !== "missing" && (
              <button
                type="button"
                onClick={() => void run(() => onDeleteSecret(server.id))}
                className="rounded-md border border-destructive/50 px-3 py-1.5 text-xs text-destructive"
              >
                {t.mcp.deleteCredential}
              </button>
            )}
          </div>
        </fieldset>
      )}
      {error && <p role="alert" className="text-xs text-destructive">{error}</p>}
      <footer className="flex justify-end gap-2">
        <button type="button" onClick={onCancel} className="rounded-md border border-border px-3 py-1.5 text-sm">
          {t.mcp.cancel}
        </button>
        <button type="submit" disabled={busy} className="rounded-md bg-brand-from px-3 py-1.5 text-sm text-brand-foreground disabled:opacity-50">
          {t.mcp.saveMetadata}
        </button>
      </footer>
    </form>
  )
}