import { useCallback, useRef, useState } from "react"
import { Send, Square, Image, X } from "lucide-react"
import { t } from "@/i18n/fr"

interface Attachment {
  id: string
  base64: string
  mimeType: string
  name: string
}

interface Props {
  disabled?: boolean
  busy?: boolean
  onSend: (text: string, attachments: Attachment[]) => Promise<boolean>
  onInterrupt: () => void
}

const MAX_IMAGE_SIZE = 10 * 1024 * 1024 // 10MB
const ALLOWED_TYPES = ["image/png", "image/jpeg", "image/webp", "image/gif"]

function fileToBase64(file: File): Promise<Attachment> {
  return new Promise((resolve, reject) => {
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
      resolve({ id: crypto.randomUUID(), base64, mimeType: file.type, name: file.name })
    }
    reader.onerror = reject
    reader.readAsDataURL(file)
  })
}

export function InputBar({ disabled = false, busy = false, onSend, onInterrupt }: Props) {
  const [text, setText] = useState("")
  const [attachments, setAttachments] = useState<Attachment[]>([])
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

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
    const images: Attachment[] = []
    for (const file of Array.from(files)) {
      try {
        images.push(await fileToBase64(file))
      } catch {
        // silencieux
      }
    }
    if (images.length > 0) {
      setAttachments((prev) => [...prev, ...images])
    }
    // Reset input pour permettre la sélection du même fichier
    if (fileInputRef.current) fileInputRef.current.value = ""
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
    void onSend(content, attachments)
      .then((ok) => {
        if (!ok) restore()
      })
      .catch(restore)
      .finally(() => {
        requestAnimationFrame(() => {
          if (textareaRef.current) textareaRef.current.style.height = "auto"
        })
      })
  }, [text, attachments, busy, disabled, onSend])

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
                <img
                  src={`data:${a.mimeType};base64,${a.base64}`}
                  alt={a.name}
                  className="size-6 rounded object-cover"
                />
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
