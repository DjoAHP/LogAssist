import { describe, expect, it } from "vitest"
import { buildActiveToolCatalog } from "@/lib/mcp/catalog"
import { buildConnectorTools } from "@/lib/connectors/tools"

const binding = { owner: "DjoAHP", name: "LogAssist", ref: "main" }

describe("buildConnectorTools", () => {
  it("n’expose aucun outil sans liaison ou sans jeton configuré", () => {
    expect(buildConnectorTools({ binding: null, configured: true })).toEqual([])
    expect(buildConnectorTools({ binding, configured: false })).toEqual([])
  })

  it("produit les trois outils GitHub natifs en approbation automatique", () => {
    const tools = buildConnectorTools({ binding, configured: true })

    expect(tools.map((tool) => tool.llmName)).toEqual([
      "connector_github__repo_map",
      "connector_github__read_file",
      "connector_github__search_code",
    ])
    expect(tools).toHaveLength(3)
    expect(tools).toEqual(expect.arrayContaining([
      expect.objectContaining({
        serverId: "connector_github",
        nativeName: "repo_map",
        approvalMode: "auto",
        kind: "connector",
      }),
      expect.objectContaining({ nativeName: "read_file", approvalMode: "auto", kind: "connector" }),
      expect.objectContaining({ nativeName: "search_code", approvalMode: "auto", kind: "connector" }),
    ]))
  })

  it("ferme et borne chaque schéma d’entrée", () => {
    const byName = Object.fromEntries(
      buildConnectorTools({ binding, configured: true }).map((tool) => [tool.nativeName, tool.inputSchema]),
    )

    expect(byName.repo_map).toMatchObject({
      type: "object",
      additionalProperties: false,
      properties: {
        path: { type: "string", maxLength: 512 },
        depth: { type: "integer", minimum: 1, maximum: 20 },
      },
    })
    expect(byName.read_file).toMatchObject({
      type: "object",
      additionalProperties: false,
      required: ["path"],
      properties: {
        path: { type: "string", minLength: 1, maxLength: 512 },
        start_line: { type: "integer", minimum: 1, maximum: 1_000_000 },
        end_line: { type: "integer", minimum: 1, maximum: 1_000_000 },
      },
    })
    expect(byName.search_code).toMatchObject({
      type: "object",
      additionalProperties: false,
      required: ["query"],
      properties: {
        query: { type: "string", minLength: 1, maxLength: 256 },
      },
    })
  })

  it("reste sous les plafonds communs du catalogue actif", () => {
    const tools = buildConnectorTools({ binding, configured: true })
    expect(buildActiveToolCatalog(tools)).toEqual(tools)
  })
})
