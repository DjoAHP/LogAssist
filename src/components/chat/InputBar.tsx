import { useCallback, useRef, useState } from "react"
import { Send, Square, Image, X, FileText, Globe2 } from "lucide-react"
import { t } from "@/i18n/fr"
import type { Attachment, SendOptions } from "@/hooks/useChat"

interface Props {
  disabled?: boolean
  busy?: boolean
  webAvailable?: boolean
  webUnavailableReason?: string
  onSend: (text: string, attachments: Attachment[], options: SendOptions) => Promise<boolean>
  onInterrupt: () => void
}

const MAX_IMAGE_SIZE = 10 * 1024 * 1024 // 10MB
const ALLOWED_TYPES = ["image/png", "image/jpeg", "image/webp", "image/gif"]
// Contexte texte : .md/.txt uniquement (PDF demanderait une lib d'extraction)
const MAX_TEXT_SIZE = 512 * 1024
const TEXT_EXTENSIONS = [".md", ".txt"]

function isTextFile(file: File): boolean {
  return file.type === "text/markdown" || file.type === "text/plain" || (file.type === "" && TEXT_EXTENSIONS.some((ext) => file.name.toLowerCase().endsWith(ext)))
}

function fileToText(file: File): Promise<Attachment> {
  return new Promise((resolve, reject) => {
    if (!isTextFile(file)) {
      reject(new Error("Type de fichier texte non supporté"))
      return
    }
    if (file.size > MAX_TEXT_SIZE) {
      reject(new Error("Fichier texte trop volumineux (max 512KB)"))
      return
    }
    void file
      .text()
      .then((text) =>
        resolve({
          id: crypto.randomUUID(), kind: "text", base64: "", mimeType: file.type || "text/plain", name: file.name, text,
        }),
      )
      .catch(reject)
  })
}

function fileToBase64(file: File): Promise<Attachment> {
  return new Promise<Attachment>((resolve, reject) => {
    if (!ALLOWED_TYPES.includes(file.type)) {
      reject(new Error("Type de fichier non supporté"))
      return
    }
    if (file.size > MAX_IMAGE_SIZE) {
      reject(new Error("Fichier trop volumineux (max 10MB)"))
      return
    }
    const reader = new FileReader()
    reader.onload = () => {
      const base64 = (reader.result as string).split(",")[1]
      resolve({ id: crypto.randomUUID(), kind: "image", base64, mimeType: file.type, name: file.name })
    }
    reader.onerror = reject
    reader.readAsDataURL(file)
  })
}

