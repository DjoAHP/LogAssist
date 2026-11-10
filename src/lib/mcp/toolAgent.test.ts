import { describe, expect, it, vi } from "vitest"

import { buildToolDefinitions, firstRoundChoice, firstRoundTools, runToolAgent } from "@/lib/mcp/toolAgent"
import type { McpAgentTool, McpToolResult, WebSource } from "@/lib/mcp/types"
import type { IProvider } from "@/lib/ai/openai-compat"
import type { TokenUsage, TurnResult, ToolCall, ChatRequest, TurnCallbacks } from "@/lib/ai/types"
import { ApiError } from "@/lib/ai/errors"

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

// Helpers pour les tests de runToolAgent
function turn(text: string, toolCalls: ToolCall[] = [], usage?: TokenUsage): TurnResult {
  return { text, toolCalls, firstTokenMs: 5, totalMs: 20, ...(usage ? { usage } : {}) }
}

function call(id: string, name: string, arguments_: Record<string, unknown>): ToolCall {
  return { id, name, arguments: arguments_ }
}

function genericTool(
  serverId: string,
  nativeName: string,
  llmName: string,
  approvalMode: "confirm" | "auto" = "confirm",
): McpAgentTool {
  return {
    serverId,
    serverName: serverId,
    nativeName,
    llmName,
    title: `${serverId} ${nativeName}`,
    description: `Outil ${nativeName}`,
    inputSchema: { type: "object", properties: {} },
    approvalMode,
    kind: "generic",
  }
}

function tinyfishTool(nativeName: "search" | "fetch_content"): McpAgentTool {
  return {
    serverId: "tinyfish",
    serverName: "TinyFish",
    nativeName,
    llmName: `tinyfish__${nativeName}`,
    title: nativeName === "search" ? "Recherche Web" : "Récupération Contenu",
    description: nativeName === "search" ? "Recherche sur le web" : "Récupère le contenu d'URLs",
    inputSchema: { type: "object", properties: {} },
    approvalMode: "confirm",
    kind: "tinyfish_web",
  }
}

function result(content: string, sources: WebSource[] = [], structuredContent?: unknown, isError = false): McpToolResult {
  return {
    content,
    structuredContent,
    media: [],
    resourceLinks: [],
    sources,
    isError,
  }
}

function createHarness(options: {
  tools: McpAgentTool[]
  turns: Array<TurnResult | Error>
  webIntent?: "auto" | "required" | "search" | "fetch_content"
}) {
  const runTurn = vi.fn()
  for (const item of options.turns) {
    if (item instanceof Error) runTurn.mockRejectedValueOnce(item)
    else runTurn.mockResolvedValueOnce(item)
  }
  const callTool = vi.fn()
  const approve = vi.fn().mockResolvedValue("allow")
  const input = {
    provider: { runTurn } as unknown as IProvider,
    toolClient: { call: callTool },
    tools: options.tools,
    webIntent: options.webIntent ?? "auto",
    request: { messages: [{ role: "user", content: "Question" }] } as ChatRequest,
    apiKey: "LLM-KEY",
    modelId: "model",
    callbacks: {} as TurnCallbacks,
    signal: new AbortController().signal,
    turnId: "turn-1",
    compatibilityKey: "provider/model",
    unsupportedTools: new Set<string>(),
    approve,
    onWebStatus: vi.fn(),
  }
  return { input, runTurn, callTool, approve, onWebStatus: input.onWebStatus }
}

