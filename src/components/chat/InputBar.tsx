import { useRef, useState } from "react"
import { Send, Square } from "lucide-react"
import { t } from "@/i18n/fr"

interface Props {
  disabled?: boolean
  busy?: boolean
  onSend: (text: string) => void
  onInterrupt: () => void
}

export function InputBar({ disabled = false, busy = false, onSend, onInterrupt }: Props) {
  const [text, setText] = useState("")
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  const autoGrow = () => {
    const el = textareaRef.current
    if (!el) return
    el.style.height = "auto"
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`
  }

  const submit = () => {
    const content = text.trim()
    if (!content || busy || disabled) return
    onSend(content)
    setText("")
    requestAnimationFrame(() => {
      if (textareaRef.current) textareaRef.current.style.height = "auto"
    })
  }

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    // IME en cours (saisie japonaise/coréenne…) : Enter valide la composition,
    // pas l'envoi du message.
    if (e.nativeEvent.isComposing) return
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault()
      submit()
    }
  }

  return (
    <div className="flex items-end gap-2 border-t border-border bg-background p-3">
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
        placeholder={t.chat.placeholder}
        className="max-h-40 min-h-[38px] flex-1 resize-none rounded-md border border-border bg-background px-3 py-2 text-sm outline-none focus:border-foreground/30 disabled:opacity-50"
      />
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
          disabled={disabled || !text.trim()}
          className="flex h-[38px] items-center gap-2 rounded-md bg-foreground px-3 text-sm text-background hover:opacity-90 disabled:opacity-40"
        >
          <Send className="size-4" /> {t.chat.send}
        </button>
      )}
    </div>
  )
}
