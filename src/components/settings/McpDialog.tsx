import { useEffect, useState } from "react"
import { Search, FileText, X } from "lucide-react"

import { t } from "@/i18n/fr"
import { tinyfish } from "@/lib/mcp/client"
import { loadWebAccess, setWebEnabled } from "@/lib/mcp/settings"
import { HEADER_TOOL_DIALOG_SIZE_CLASS } from "./headerToolDialog"

interface Props {
  onClose: () => void
  onChanged: () => void
}

const CONNECTIONS = [{ id: "tinyfish", name: t.mcp.tinyfish }] as const

export function McpDialog({ onClose, onChanged }: Props) {
  const [configured, setConfigured] = useState(false)
  const [enabled, setEnabled] = useState(false)
  const [key, setKey] = useState("")
  const [testing, setTesting] = useState(false)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    void loadWebAccess().then((config) => {
      setConfigured(config.configured)
      setEnabled(config.enabled)
    })
  }, [])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose()
    }
    document.addEventListener("keydown", onKeyDown)
    return () => document.removeEventListener("keydown", onKeyDown)
  }, [onClose])

  const saveKey = async () => {
    if (!key.trim() || testing) return
    setTesting(true)
    setFailed(false)
    try {
      await tinyfish.configure(key.trim())
      setConfigured(true)
      setKey("")
      onChanged()
    } catch {
      setFailed(true)
    } finally {
      setTesting(false)
    }
  }

  const toggleWeb = async (next: boolean) => {
    if (next && !configured) return
    await setWebEnabled(next)
    setEnabled(next)
    onChanged()
  }

  const deleteKey = async () => {
    if (!window.confirm(t.mcp.deleteConfirm)) return
    await tinyfish.removeSecret()
    await setWebEnabled(false)
    setConfigured(false)
    setEnabled(false)
    setKey("")
    onChanged()
  }

  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-black/55 p-4"
      role="presentation"
      onClick={onClose}
    >
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="mcp-title"
        className={`${HEADER_TOOL_DIALOG_SIZE_CLASS} flex flex-col overflow-hidden rounded-lg border border-border bg-background shadow-2xl`}
        onClick={(event) => event.stopPropagation()}
      >
        <header className="flex items-start justify-between border-b border-border px-5 py-4">
          <div>
            <h2 id="mcp-title" className="text-base font-semibold">{t.mcp.title}</h2>
            <p className="mt-1 text-sm text-muted-foreground">{t.mcp.description}</p>
          </div>
          <button aria-label={t.mcp.close} onClick={onClose} className="rounded-md p-1.5 hover:bg-foreground/5"><X className="size-4" /></button>
        </header>

        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-5">
          {CONNECTIONS.map((connection) => (
            <article key={connection.id} className="rounded-lg border border-border bg-foreground/[0.025] p-4">
              <div className="flex items-center justify-between">
                <h3 className="font-medium">{connection.name}</h3>
                <span className={`text-xs font-medium ${configured ? "text-[var(--brand-to)]" : "text-muted-foreground"}`}>
                  {failed ? t.mcp.connectionFailed : configured ? t.mcp.connected : t.mcp.notConfigured}
                </span>
              </div>
              <div className="mt-3 flex gap-3 text-xs text-muted-foreground">
                <span className="inline-flex items-center gap-1"><Search className="size-3.5" />search</span>
                <span className="inline-flex items-center gap-1"><FileText className="size-3.5" />fetch_content</span>
              </div>
              <p className="mt-2 text-xs text-muted-foreground">{t.mcp.allowedTools}</p>

              <label className="mt-4 block text-sm font-medium" htmlFor="tinyfish-key">{t.mcp.apiKey}</label>
              <div className="mt-1.5 flex gap-2">
                <input id="tinyfish-key" type="password" value={key} onChange={(event) => setKey(event.target.value)} placeholder={t.mcp.apiKeyPlaceholder} autoComplete="off" className="min-w-0 flex-1 rounded-md border border-border bg-background px-3 py-2 text-sm outline-none focus:border-foreground/30" />
                <button onClick={() => void saveKey()} disabled={!key.trim() || testing} className="rounded-md bg-foreground px-3 py-2 text-sm text-background disabled:opacity-50">
                  {testing ? t.mcp.testing : t.mcp.testAndSave}
                </button>
              </div>

              <div className="mt-4 flex items-center justify-between border-t border-border pt-4">
                <label className="flex items-center gap-2 text-sm">
                  <input type="checkbox" checked={enabled} disabled={!configured} onChange={(event) => void toggleWeb(event.target.checked)} />
                  {t.mcp.webEnabled}
                </label>
                {configured && <button onClick={() => void deleteKey()} className="text-xs text-red-500 hover:underline">{t.mcp.deleteKey}</button>}
              </div>
            </article>
          ))}
        </div>
      </section>
    </div>
  )
}