export function InputBar({
  disabled = false,
  busy = false,
  webAvailable = false,
  webUnavailableReason = t.chat.webUnavailable,
  onSend,
  onInterrupt,
}: Props) {
  const [text, setText] = useState("")
  const [attachments, setAttachments] = useState<Attachment[]>([])
  const [forceWeb, setForceWeb] = useState(false)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const textInputRef = useRef<HTMLInputElement>(null)

  const autoGrow = () => {
    const el = textareaRef.current
    if (!el) return
    el.style.height = "auto"
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`
  }

  const handlePaste = useCallback(async (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const items = e.clipboardData.items
    const images: Attachment[] = []
    for (const item of items) {
      if (item.type.startsWith("image/")) {
        const file = item.getAsFile()
        if (file) {
          try {
            images.push(await fileToBase64(file))
          } catch {
            // silencieux : on ignore les erreurs de conversion
          }
        }
      }
    }
    if (images.length > 0) {
      e.preventDefault()
      setAttachments((prev) => [...prev, ...images])
    }
  }, [])

  const handleFileSelect = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files
    if (!files) return
    const added: Attachment[] = []
    for (const file of Array.from(files)) {
      try {
        added.push(await fileToBase64(file))
      } catch {
        // silencieux
      }
    }
    if (added.length > 0) {
      setAttachments((prev) => [...prev, ...added])
    }
    // Reset input pour permettre la sélection du même fichier
    if (fileInputRef.current) fileInputRef.current.value = ""
  }, [])

  const handleTextSelect = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files
    if (!files) return
    const added: Attachment[] = []
    for (const file of Array.from(files)) {
      try {
        added.push(await fileToText(file))
      } catch {
        // silencieux (même convention que les images)
      }
    }
    if (added.length > 0) {
      setAttachments((prev) => [...prev, ...added])
    }
    if (textInputRef.current) textInputRef.current.value = ""
  }, [])

  const removeAttachment = useCallback((id: string) => {
    setAttachments((prev) => prev.filter((a) => a.id !== id))
  }, [])

  const submit = useCallback(() => {
    const content = text.trim()
    if (!content && attachments.length === 0) return
    if (busy || disabled) return
    // Anti-perte : on sauvegarde le contenu, on vide l'input (optimiste),
    // puis on RESTAURE si l'enregistrement échoue (false ou rejet).
    const savedText = text
    const savedAttachments = attachments
    // Ne remplace pas ce que l'utilisateur a éventuellement retapé depuis.
    const restore = () => {
      setText((prev) => (prev === "" ? savedText : prev))
      setAttachments((prev) => (prev.length === 0 ? savedAttachments : prev))
    }
    // Vidage optimiste avant l'enregistrement (l'UI ne doit pas geler)
    setText("")
    setAttachments([])
    void onSend(content, attachments, { forceWeb })
      .then((ok) => {
        if (ok) setForceWeb(false)
        else restore()
      })
      .catch(restore)
      .finally(() => {
        requestAnimationFrame(() => {
          if (textareaRef.current) textareaRef.current.style.height = "auto"
        })
      })
  }, [text, attachments, busy, disabled, forceWeb, onSend])

  const onKeyDown = useCallback((e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.nativeEvent.isComposing) return
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault()
      submit()
    }
  }, [submit])

  return (
    <div className="flex items-end gap-2 border-t border-border bg-background p-3">
      <div className="flex-1 flex flex-col gap-1">
        {attachments.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {attachments.map((a) => (
              <div key={a.id} className="relative inline-flex items-center gap-1 rounded-md border border-border bg-background/50 px-2 py-1">
            {(a as Attachment).kind === "text" ? (
              <FileText className="size-3.5" />
            ) : (
              <img src={`data:${a.mimeType};base64,${a.base64}`} alt={a.name} className="size-6 rounded object-cover" />
            )}
                <span className="text-xs truncate max-w-[120px]">{a.name}</span>
                <button
                  type="button"
                  onClick={() => removeAttachment(a.id)}
                  className="rounded p-0.5 hover:bg-foreground/10"
                  aria-label="Supprimer"
                >
                  <X className="size-3" />
                </button>
              </div>
            ))}
          </div>
        )}
        <div className="flex items-end gap-2">
          <textarea
            ref={textareaRef}
            value={text}
            rows={1}
            disabled={disabled}
            onChange={(e) => {
              setText(e.target.value)
              autoGrow()
            }}
            onKeyDown={onKeyDown}
            onPaste={handlePaste}
            placeholder={t.chat.placeholder}
            className="max-h-40 min-h-[38px] flex-1 resize-none rounded-md border border-border bg-background px-3 py-2 text-sm outline-none focus:border-foreground/30 disabled:opacity-50"
          />
          <input
            ref={fileInputRef}
            type="file"
            accept="image/png,image/jpeg,image/webp,image/gif"
            multiple
            onChange={handleFileSelect}
            className="hidden"
            id="image-upload"
          />
          <label
            htmlFor="image-upload"
            className="flex h-[38px] items-center gap-1.5 rounded-md border border-border bg-background px-3 text-sm hover:bg-foreground/5 cursor-pointer"
            title={t.chat.addImage}
          >
            <Image className="size-4" />
          </label>
          <input
            ref={textInputRef}
            type="file"
            accept=".md,.txt,text/markdown,text/plain"
            multiple
            onChange={handleTextSelect}
            className="hidden"
            id="text-file-upload"
          />
          <label
            htmlFor="text-file-upload"
            className="flex h-[38px] items-center gap-1.5 rounded-md border border-border bg-background px-3 text-sm hover:bg-foreground/5 cursor-pointer"
            title={t.chat.addFile}
            aria-label={t.chat.addFile}
          >
            <FileText className="size-4" />
          </label>
          <button
            type="button"
            aria-label={t.chat.forceWeb}
            aria-pressed={forceWeb}
            title={!webAvailable ? webUnavailableReason : forceWeb ? t.chat.forceWebActive : t.chat.forceWeb}
            disabled={!webAvailable || busy || disabled}
            onClick={() => setForceWeb((active) => !active)}
            className={`flex h-[38px] items-center rounded-md border px-3 transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
              forceWeb
                ? "border-[var(--brand-to)] bg-[var(--brand-to)]/10 text-[var(--brand-to)]"
                : "border-border bg-background hover:bg-foreground/5"
            }`}
          >
            <Globe2 className="size-4" />
          </button>
          {busy ? (
            <button
              onClick={onInterrupt}
              className="flex h-[38px] items-center gap-2 rounded-md bg-foreground px-3 text-sm text-background hover:opacity-90"
            >
              <Square className="size-4" /> {t.chat.stop}
            </button>
          ) : (
            <button
              onClick={submit}
              disabled={disabled || (!text.trim() && attachments.length === 0)}
              className="flex h-[38px] items-center gap-2 rounded-md bg-foreground px-3 text-sm text-background hover:opacity-90 disabled:opacity-40"
            >
              <Send className="size-4" /> {t.chat.send}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