describe("runToolAgent", () => {
  it("route deux outils homonymes par alias sans ambiguïté", async () => {
    const harness = createHarness({
      tools: [genericTool("github", "search", "github__search"), genericTool("docs", "search", "docs__search")],
      turns: [turn("", [call("c1", "docs__search", { q: "MCP" })]), turn("Réponse")],
    })
    harness.callTool.mockResolvedValue(result("docs"))
    await runToolAgent(harness.input)
    expect(harness.callTool).toHaveBeenCalledWith("docs", "turn-1", "c1", "search", { q: "MCP" })
  })

  it("attend l'autorisation ponctuelle avant un outil confirm", async () => {
    const harness = createHarness({
      tools: [genericTool("db", "delete", "db__delete", "confirm")],
      turns: [turn("", [call("c1", "db__delete", { id: 7 })]), turn("Fait")],
    })
    harness.approve.mockResolvedValue("allow")
    harness.callTool.mockResolvedValue(result("deleted"))
    await runToolAgent(harness.input)
    expect(harness.approve).toHaveBeenCalledWith(expect.objectContaining({ serverId: "db", toolName: "delete", arguments: { id: 7 } }))
    expect(harness.callTool).toHaveBeenCalledTimes(1)
  })

  it("transforme un refus en résultat d'outil sans appel réseau", async () => {
    const harness = createHarness({
      tools: [genericTool("db", "delete", "db__delete", "confirm")],
      turns: [turn("", [call("c1", "db__delete", {})]), turn("Action non exécutée")],
    })
    harness.approve.mockResolvedValue("deny")
    const output = await runToolAgent(harness.input)
    expect(harness.callTool).not.toHaveBeenCalled()
    expect(harness.runTurn.mock.calls[1][0].messages.at(-1).content).toContain("refusé par l'utilisateur")
    expect(output.text).toBe("Action non exécutée")
  })

  it("force seulement TinyFish au premier tour", async () => {
    const harness = createHarness({
      tools: [tinyfishTool("search"), genericTool("db", "delete", "db__delete")],
      webIntent: "required",
      turns: [turn("Réponse")],
    })
    await runToolAgent(harness.input)
    expect(harness.runTurn.mock.calls[0][3].tools.map((t: { function: { name: string } }) => t.function.name)).toEqual(["tinyfish__search"])
    expect(harness.runTurn.mock.calls[0][3].toolChoice).toBe("required")
  })

  it("additionne l'usage de tous les tours", async () => {
    const harness = createHarness({
      tools: [tinyfishTool("search")],
      turns: [
        turn("", [call("c1", "tinyfish__search", { query: "Tauri" })], { inputTokens: 10, outputTokens: 2, cachedInputTokens: 4 }),
        turn("Réponse", [], { inputTokens: 20, outputTokens: 5, cachedInputTokens: 8 }),
      ],
    })
    harness.callTool.mockResolvedValue(result("source"))
    await expect(runToolAgent(harness.input)).resolves.toMatchObject({ usage: { inputTokens: 30, outputTokens: 7, cachedInputTokens: 12 } })
  })

  it("borne deux tours à quatre appels puis force la réponse finale", async () => {
    const calls = (start: number) => [0, 1, 2].map((offset) => call(`c${start + offset}`, "tinyfish__search", { query: "Tauri" }))
    const harness = createHarness({
      tools: [tinyfishTool("search")],
      turns: [turn("", calls(1)), turn("", calls(4)), turn("Finale")],
    })
    harness.callTool.mockResolvedValue(result("source"))
    await expect(runToolAgent(harness.input)).resolves.toMatchObject({ text: "Finale" })
    expect(harness.callTool).toHaveBeenCalledTimes(4)
    expect(harness.runTurn.mock.calls[2][3]).toEqual({ toolChoice: "none" })
  })

  it("mémorise l'incompatibilité et ne relance qu'une fois sans outils", async () => {
    const unsupported = new ApiError("unknown", "Erreur", "tools are not supported")
    const harness = createHarness({
      tools: [tinyfishTool("search")],
      turns: [unsupported, turn("Sans outils")],
    })
    const output = await runToolAgent(harness.input)
    expect(output.text).toBe("Sans outils")
    expect(harness.input.unsupportedTools.has(harness.input.compatibilityKey)).toBe(true)
    expect(harness.runTurn).toHaveBeenCalledTimes(2)
  })

  it("propage AbortError sans appeler un outil", async () => {
    const abort = new DOMException("aborted", "AbortError")
    const harness = createHarness({
      tools: [tinyfishTool("search")],
      turns: [abort],
    })
    await expect(runToolAgent(harness.input)).rejects.toBe(abort)
    expect(harness.callTool).not.toHaveBeenCalled()
  })

  it("conserve les sources TinyFish validées et dédupliquées", async () => {
    const harness = createHarness({
      tools: [tinyfishTool("search")],
      turns: [turn("", [call("c1", "tinyfish__search", { query: "Tauri" })]), turn("Réponse")],
      webIntent: "required",
    })
    harness.callTool.mockResolvedValue({
      content: "Résultat",
      structuredContent: { ok: true },
      media: [],
      resourceLinks: [],
      isError: false,
      sources: [
        { url: "https://example.com", title: "Doc", origin: "search" },
        { url: "https://example.com", title: "Doublon", origin: "search" },
      ],
    })
    const result = await runToolAgent(harness.input)
    expect(result.sources).toEqual([{ url: "https://example.com", title: "Doc", origin: "search" }])
  })

  it("enveloppe les résultats génériques dans un bloc externe non fiable (jamais bruts dans messages)", async () => {
    const harness = createHarness({
      tools: [genericTool("github", "search", "github__search")],
      turns: [turn("", [call("c1", "github__search", { q: "test" })]), turn("Réponse finale")],
    })
    harness.callTool.mockResolvedValue({
      content: "Résultat",
      structuredContent: { data: "raw" },
      media: [],
      resourceLinks: [],
      sources: [],
      isError: false,
    })
    await runToolAgent(harness.input)
    // Le résultat d'outil est wrappé dans un bloc external_mcp_result (comportement normal) :
    // invariant anti-injection — le structuredContent brut ne doit jamais être persisté
    // directement dans messages.toolResults.
    const toolMessages = harness.runTurn.mock.calls[1][0].messages.filter(
      (m: { role: string }) => m.role === "tool"
    )
    expect(toolMessages).toHaveLength(1)
    const toolContent = toolMessages[0].content
    expect(toolContent).toContain("external_mcp_result")
    expect(toolContent).toContain('{"data":"raw"}') // structuredContent enveloppé dans le bloc externe
  })

  it("remonte les médias validés séparément du texte injecté au LLM", async () => {
    const harness = createHarness({
      tools: [genericTool("flux", "generate_image", "flux__generate_image")],
      turns: [turn("", [call("c1", "flux__generate_image", { prompt: "un chat" })]), turn("Voici votre image.")],
    })
    harness.callTool.mockResolvedValue({
      content: "Image générée.",
      media: [{ type: "image", mimeType: "image/png", base64: "AAEB" }],
      resourceLinks: [],
      sources: [],
      isError: false,
    })

    const output = await runToolAgent(harness.input)

    // Le média remonte augmenté du libellé d'outil (alt/aria) mais sans id :
    // la persistance posera l'identifiant.
    expect(output.media).toEqual([
      { type: "image", mimeType: "image/png", base64: "AAEB", toolLabel: "flux · generate_image" },
    ])
    // Le texte injecté au modèle porte la note courte, jamais le base64.
    const injected = harness.runTurn.mock.calls[1][0].messages.at(-1)!.content as string
    expect(injected).toContain("[Média retourné côté interface, non transmis au modèle : image image/png.]")
    expect(injected).not.toContain("AAEB")
    expect(output.text).toBe("Voici votre image.")
  })

  it("n'injecte aucune note média quand aucun média n'est renvoyé", async () => {
    const harness = createHarness({
      tools: [genericTool("flux", "generate_image", "flux__generate_image")],
      turns: [turn("", [call("c1", "flux__generate_image", { prompt: "un chat" })]), turn("Voici votre image.")],
    })
    harness.callTool.mockResolvedValue({
      content: "Image générée.",
      media: [],
      resourceLinks: [],
      sources: [],
      isError: false,
    })

    const output = await runToolAgent(harness.input)

    expect(output.media).toEqual([])
    const injected = harness.runTurn.mock.calls[1][0].messages.at(-1)!.content as string
    expect(injected).not.toContain("[Média retourné")
  })
})