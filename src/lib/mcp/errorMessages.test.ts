import { describe, expect, it, vi } from "vitest"

const mockT = vi.hoisted(() => ({
  mcp: {
    errors: {
      not_configured: "Serveur MCP non configuré",
      invalid_config: "Configuration MCP invalide",
      auth: "Authentification refusée — remplacez l'identifiant",
      offline: "Serveur injoignable — vérifiez l'URL et la connexion",
      timeout: "Le serveur n'a pas répondu dans le délai configuré",
      rate_limit: "Limite de débit du serveur MCP atteinte",
      tool_not_found: "Outil absent du serveur MCP",
      tool_denied: "Outil MCP non autorisé",
      invalid_arguments: "Arguments de l'outil invalides",
      protocol: "Serveur incompatible avec Streamable HTTP",
      invalid_response: "Réponse MCP invalide",
      cancelled: "Appel MCP annulé",
      unknown: "Erreur MCP inattendue",
    },
  },
}))

vi.mock("@/i18n/fr", () => ({
  t: mockT,
}))

import { mcpUiError } from "@/lib/mcp/errorMessages"
import { McpClientError } from "@/lib/mcp/client"

describe("mcpUiError", () => {
  const kinds = [
    "not_configured",
    "invalid_config",
    "auth",
    "offline",
    "timeout",
    "rate_limit",
    "tool_not_found",
    "tool_denied",
    "invalid_arguments",
    "protocol",
    "invalid_response",
    "cancelled",
    "unknown",
  ] as const

  it.each(kinds)("mappe %s vers la clé i18n correspondante", (kind) => {
    const error = new McpClientError(kind, "détail technique")

    expect(mcpUiError(error)).toBe(mockT.mcp.errors[kind])
  })

  it("retourne unknown pour une erreur non-McpClientError", () => {
    expect(mcpUiError(new Error("autre"))).toBe(mockT.mcp.errors.unknown)
    expect(mcpUiError("chaîne")).toBe(mockT.mcp.errors.unknown)
    expect(mcpUiError(null)).toBe(mockT.mcp.errors.unknown)
    expect(mcpUiError(undefined)).toBe(mockT.mcp.errors.unknown)
    expect(mcpUiError({ kind: "not_configured", message: "test" })).toBe(mockT.mcp.errors.unknown)
  })

  it("ne révèle jamais le message technique brut", () => {
    const error = new McpClientError("auth", "Bearer sk-secret-123 invalide")

    const uiMessage = mcpUiError(error)

    expect(uiMessage).not.toContain("Bearer")
    expect(uiMessage).not.toContain("sk-secret-123")
    expect(uiMessage).toBe("Authentification refusée — remplacez l'identifiant")
  })
})