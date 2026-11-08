import { t } from "@/i18n/fr"
import { McpClientError } from "./client"

export function mcpUiError(error: unknown): string {
  return error instanceof McpClientError ? t.mcp.errors[error.kind] : t.mcp.errors.unknown
}