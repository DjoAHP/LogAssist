import { describe, expect, it } from "vitest"

import { diffMcpImport, parseMcpImport } from "./importConfig"
import type { McpServerConfig } from "./types"

const MAX_IMPORT_BYTES = 256 * 1024
const MAX_ENDPOINT_CHARACTERS = 2_048

const validServer: Record<string, unknown> = {
  id: "github",
  name: "GitHub",
  endpoint: "https://example.com/mcp",
  transport: "streamable_http",
  auth: { type: "api_key", header: "X-API-Key" },
  timeoutMs: 60_000,
}

function server(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return { ...validServer, ...overrides }
}

function importText(
  servers: unknown[] = [server()],
  rootOverrides: Record<string, unknown> = {},
): string {
  return JSON.stringify({ version: 1, servers, ...rootOverrides })
}

function parseError(text: string): Error {
  try {
    parseMcpImport(text)
  } catch (error) {
    expect(error).toBeInstanceOf(Error)
    return error as Error
  }

  throw new Error("Le test attendait le rejet de l'import MCP")
}

function config(overrides: Partial<McpServerConfig> = {}): McpServerConfig {
  return {
    id: "github",
    name: "GitHub",
    endpoint: "https://example.com/mcp",
    transport: "streamable_http",
    auth: { type: "api_key", header: "X-API-Key" },
    timeoutMs: 60_000,
    enabled: false,
    builtin: false,
    ...overrides,
  }
}

