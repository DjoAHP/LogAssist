import { describe, expect, it } from "vitest"
import { chunkMarkdown, fingerprintText } from "./markdownChunker"

const countTokens = (text: string) => Math.max(1, Math.ceil(text.length / 20))

describe("chunkMarkdown", () => {
  it("conserve le chemin des titres imbriqués", () => {
    const content = "# HISE\nIntroduction.\n\n## ScriptNode\nCréer un node.\n\n### Paramètres\nRégler gain."
    const chunks = chunkMarkdown({
      documentId: "k1",
      documentName: "HISE",
      content,
      countTokens,
      targetTokens: 20,
      hardLimitTokens: 30,
    })

    expect(chunks.map((chunk) => chunk.headingPath)).toContainEqual(["HISE", "ScriptNode", "Paramètres"])
    expect(content).toBe("# HISE\nIntroduction.\n\n## ScriptNode\nCréer un node.\n\n### Paramètres\nRégler gain.")
  })

  it("garde un bloc de code ordinaire dans un seul passage", () => {
    const chunks = chunkMarkdown({
      documentId: "k1",
      documentName: "HISE",
      content: "## Code\n```js\nconst gain = 1\nconsole.log(gain)\n```",
      countTokens,
      targetTokens: 20,
      hardLimitTokens: 30,
    })

    expect(chunks.filter((chunk) => chunk.content.includes("const gain"))).toHaveLength(1)
    expect(chunks.find((chunk) => chunk.content.includes("const gain"))?.content).toContain("```js")
  })

  it("scinde par lignes un bloc de code qui dépasse seul la limite", () => {
    const code = Array.from({ length: 80 }, (_, index) => `line_${index}()`).join("\n")
    const chunks = chunkMarkdown({
      documentId: "k1",
      documentName: "HISE",
      content: `## Code\n\`\`\`js\n${code}\n\`\`\``,
      countTokens,
      targetTokens: 10,
      hardLimitTokens: 15,
    })

    expect(chunks.length).toBeGreaterThan(1)
    expect(chunks.every((chunk) => chunk.tokenEstimate <= 15)).toBe(true)
    expect(chunks.every((chunk) => chunk.headingPath[chunk.headingPath.length - 1] === "Code")).toBe(true)
    expect(chunks.every((chunk) => chunk.content.startsWith("```js"))).toBe(true)
    expect(chunks.every((chunk) => chunk.content.endsWith("```"))).toBe(true)
  })

  it("normalise uniquement la vue dérivée et produit des références déterministes", () => {
    const content = "# Titre\r\nTexte A.\r\n\r\nTexte B."
    const first = chunkMarkdown({ documentId: "k1", documentName: "Doc", content, countTokens })
    const second = chunkMarkdown({ documentId: "k1", documentName: "Doc", content, countTokens })

    expect(first.length).toBeGreaterThan(0)
    expect(first).toEqual(second)
    expect(first.every((chunk, index) => chunk.chunkIndex === index)).toBe(true)
    expect(first.every((chunk) => chunk.fingerprint === fingerprintText(content))).toBe(true)
    expect(first.every((chunk) => !chunk.content.includes("\r"))).toBe(true)
    expect(content).toContain("\r\n")
    expect(fingerprintText(content)).toMatch(/^[0-9a-f]{8}$/)
  })

  it("ignore un document vide", () => {
    expect(chunkMarkdown({
      documentId: "empty",
      documentName: "Vide",
      content: "  \n\n",
      countTokens,
    })).toEqual([])
  })
})
