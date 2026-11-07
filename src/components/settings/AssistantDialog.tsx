import { useCallback, useEffect, useState } from "react"
import { Check, Pencil, Plus, Trash2, Upload, X, ChevronUp, ChevronDown } from "lucide-react"
import { t } from "@/i18n/fr"
import { logger } from "@/lib/logger"
import { loadPromptSettings, savePromptSettings } from "@/lib/prompts/store"
import { DEFAULT_GENERAL_INSTRUCTIONS, PROFILE_APPRENTISSAGE } from "@/lib/prompts/defaults"
import { knowledge, type KnowledgeRow } from "@/lib/db/knowledge"
import { conversationKnowledge } from "@/lib/db/conversationKnowledge"
import { HEADER_TOOL_DIALOG_SIZE_CLASS } from "./headerToolDialog"

interface Props {
  onClose: () => void
  conversationId: string | null
}

interface KnowledgeFormState {
  editingId: string | null
  name: string
  content: string
}

const EMPTY_FORM: KnowledgeFormState = { editingId: null, name: "", content: "" }

// Overlay plein écran, même motif que SettingsDialog (pas de shadcn avant V1.1).
// Trois sections : 1) instructions générales, 2) profil (stockées dans la table
// settings), 3) bibliothèque de connaissances .md activables (table knowledge).
// Leak-on-top : le contenu des connaissances n'est JAMAIS loggué.
export function AssistantDialog({ onClose, conversationId }: Props) {
  const [general, setGeneral] = useState("")
  const [profile, setProfile] = useState("")
  const [rows, setRows] = useState<KnowledgeRow[]>([])
  const [form, setForm] = useState<KnowledgeFormState | null>(null)
  const [saved, setSaved] = useState(false)
  const [overrideOpen, setOverrideOpen] = useState(false)
  const [overrideIds, setOverrideIds] = useState<string[]>([])

  const refreshKnowledge = useCallback(async () => {
    setRows(await knowledge.list())
  }, [])

  const loadOverrides = useCallback(async () => {
    if (conversationId) {
      const ids = await conversationKnowledge.listOn(conversationId)
      setOverrideIds(ids)
    } else {
      setOverrideIds([])
    }
  }, [conversationId])

  useEffect(() => {
    void (async () => {
      const s = await loadPromptSettings()
      setGeneral(s.general)
      setProfile(s.profile)
    })().catch(logger.error)
    void refreshKnowledge().catch(logger.error)
    void loadOverrides().catch(logger.error)
  }, [refreshKnowledge, loadOverrides])

  // Escape ferme en premier la sous-modal, sinon la principale.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (form) setForm(null)
        else onClose()
      }
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [form, onClose])

  const savePrompt = useCallback(async () => {
    await savePromptSettings({ general, profile })
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }, [general, profile])

  const restoreDefaults = useCallback(() => {
    setGeneral(DEFAULT_GENERAL_INSTRUCTIONS)
    setProfile(PROFILE_APPRENTISSAGE)
  }, [])

  const move = useCallback(
    (k: KnowledgeRow, delta: -1 | 1) => {
      void knowledge
        .move(k.id, delta)
        .then(refreshKnowledge)
        .catch(logger.error)
    },
    [refreshKnowledge],
  )

  const toggle = useCallback(
    (k: KnowledgeRow) => {
      void knowledge
        .setEnabled(k.id, k.enabled !== 1)
        .then(refreshKnowledge)
        .catch(logger.error)
    },
    [refreshKnowledge],
  )

  const remove = useCallback(
    (k: KnowledgeRow) => {
      if (!window.confirm(t.assistant.deleteConfirm)) return
      void knowledge
        .remove(k.id)
        .then(refreshKnowledge)
        .catch(logger.error)
    },
    [refreshKnowledge],
  )

  const saveOverrides = useCallback(async () => {
    if (!conversationId) return
    await conversationKnowledge.setOn(conversationId, overrideIds)
    setOverrideOpen(false)
  }, [conversationId, overrideIds])

  const openForm = (k?: KnowledgeRow) =>
    setForm(k ? { editingId: k.id, name: k.name, content: k.content } : { ...EMPTY_FORM })

  const saveKnowledge = useCallback(() => {
    if (!form) return
    const { editingId, name, content } = form
    const run = editingId
      ? knowledge.update(editingId, { ...(name.trim() ? { name } : {}), content })
      : knowledge.add(name, content)
    void run
      .then(() => {
        setForm(null)
        return refreshKnowledge()
      })
      .catch(logger.error)
  }, [form, refreshKnowledge])

  // Lecture du .md côté webview : le contenu n'est jamais envoyé ailleurs.
  const onFilePick = useCallback(async (file: File | undefined) => {
    if (!file) return
    try {
      const text = await file.text()
      setForm((s) => (s ? { ...s, content: text, name: s.name || file.name.replace(/\.md$/i, "") } : s))
    } catch (e) {
      logger.error(e)
    }
  }, [])

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
      onClick={onClose}
      data-testid="assistant-dialog"
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={t.assistant.title}
        className={`${HEADER_TOOL_DIALOG_SIZE_CLASS} overflow-y-auto rounded-lg border border-border bg-background p-4`}
        onClick={(e) => e.stopPropagation()}
      >
        <header className="mb-3 flex items-center justify-between">
          <h2 className="text-base font-semibold">{t.assistant.title}</h2>
          <button aria-label={t.assistant.close} onClick={onClose} className="rounded-md p-1 hover:bg-foreground/5">
            <X className="size-4" />
          </button>
        </header>

        <section className="mb-3">
          <label htmlFor="assistant-general" className="text-sm font-medium">
            {t.assistant.generalLabel}
          </label>
          <p className="mb-1 text-xs text-muted-foreground">{t.assistant.generalHint}</p>
          <textarea
            id="assistant-general"
           
            value={general}
            onChange={(e) => setGeneral(e.target.value)}
            rows={8}
            className="w-full rounded-md border border-border bg-transparent p-2 font-mono text-xs outline-none"
          />
        </section>

        <section className="mb-3">
          <label htmlFor="assistant-profile" className="text-sm font-medium">
            {t.assistant.profileLabel}
          </label>
          <textarea
            id="assistant-profile"
           
            value={profile}
            onChange={(e) => setProfile(e.target.value)}
            rows={4}
            className="w-full rounded-md border border-border bg-transparent p-2 font-mono text-xs outline-none"
          />
        </section>

        <div className="mb-4 flex items-center gap-2">
          <button
            onClick={() => void savePrompt().catch(logger.error)}
            className="rounded-md bg-brand-from px-3 py-1.5 text-sm text-brand-foreground hover:opacity-90"
          >
            {t.assistant.savePrompt}
          </button>
          <button
            onClick={restoreDefaults}
            className="rounded-md border border-border px-3 py-1.5 text-sm hover:bg-foreground/5"
          >
            {t.assistant.restoreDefaults}
          </button>
          {saved && (
            <span className="flex items-center gap-1 text-xs text-green-600">
              <Check className="size-3.5" /> {t.assistant.promptSaved}
            </span>
          )}
        </div>

        <section>
          <div className="mb-1 flex items-baseline justify-between">
            <h3 className="text-sm font-medium">{t.assistant.knowledgeTitle}</h3>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setOverrideOpen(true)}
                disabled={!conversationId || rows.length === 0}
                className="rounded-md border border-border px-3 py-1.5 text-sm hover:bg-foreground/5 disabled:opacity-30"
              >
                {t.assistant.perConversation}
              </button>
              <button
                onClick={() => openForm()}
                className="flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-sm hover:bg-foreground/5"
              >
                <Plus className="size-4" /> {t.assistant.addKnowledge}
              </button>
            </div>
          </div>
          <p className="mb-2 text-xs text-muted-foreground">{t.assistant.knowledgeHint}</p>

          {rows.length === 0 && <p className="text-sm text-muted-foreground">{t.assistant.noKnowledge}</p>}
          <ul className="space-y-2">
            {rows.map((k) => (
              <li key={k.id}>
                <article className="flex items-center justify-between gap-2 rounded-md border border-border p-3">
                  <label className="flex min-w-0 items-center gap-2.5">
                    <input
                      type="checkbox"
                      checked={k.enabled === 1}
                      onChange={() => toggle(k)}
                      aria-label={t.assistant.toggle}
                      className="size-4 accent-brand-from"
                    />
                    <span className="truncate text-sm font-medium">{k.name}</span>
                  </label>
                  <div className="flex flex-shrink-0 items-center gap-1">
                    <button
                      aria-label={t.assistant.moveUp}
                      onClick={() => move(k, -1)}
                      disabled={k.sort_order === 0}
                      className="rounded-md p-1 hover:bg-foreground/5 disabled:opacity-30"
                    >
                      <ChevronUp className="size-3.5" />
                    </button>
                    <button
                      aria-label={t.assistant.moveDown}
                      onClick={() => move(k, 1)}
                      className="rounded-md p-1 hover:bg-foreground/5"
                    >
                      <ChevronDown className="size-3.5" />
                    </button>
                    <button
                      aria-label={t.assistant.edit}
                      onClick={() => openForm(k)}
                      className="rounded-md p-1 hover:bg-foreground/5"
                    >
                      <Pencil className="size-3.5" />
                    </button>
                    <button
                      aria-label={t.assistant.delete}
                      onClick={() => remove(k)}
                      className="rounded-md p-1 hover:bg-foreground/5"
                    >
                      <Trash2 className="size-3.5" />
                    </button>
                  </div>
                </article>
              </li>
            ))}
          </ul>
        </section>

        {form && (
          <div
            className="fixed inset-0 z-60 flex items-center justify-center bg-black/70"
            onClick={() => setForm(null)}
          >
            <div
              role="dialog"
              aria-modal="true"
              aria-label={form.editingId ? t.assistant.formTitleEdit : t.assistant.formTitleNew}
              className="w-[480px] max-w-[92vw] rounded-lg border border-border bg-background p-4"
              onClick={(e) => e.stopPropagation()}
            >
              <header className="mb-3 flex items-center justify-between">
                <h3 className="text-sm font-semibold">
                  {form.editingId ? t.assistant.formTitleEdit : t.assistant.formTitleNew}
                </h3>
                <button aria-label={t.assistant.close} onClick={() => setForm(null)} className="rounded-md p-1 hover:bg-foreground/5">
                  <X className="size-4" />
                </button>
              </header>

              <label htmlFor="knowledge-name" className="text-sm font-medium">
                {t.assistant.nameLabel}
              </label>
              <input
                id="knowledge-name"
               
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder="HISE"
                className="mb-3 mt-1 w-full rounded-md border border-border bg-transparent px-2 py-1.5 text-sm outline-none"
              />

              <label htmlFor="knowledge-file" className="text-sm font-medium">
                {t.assistant.fileLabel}
              </label>
              <label
                htmlFor="knowledge-file"
                className="mt-1 flex cursor-pointer items-center gap-2 rounded-md border border-dashed border-border px-3 py-2 text-sm text-muted-foreground hover:bg-foreground/5"
              >
                <Upload className="size-4" /> {t.assistant.fileImport}
              </label>
              <input
                id="knowledge-file"
               
                type="file"
                accept=".md,text/markdown"
                className="sr-only"
                onChange={(e) => void onFilePick(e.target.files?.[0]).catch(logger.error)}
              />

              <label htmlFor="knowledge-content" className="mt-3 block text-sm font-medium">
                {t.assistant.contentLabel}
              </label>
              <textarea
                id="knowledge-content"
               
                value={form.content}
                onChange={(e) => setForm({ ...form, content: e.target.value })}
                rows={10}
                className="mt-1 w-full rounded-md border border-border bg-transparent p-2 font-mono text-xs outline-none"
              />

              <div className="mt-3 flex justify-end gap-2">
                <button
                  onClick={() => setForm(null)}
                  className="rounded-md border border-border px-3 py-1.5 text-sm hover:bg-foreground/5"
                >
                  {t.assistant.cancel}
                </button>
                <button
                  disabled={form.name.trim() === ""}
                  onClick={saveKnowledge}
                  className="rounded-md bg-brand-from px-3 py-1.5 text-sm text-brand-foreground hover:opacity-90 disabled:opacity-50"
                >
                  {t.assistant.saveKnowledge}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Popover : connaissances par conversation (overrides) */}
        {overrideOpen && conversationId && (
          <div
            className="fixed inset-0 z-60 flex items-center justify-center bg-black/70"
            onClick={() => setOverrideOpen(false)}
          >
            <div
              role="dialog"
              aria-modal="true"
              aria-label={t.assistant.perConversationTitle}
              className="w-[480px] max-w-[92vw] max-h-[70vh] overflow-y-auto rounded-lg border border-border bg-background p-4"
              onClick={(e) => e.stopPropagation()}
            >
              <header className="mb-3 flex items-center justify-between">
                <h3 className="text-sm font-semibold">{t.assistant.perConversationTitle}</h3>
                <button aria-label={t.assistant.close} onClick={() => setOverrideOpen(false)} className="rounded-md p-1 hover:bg-foreground/5">
                  <X className="size-4" />
                </button>
              </header>
              <p className="mb-3 text-xs text-muted-foreground">{t.assistant.perConversationHint}</p>
              {rows.length === 0 && <p className="text-sm text-muted-foreground">{t.assistant.noKnowledge}</p>}
              <ul className="space-y-2 mb-4">
                {rows.map((k) => (
                  <li key={k.id}>
                    <label className="flex items-center justify-between gap-2 rounded-md border border-border p-2">
                      <span className="truncate text-sm">{k.name}</span>
                      <input
                        type="checkbox"
                        checked={overrideIds.includes(k.id)}
                        onChange={(e) =>
                          setOverrideIds((prev) =>
                            e.target.checked ? [...prev, k.id] : prev.filter((id) => id !== k.id)
                          )
                        }
                        disabled={k.enabled !== 1}
                        className="size-4 accent-brand-from disabled:opacity-30"
                        aria-label={`${t.assistant.toggle} pour cette conversation`}
                      />
                    </label>
                  </li>
                ))}
              </ul>
              <div className="flex justify-end gap-2">
                <button
                  onClick={() => setOverrideOpen(false)}
                  className="rounded-md border border-border px-3 py-1.5 text-sm hover:bg-foreground/5"
                >
                  {t.assistant.cancel}
                </button>
                <button
                  onClick={saveOverrides}
                  className="rounded-md bg-brand-from px-3 py-1.5 text-sm text-brand-foreground hover:opacity-90"
                >
                  {t.assistant.saveOverrides}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
