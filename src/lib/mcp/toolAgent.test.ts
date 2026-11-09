import { describe, expect, it } from "vitest"

import { buildToolDefinitions, firstRoundChoice, firstRoundTools } from "@/lib/mcp/toolAgent"
import type { McpAgentTool } from "@/lib/mcp/types"

describe("buildToolDefinitions", () => {
  it("présente toujours des aliases préfixés", () => {
    const agentTool: McpAgentTool = {
      serverId: "github",
      serverName: "GitHub",
      nativeName: "search",
      llmName: "github__search",
      title: "Recherche GitHub",
      description: "Recherche des dépôts GitHub",
      inputSchema: { type: "object", properties: {} },
      approvalMode: "confirm",
      kind: "generic",
    }

    const result = buildToolDefinitions([agentTool])

    expect(result).toEqual([
      {
        type: "function",
        function: {
          name: "github__search",
          description: "Recherche GitHub. Recherche des dépôts GitHub",
          parameters: { type: "object", properties: {} },
        },
      },
    ])
  })

  it("génère une description par défaut si title et description sont absents", () => {
    const agentTool: McpAgentTool = {
      serverId: "test",
      serverName: "Test",
      nativeName: "my_tool",
      llmName: "test__my_tool",
      inputSchema: { type: "object", properties: {} },
      approvalMode: "confirm",
      kind: "generic",
    }

    const result = buildToolDefinitions([agentTool])

    expect(result[0].function.description).toBe("Outil my_tool")
  })

  it("tronque la description à 2000 caractères", () => {
    const longDescription = "a".repeat(2500)
    const agentTool: McpAgentTool = {
      serverId: "test",
      serverName: "Test",
      nativeName: "my_tool",
      llmName: "test__my_tool",
      title: "Titre",
      description: longDescription,
      inputSchema: { type: "object", properties: {} },
      approvalMode: "confirm",
      kind: "generic",
    }

    const result = buildToolDefinitions([agentTool])

    expect(result[0].function.description).toHaveLength(2000)
  })
})

describe("firstRoundTools", () => {
  const tinyfishTool: McpAgentTool = {
    serverId: "tinyfish",
    serverName: "TinyFish",
    nativeName: "search",
    llmName: "tinyfish__search",
    title: "Recherche Web",
    description: "Recherche sur le web",
    inputSchema: { type: "object", properties: {} },
    approvalMode: "confirm",
    kind: "tinyfish_web",
  }

  const genericTool: McpAgentTool = {
    serverId: "github",
    serverName: "GitHub",
    nativeName: "search",
    llmName: "github__search",
    title: "Recherche GitHub",
    description: "Recherche des dépôts",
    inputSchema: { type: "object", properties: {} },
    approvalMode: "confirm",
    kind: "generic",
  }

  it("retourne tous les outils quand intent est auto", () => {
    const tools = [tinyfishTool, genericTool]
    expect(firstRoundTools(tools, "auto")).toEqual(tools)
  })

  it("filtre seulement les outils tinyfish_web quand intent n'est pas auto", () => {
    const tools = [tinyfishTool, genericTool]
    expect(firstRoundTools(tools, "search")).toEqual([tinyfishTool])
    expect(firstRoundTools(tools, "fetch_content")).toEqual([tinyfishTool])
    expect(firstRoundTools(tools, "required")).toEqual([tinyfishTool])
  })
})

describe("firstRoundChoice", () => {
  const tinyfishSearchTool: McpAgentTool = {
    serverId: "tinyfish",
    serverName: "TinyFish",
    nativeName: "search",
    llmName: "tinyfish__search",
    title: "Recherche Web",
    description: "Recherche sur le web",
    inputSchema: { type: "object", properties: {} },
    approvalMode: "confirm",
    kind: "tinyfish_web",
  }

  const tinyfishFetchTool: McpAgentTool = {
    serverId: "tinyfish",
    serverName: "TinyFish",
    nativeName: "fetch_content",
    llmName: "tinyfish__fetch_content",
    title: "Récupération Contenu",
    description: "Récupère le contenu d'URLs",
    inputSchema: { type: "object", properties: {} },
    approvalMode: "confirm",
    kind: "tinyfish_web",
  }

  const genericTool: McpAgentTool = {
    serverId: "github",
    serverName: "GitHub",
    nativeName: "search",
    llmName: "github__search",
    title: "Recherche GitHub",
    description: "Recherche des dépôts",
    inputSchema: { type: "object", properties: {} },
    approvalMode: "confirm",
    kind: "generic",
  }

  it("retourne auto quand intent est auto", () => {
    const tools = [tinyfishSearchTool, genericTool]
    expect(firstRoundChoice(tools, "auto")).toBe("auto")
  })

  it("retourne required quand intent est required", () => {
    const tools = [tinyfishSearchTool, genericTool]
    expect(firstRoundChoice(tools, "required")).toBe("required")
  })

  it("retourne l'outil tinyfish correspondant pour search", () => {
    const tools = [tinyfishSearchTool, tinyfishFetchTool, genericTool]
    const choice = firstRoundChoice(tools, "search")
    expect(choice).toEqual({
      type: "function",
      function: { name: "tinyfish__search" },
    })
  })

  it("retourne l'outil tinyfish correspondant pour fetch_content", () => {
    const tools = [tinyfishSearchTool, tinyfishFetchTool, genericTool]
    const choice = firstRoundChoice(tools, "fetch_content")
    expect(choice).toEqual({
      type: "function",
      function: { name: "tinyfish__fetch_content" },
    })
  })

  it("retourne auto si l'outil tinyfish correspondant n'existe pas", () => {
    const tools = [genericTool]
    expect(firstRoundChoice(tools, "search")).toBe("auto")
    expect(firstRoundChoice(tools, "fetch_content")).toBe("auto")
  })
})