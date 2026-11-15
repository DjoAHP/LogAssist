// Pont TypeScript → commandes Tauri connecteur GitHub.
// React n'appelle JAMAIS get_secret pour ce jeton.

import { invoke } from "@tauri-apps/api/core"
import type { ConnectorErrorPayload, ConnectorErrorKind } from "./errors"

export interface GithubConnectorStatus {
  configured: boolean
  login: string | null
}

export interface GithubRepoSummary {
  fullName: string
  isPrivate: boolean
  defaultBranch: string | null
  updatedAt: string | null
}

export interface GithubBinding {
  owner: string
  name: string
  ref: string | null
}

export interface CallToolArgs {
  owner: string
  name: string
  ref_: string | null
  tool: string
  args: Record<string, unknown>
  turnId: string
}

export interface CallToolResult {
  text: string
  truncated: boolean
}

export interface ListReposResult {
  repos: GithubRepoSummary[]
  page: number
  hasMore: boolean
}

export interface ConfigureResult {
  configured: boolean
  login: string
}

// Helpers d'erreur
function toError(err: unknown): ConnectorErrorPayload {
  if (err instanceof Response) {
    // Erreur HTTP (peu probable avec invoke)
    return { kind: "unknown", message: `HTTP ${err.status}` }
  }
  if (typeof err === "string") {
    return { kind: "unknown", message: err }
  }
  if (err && typeof err === "object" && "kind" in err && "message" in err) {
    return err as ConnectorErrorPayload
  }
  return { kind: "unknown", message: String(err) }
}

// Client
export const connectorGithub = {
  /** Configure le token : test GET /user, stockage si succès. */
  async configure(token: string): Promise<ConfigureResult> {
    try {
      return await invoke("connector_github_configure", { token })
    } catch (err) {
      throw toError(err)
    }
  },

  /** Statut du connecteur (sans jamais retourner le token). */
  async status(): Promise<GithubConnectorStatus> {
    try {
      return await invoke("connector_github_status", {})
    } catch (err) {
      throw toError(err)
    }
  },

  /** Supprime le token et le login. */
  async delete(): Promise<void> {
    try {
      await invoke("connector_github_delete", {})
    } catch (err) {
      throw toError(err)
    }
  },

  /** Liste les dépôts (page 1-50). */
  async listRepos(page: number): Promise<ListReposResult> {
    try {
      return await invoke("connector_github_list_repos", { page })
    } catch (err) {
      throw toError(err)
    }
  },

  /** Liste les branches d'un dépôt (max 100). */
  async listBranches(owner: string, name: string): Promise<string[]> {
    try {
      return await invoke("connector_github_list_branches", { owner, name })
    } catch (err) {
      throw toError(err)
    }
  },

  /** Appelle un outil (repo_map, read_file, search_code). */
  async callTool(
    binding: GithubBinding,
    tool: string,
    args: Record<string, unknown>,
    turnId: string
  ): Promise<CallToolResult> {
    try {
      return await invoke("connector_github_call_tool", {
        binding,
        tool,
        args,
        turnId,
      })
    } catch (err) {
      throw toError(err)
    }
  },

  /** Annule tous les appels en cours d'un tour. */
  async cancelTurn(turnId: string): Promise<void> {
    try {
      await invoke("connector_github_cancel_turn", { turnId })
    } catch (err) {
      throw toError(err)
    }
  },
}

// Mapping des kinds vers clés i18n (exhaustivité garantie par test)
export function connectorErrorKindToI18nKey(kind: ConnectorErrorKind): string {
  return `connectors.errors.${kind}`
}