describe("parseMcpImport", () => {
  it("normalise un document API Key valide sans importer de secret", () => {
    const parsed = parseMcpImport(
      importText([
        server({
          name: "  GitHub  ",
          endpoint: "https://EXAMPLE.com:443/mcp",
          auth: { type: "api_key", header: "  X-API-Key  " },
        }),
      ]),
    )

    expect(parsed).toEqual({
      version: 1,
      servers: [
        {
          id: "github",
          name: "GitHub",
          endpoint: "https://example.com/mcp",
          transport: "streamable_http",
          auth: { type: "api_key", header: "X-API-Key" },
          timeoutMs: 60_000,
          enabled: false,
          builtin: false,
        },
      ],
    })
  })

  it.each(["none", "bearer"] as const)("accepte l'authentification %s", (type) => {
    expect(parseMcpImport(importText([server({ auth: { type } })])).servers[0]?.auth).toEqual({
      type,
    })
  })

  it("rejette une version autre que 1", () => {
    const error = parseError(JSON.stringify({ version: 2, servers: [] }))

    expect(error.message).toMatch(/version/i)
  })

  it("rejette l'identifiant tinyfish réservé", () => {
    const error = parseError(importText([server({ id: "tinyfish" })]))

    expect(error.message).toMatch(/réservé/i)
  })

  it.each([
    {
      label: "à la racine",
      value: { version: 1, servers: [], metadata: "contenu-confidentiel" },
    },
    {
      label: "sur un serveur",
      value: { version: 1, servers: [server({ description: "contenu-confidentiel" })] },
    },
    {
      label: "dans l'authentification",
      value: {
        version: 1,
        servers: [
          server({
            auth: { type: "api_key", header: "X-API-Key", scope: "contenu-confidentiel" },
          }),
        ],
      },
    },
    {
      label: "nommée secret",
      value: { version: 1, servers: [server({ secret: "contenu-confidentiel" })] },
    },
    {
      label: "nommée token",
      value: {
        version: 1,
        servers: [server({ auth: { type: "bearer", token: "contenu-confidentiel" } })],
      },
    },
  ])("rejette toute propriété inconnue $label sans exposer sa valeur", ({ value }) => {
    const error = parseError(JSON.stringify(value))

    expect(error.message).toMatch(/propriété inconnue/i)
    expect(error.message).not.toContain("contenu-confidentiel")
  })

  it.each(["", "Github.Main", "1github", "a".repeat(49)])(
    "rejette l'identifiant invalide %j",
    (id) => {
      const error = parseError(importText([server({ id })]))

      expect(error.message).toMatch(/identifiant/i)
    },
  )

  it("rejette les identifiants dupliqués", () => {
    const error = parseError(
      importText([server(), server({ name: "GitHub secondaire", endpoint: "https://two.example/mcp" })]),
    )

    expect(error.message).toMatch(/dupliqué/i)
  })

  it.each(["   ", "a".repeat(81)])("rejette un nom vide ou supérieur à 80 caractères", (name) => {
    const error = parseError(importText([server({ name })]))

    expect(error.message).toMatch(/nom/i)
  })

  it.each([5_000.5, 4_999, 300_001, "60000"])(
    "rejette un timeout non entier ou hors bornes (%j)",
    (timeoutMs) => {
      const error = parseError(importText([server({ timeoutMs })]))

      expect(error.message).toMatch(/timeout/i)
    },
  )

  it("rejette tout transport autre que streamable_http", () => {
    const error = parseError(importText([server({ transport: "sse" })]))

    expect(error.message).toMatch(/transport/i)
  })

  it("rejette un endpoint supérieur à 2 048 caractères", () => {
    const endpoint = `https://example.com/${"a".repeat(2_048)}`
    const error = parseError(importText([server({ endpoint })]))

    expect(error.message).toMatch(/endpoint/i)
    expect(error.message).not.toContain(endpoint)
  })

  it("rejette un endpoint brut valide dont la normalisation dépasse 2 048 caractères", () => {
    const endpoint = `https://example.com/${"😀".repeat(170)}`
    const normalized = new URL(endpoint).toString()

    expect(Array.from(endpoint).length).toBeLessThanOrEqual(MAX_ENDPOINT_CHARACTERS)
    expect(Array.from(normalized).length).toBeGreaterThan(MAX_ENDPOINT_CHARACTERS)

    const error = parseError(importText([server({ endpoint })]))
    expect(error.message).toMatch(/endpoint/i)
    expect(error.message).not.toContain(endpoint)
    expect(error.message).not.toContain(normalized)
  })

  it("accepte une forme normalisée longue d'exactement 2 048 caractères", () => {
    const base = "https://example.com/"
    const endpoint = `${base}${"a".repeat(MAX_ENDPOINT_CHARACTERS - base.length)}`
    const normalized = new URL(endpoint).toString()

    expect(Array.from(normalized)).toHaveLength(MAX_ENDPOINT_CHARACTERS)
    expect(parseMcpImport(importText([server({ endpoint })])).servers[0]?.endpoint).toBe(normalized)
  })

  it("rejette un fichier supérieur à 256 Kio selon sa taille UTF-8", () => {
    const oversized = JSON.stringify({
      version: 1,
      servers: [],
      padding: "é".repeat(131_100),
    })

    expect(oversized.length).toBeLessThan(MAX_IMPORT_BYTES)
    expect(new TextEncoder().encode(oversized).byteLength).toBeGreaterThan(MAX_IMPORT_BYTES)
    expect(parseError(oversized).message).toMatch(/256 Kio/i)
  })

  it("rejette plus de 32 serveurs", () => {
    const servers = Array.from({ length: 33 }, (_, index) =>
      server({ id: `server-${index}`, name: `Serveur ${index}` }),
    )

    expect(parseError(importText(servers)).message).toMatch(/32 serveurs/i)
  })

  it.each([
    ["https://example.com/mcp", "https://example.com/mcp"],
    ["http://localhost:3000/mcp", "http://localhost:3000/mcp"],
    ["http://127.0.0.2:8080/mcp", "http://127.0.0.2:8080/mcp"],
    ["http://[::1]:9000/mcp", "http://[::1]:9000/mcp"],
  ])("accepte et normalise l'URL autorisée %s", (endpoint, normalized) => {
    expect(parseMcpImport(importText([server({ endpoint })])).servers[0]?.endpoint).toBe(normalized)
  })

  it.each(["http://127.1/mcp", "http://2130706433/mcp", "http://127.255.255.255/mcp"])(
    "accepte la forme WHATWG loopback %s",
    (endpoint) => {
      expect(parseMcpImport(importText([server({ endpoint })])).servers[0]?.endpoint).toBe(
        new URL(endpoint).toString(),
      )
    },
  )

  it.each(["http://126.255.255.255/mcp", "http://[::ffff:127.0.0.1]/mcp"])(
    "rejette la forme WHATWG non autorisée %s",
    (endpoint) => {
      const error = parseError(importText([server({ endpoint })]))

      expect(error.message).toMatch(/HTTPS|boucle locale/i)
      expect(error.message).not.toContain(endpoint)
    },
  )

  it.each([
    ["HTTP distant", "http://example.com/mcp"],
    ["userinfo", "https://user:password@example.com/mcp"],
    ["fragment", "https://example.com/mcp#configuration"],
    ["schéma file", "file:///tmp/mcp.sock"],
    ["schéma javascript", "javascript:alert('contenu-confidentiel')"],
  ])("rejette une URL interdite : %s", (_label, endpoint) => {
    const error = parseError(importText([server({ endpoint })]))

    expect(error.message).toMatch(/endpoint|URL|HTTPS|identification|fragment/i)
    expect(error.message).not.toContain(endpoint)
    expect(error.message).not.toContain("contenu-confidentiel")
  })

  it.each([
    "https://@example.com/mcp",
    "https://:@example.com/mcp",
    " https://@example.com/mcp",
    "  https://:@example.com/mcp  ",
  ])(
    "rejette un userinfo syntaxiquement présent même vide : %s",
    (endpoint) => {
      const error = parseError(importText([server({ endpoint })]))

      expect(error.message).toMatch(/endpoint|identification/i)
      expect(error.message).not.toContain(endpoint)
      expect(error.message).not.toContain(endpoint.trim())
    },
  )

  it.each([
    { label: "un espace initial", endpoint: " https://example.com/mcp" },
    { label: "un espace final", endpoint: "https://example.com/mcp " },
    { label: "une tabulation initiale", endpoint: "\thttps://example.com/mcp" },
    { label: "un retour à la ligne final", endpoint: "https://example.com/mcp\n" },
  ])("rejette $label avant toute normalisation", ({ endpoint }) => {
    const error = parseError(importText([server({ endpoint })]))

    expect(error.message).toMatch(/endpoint/i)
    expect(error.message).not.toContain(endpoint)
    expect(error.message).not.toContain(endpoint.trim())
  })

  it.each([
    {
      label: "un retour à la ligne dans le schéma",
      endpoint: "ht\ntps://@example.com/mcp",
    },
    {
      label: "un schéma sans doubles barres",
      endpoint: "https:@example.com/mcp",
    },
    {
      label: "une tabulation dans le schéma",
      endpoint: "ht\ttps://example.com/mcp",
    },
    {
      label: "un espace ASCII brut dans le chemin",
      endpoint: "https://example.com/m cp",
    },
    {
      label: "une autorité vide",
      endpoint: "https:///mcp",
    },
    {
      label: "un userinfo vide",
      endpoint: "https://@example.com/mcp",
    },
    {
      label: "un userinfo non vide",
      endpoint: "https://user:password@example.com/mcp",
    },
  ])("valide strictement la grammaire brute et rejette $label", ({ endpoint }) => {
    const error = parseError(importText([server({ endpoint })]))

    expect(error.message).toMatch(/endpoint|identification/i)
    expect(error.message).not.toContain(endpoint)
    expect(error.message).not.toContain(endpoint.trim())
  })

  it.each([
    ["un arobase dans le chemin", "https://example.com/users/@me"],
    ["un arobase dans la query", "https://example.com/mcp?tag=@safe"],
    ["un espace encodé dans le chemin", "https://example.com/users/foo%20bar"],
    ["un préfixe HTTP en majuscules", "HTTPS://EXAMPLE.COM/mcp"],
  ])("accepte %s", (_label, endpoint) => {
    expect(parseMcpImport(importText([server({ endpoint })])).servers[0]?.endpoint).toBe(
      new URL(endpoint).toString(),
    )
  })

  it("rejette une authentification invalide ou un header API Key vide", () => {
    expect(parseError(importText([server({ auth: { type: "oauth" } })])).message).toMatch(
      /authentification/i,
    )
    expect(
      parseError(importText([server({ auth: { type: "api_key", header: "   " } })])).message,
    ).toMatch(/header/i)
  })

  it("remplace les erreurs JSON natives par une erreur française sans fuite", () => {
    const error = parseError('{"version":1,"servers":[],"token":"contenu-confidentiel"')

    expect(error.message).toMatch(/JSON|document/i)
    expect(error.message).not.toContain("contenu-confidentiel")
  })
})

