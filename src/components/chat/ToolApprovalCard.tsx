import { ShieldAlert } from "lucide-react"
import { t } from "@/i18n/fr"
import type { McpToolApprovalRequest } from "@/lib/mcp/types"

const SENSITIVE_KEY = /(?:authorization|api[_-]?key|token|secret|password|credential)/i

function redactValue(value: unknown, key = "", depth = 0): unknown {
  if (SENSITIVE_KEY.test(key)) return "[masqué]"
  if (depth > 8) return "[valeur profonde masquée]"
  if (Array.isArray(value)) return value.map((item) => redactValue(item, key, depth + 1))
  if (typeof value === "object" && value !== null) {
    return Object.fromEntries(
      Object.entries(value).map(([childKey, child]) => [childKey, redactValue(child, childKey, depth + 1)]),
    )
  }
  return value
}

export function ToolApprovalCard({
  request,
  onAllow,
  onDeny,
}: {
  request: McpToolApprovalRequest
  onAllow(): void
  onDeny(): void
}) {
  return (
    <section
      aria-labelledby={`tool-approval-${request.id}`}
      className="mt-2 rounded-lg border border-brand-to/40 bg-background/70 p-3"
    >
      <div className="flex items-start gap-2">
        <ShieldAlert className="mt-0.5 size-4 shrink-0 text-brand-to" />
        <div>
          <h4 id={`tool-approval-${request.id}`} className="text-sm font-semibold">
            {t.chat.toolApprovalTitle}
          </h4>
          <p className="text-xs text-muted-foreground">
            {request.serverName} — {request.toolTitle ?? request.toolName}
          </p>
        </div>
      </div>
      <p className="mt-2 text-xs text-muted-foreground">{t.chat.toolApprovalHint}</p>
      <pre className="mt-2 max-h-40 overflow-auto rounded-md border border-border bg-background p-2 text-[11px] whitespace-pre-wrap">
        {JSON.stringify(redactValue(request.arguments), null, 2)}
      </pre>
      <div className="mt-3 flex justify-end gap-2">
        <button
          type="button"
          onClick={onDeny}
          className="rounded-md border border-border px-3 py-1.5 text-xs focus-visible:ring-2 focus-visible:ring-brand-to"
        >
          {t.chat.denyTool}
        </button>
        <button
          type="button"
          onClick={onAllow}
          className="rounded-md bg-brand-from px-3 py-1.5 text-xs text-brand-foreground focus-visible:ring-2 focus-visible:ring-brand-to"
        >
          {t.chat.allowToolOnce}
        </button>
      </div>
    </section>
  )
}