import type { McpAuthConfig, McpServerConfig } from "./types"

const MAX_IMPORT_BYTES = 256 * 1024
const MAX_IMPORT_SERVERS = 32
const MAX_SERVER_NAME_CHARACTERS = 80
const MAX_ENDPOINT_CHARACTERS = 2_048
const MIN_TIMEOUT_MS = 5_000
const MAX_TIMEOUT_MS = 300_000
const SERVER_ID = /^[a-z][a-z0-9_-]{0,47}$/
const RAW_ENDPOINT_CONTROL = /[\u0000-\u0020\u007f]/
const RAW_HTTP_PREFIX = /^https?:\/\//i

function record(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${label} doit être un objet`)
  }

  return value as Record<string, unknown>
}

function exactKeys(
  value: Record<string, unknown>,
  allowed: readonly string[],
  label: string,
): void {
  if (Object.keys(value).some((key) => !allowed.includes(key))) {
    throw new Error(`${label} contient une propriété inconnue`)
  }
}

function parseAuth(value: unknown): McpAuthConfig {
  const auth = record(value, "L'authentification MCP")

  if (auth.type === "none" || auth.type === "bearer") {
    exactKeys(auth, ["type"], "L'authentification MCP")
    return { type: auth.type }
  }

  if (auth.type === "api_key") {
    exactKeys(auth, ["type", "header"], "L'authentification MCP")
    if (typeof auth.header !== "string" || auth.header.trim() === "") {
      throw new Error("Le header API Key est obligatoire")
    }

    return { type: "api_key", header: auth.header.trim() }
  }

  throw new Error("Le mode d'authentification MCP est invalide")
}

function characterCount(value: string): number {
  return Array.from(value).length
}

function isLoopbackHost(hostname: string): boolean {
  const normalized = hostname.toLowerCase()
  if (normalized === "localhost" || normalized === "::1" || normalized === "[::1]") {
    return true
  }

  const octets = normalized.split(".")
  return (
    octets.length === 4 &&
    octets[0] === "127" &&
    octets.every((octet) => /^\d{1,3}$/.test(octet) && Number(octet) <= 255)
  )
}

function parseEndpoint(value: unknown): string {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    characterCount(value) > MAX_ENDPOINT_CHARACTERS
  ) {
    throw new Error("L'endpoint MCP est invalide")
  }
  const rawEndpoint = value
  if (RAW_ENDPOINT_CONTROL.test(rawEndpoint)) {
    throw new Error("L'endpoint MCP est invalide")
  }

  const prefix = RAW_HTTP_PREFIX.exec(rawEndpoint)
  if (!prefix) {
    throw new Error("L'endpoint MCP est invalide")
  }
  const authorityStart = prefix[0].length
  const afterPrefix = rawEndpoint.slice(authorityStart)
  const authorityEnd = afterPrefix.search(/[/?#]/)
  const authority = authorityEnd === -1 ? afterPrefix : afterPrefix.slice(0, authorityEnd)
  if (authority === "") {
    throw new Error("L'endpoint MCP est invalide")
  }
  if (authority.includes("@")) {
    throw new Error("L'endpoint MCP ne doit pas contenir d'informations d'identification")
  }

  let endpoint: URL
  try {
    endpoint = new URL(rawEndpoint)
  } catch {
    throw new Error("L'endpoint MCP est invalide")
  }

  if (endpoint.username !== "" || endpoint.password !== "") {
    throw new Error("L'endpoint MCP ne doit pas contenir d'informations d'identification")
  }
  if (rawEndpoint.includes("#")) {
    throw new Error("L'endpoint MCP ne doit pas contenir de fragment")
  }

  const isHttps = endpoint.protocol === "https:"
  const isLocalHttp = endpoint.protocol === "http:" && isLoopbackHost(endpoint.hostname)
  if (!isHttps && !isLocalHttp) {
    throw new Error("Un MCP distant exige HTTPS ; HTTP est limité à la boucle locale")
  }

  const normalized = endpoint.toString()
  if (characterCount(normalized) > MAX_ENDPOINT_CHARACTERS) {
    throw new Error("L'endpoint MCP est invalide")
  }

  return normalized
}

function parseServer(value: unknown): McpServerConfig {
  const server = record(value, "Le serveur MCP")
  exactKeys(
    server,
    ["id", "name", "endpoint", "transport", "auth", "timeoutMs"],
    "Le serveur MCP",
  )

  if (typeof server.id !== "string" || !SERVER_ID.test(server.id)) {
    throw new Error("L'identifiant MCP est invalide")
  }
  if (server.id === "tinyfish") {
    throw new Error("L'identifiant tinyfish est réservé")
  }

  if (typeof server.name !== "string") {
    throw new Error("Le nom MCP est invalide")
  }
  const name = server.name.trim()
  if (characterCount(name) < 1 || characterCount(name) > MAX_SERVER_NAME_CHARACTERS) {
    throw new Error("Le nom MCP est invalide")
  }

  if (server.transport !== "streamable_http") {
    throw new Error("Le transport MCP est invalide")
  }
  if (
    typeof server.timeoutMs !== "number" ||
    !Number.isInteger(server.timeoutMs) ||
    server.timeoutMs < MIN_TIMEOUT_MS ||
    server.timeoutMs > MAX_TIMEOUT_MS
  ) {
    throw new Error("Le timeout MCP est invalide")
  }

  return {
    id: server.id,
    name,
    endpoint: parseEndpoint(server.endpoint),
    transport: "streamable_http",
    auth: parseAuth(server.auth),
    timeoutMs: server.timeoutMs,
    enabled: false,
    builtin: false,
  }
}

export function parseMcpImport(text: string): { version: 1; servers: McpServerConfig[] } {
  if (new TextEncoder().encode(text).byteLength > MAX_IMPORT_BYTES) {
    throw new Error("Le fichier d'import MCP dépasse 256 Kio")
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(text) as unknown
  } catch {
    throw new Error("Le document JSON MCP est invalide")
  }

  const root = record(parsed, "Le document MCP")
  exactKeys(root, ["version", "servers"], "Le document MCP")
  if (root.version !== 1) {
    throw new Error("La version de configuration MCP est invalide")
  }
  if (!Array.isArray(root.servers)) {
    throw new Error("La liste des serveurs MCP est invalide")
  }
  if (root.servers.length > MAX_IMPORT_SERVERS) {
    throw new Error("Un import MCP ne peut pas contenir plus de 32 serveurs")
  }

  const servers = root.servers.map(parseServer)
  if (new Set(servers.map((server) => server.id)).size !== servers.length) {
    throw new Error("Un identifiant MCP est dupliqué")
  }

  return { version: 1, servers }
}

export type McpImportDiff =
  | { kind: "create"; incoming: McpServerConfig; sensitive: false }
  | {
      kind: "unchanged"
      incoming: McpServerConfig
      current: McpServerConfig
      sensitive: false
    }
  | {
      kind: "update"
      incoming: McpServerConfig
      current: McpServerConfig
      sensitive: boolean
    }

function authKey(auth: McpAuthConfig): string {
  return auth.type === "api_key" ? `${auth.type}:${auth.header.toLowerCase()}` : auth.type
}

function endpointKey(endpoint: string): string {
  try {
    return new URL(endpoint).toString()
  } catch {
    return endpoint
  }
}

export function diffMcpImport(
  incoming: readonly McpServerConfig[],
  existing: readonly McpServerConfig[],
): McpImportDiff[] {
  const byId = new Map(existing.map((server) => [server.id, server]))

  return incoming.map<McpImportDiff>((server) => {
    const current = byId.get(server.id)
    if (!current) {
      return { kind: "create", incoming: server, sensitive: false }
    }

    const endpointChanged = endpointKey(current.endpoint) !== endpointKey(server.endpoint)
    const authChanged = authKey(current.auth) !== authKey(server.auth)
    const sensitive = endpointChanged || authChanged
    const unchanged =
      current.name === server.name &&
      !endpointChanged &&
      current.timeoutMs === server.timeoutMs &&
      !authChanged

    return unchanged
      ? { kind: "unchanged", incoming: server, current, sensitive: false }
      : { kind: "update", incoming: server, current, sensitive }
  })
}