describe("diffMcpImport", () => {
  it("classe un identifiant absent comme une création", () => {
    const incoming = config({ id: "gitlab", name: "GitLab" })

    expect(diffMcpImport([incoming], [config()])).toEqual([
      { kind: "create", incoming, sensitive: false },
    ])
  })

  it("classe des configurations identiques comme inchangées", () => {
    const incoming = config()
    const current = config({ enabled: true })

    expect(diffMcpImport([incoming], [current])).toEqual([
      { kind: "unchanged", incoming, current, sensitive: false },
    ])
  })

  it.each([
    ["endpoint", config({ endpoint: "https://new.example/mcp" })],
    ["mode d'authentification", config({ auth: { type: "bearer" } })],
    ["header API Key", config({ auth: { type: "api_key", header: "Authorization" } })],
  ])("classe un changement réel de %s comme sensible", (_label, incoming) => {
    expect(diffMcpImport([incoming], [config()])[0]).toMatchObject({
      kind: "update",
      sensitive: true,
    })
  })

  it("ignore uniquement la casse du header API Key", () => {
    const incoming = config({ auth: { type: "api_key", header: "x-api-key" } })
    const current = config()

    expect(diffMcpImport([incoming], [current])).toEqual([
      { kind: "unchanged", incoming, current, sensitive: false },
    ])
  })

  it.each([
    ["nom", config({ name: "GitHub MCP" })],
    ["timeout", config({ timeoutMs: 90_000 })],
  ])("classe un changement de %s comme non sensible", (_label, incoming) => {
    expect(diffMcpImport([incoming], [config()])[0]).toMatchObject({
      kind: "update",
      sensitive: false,
    })
  })

  it("compare la forme normalisée des endpoints", () => {
    const incoming = config({ endpoint: "https://example.com/mcp" })
    const current = config({ endpoint: "https://EXAMPLE.com:443/mcp" })

    expect(diffMcpImport([incoming], [current])).toEqual([
      { kind: "unchanged", incoming, current, sensitive: false },
    ])
  })

  it("ne mute aucune configuration reçue", () => {
    const incoming: readonly McpServerConfig[] = [
      config({ name: "GitHub importé", timeoutMs: 90_000 }),
    ]
    const existing: readonly McpServerConfig[] = [config()]
    const incomingBefore = structuredClone(incoming)
    const existingBefore = structuredClone(existing)

    const result = diffMcpImport(incoming, existing)

    expect(incoming).toEqual(incomingBefore)
    expect(existing).toEqual(existingBefore)
    expect(result[0]?.incoming).toBe(incoming[0])
    expect(result[0]?.kind === "update" && result[0].current).toBe(existing[0])
  })
})
