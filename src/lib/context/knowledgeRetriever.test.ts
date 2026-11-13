import { describe, expect, it, vi } from "vitest"
import { chunkMarkdown } from "./markdownChunker"
import { createKnowledgeRetriever } from "./knowledgeRetriever"

const documents = [
  {
    id: "hise",
    name: "HISE",
    sortOrder: 0,
    content: "# ScriptNode\nCréer un ScriptNode et régler le gain audio.",
  },
  {
    id: "resolve",
    name: "DaVinci Resolve",
    sortOrder: 1,
    content: "# Étalonnage\nUtiliser les nodes de couleur et les scopes.",
  },
]

describe("createKnowledgeRetriever", () => {
  it("classe le passage correspondant à la question", () => {
    const retriever = createKnowledgeRetriever({ countTokens: (text) => Math.ceil(text.length / 4) })
    const ranked = retriever.search("Comment régler le gain dans ScriptNode ?", documents)

    expect(ranked[0]).toMatchObject({ documentId: "hise" })
    expect(ranked[0].score).toBeGreaterThan(0)
  })

  it("ne force aucun passage quand aucun terme ne correspond", () => {
    const retriever = createKnowledgeRetriever({ countTokens: (text) => Math.ceil(text.length / 4) })
    expect(retriever.search("recette de pain au levain", documents)).toEqual([])
  })

  it("invalide le cache quand le contenu change", () => {
    const retriever = createKnowledgeRetriever({ countTokens: (text) => Math.ceil(text.length / 4) })
    expect(retriever.search("oscillateur", documents)).toEqual([])
    const changed = [
      { ...documents[0], content: "# Synthèse\nAjouter un oscillateur sinusoïdal." },
      documents[1],
    ]

    expect(retriever.search("oscillateur", changed)[0]).toMatchObject({ documentId: "hise" })
  })

  it("réutilise les chunks en cache pour les documents inchangés", () => {
    const chunkDocument = vi.fn(chunkMarkdown)
    const retriever = createKnowledgeRetriever({
      countTokens: (text) => Math.ceil(text.length / 4),
      chunkDocument,
    })

    retriever.search("gain", documents)
    retriever.search("scopes", documents)
    expect(chunkDocument).toHaveBeenCalledTimes(2)
  })

  it("retrouve un passage unique dans 4 000 sections et réutilise leur cache", () => {
    const chunkDocument = vi.fn(chunkMarkdown)
    const retriever = createKnowledgeRetriever({
      countTokens: (text) => Math.ceil(text.length / 4),
      chunkDocument,
    })
    const largeLibrary = Array.from({ length: 100 }, (_, documentIndex) => ({
      id: `doc-${documentIndex}`,
      name: `Document ${documentIndex}`,
      sortOrder: documentIndex,
      content: Array.from({ length: 40 }, (_, sectionIndex) => [
        `## Section ${sectionIndex}`,
        documentIndex === 73 && sectionIndex === 19
          ? "Le paramètre oscillateur_polyphonique active la synthèse recherchée."
          : `Contenu synthétique du document ${documentIndex}, section ${sectionIndex}.`,
      ].join("\n")).join("\n\n"),
    }))

    const ranked = retriever.search("oscillateur_polyphonique", largeLibrary)

    expect(ranked[0].content).toContain("oscillateur_polyphonique")
    expect(ranked[0].documentId).toBe("doc-73")
    expect(chunkDocument).toHaveBeenCalledTimes(100)

    const cached = retriever.search("oscillateur_polyphonique", largeLibrary)
    expect(cached[0].documentId).toBe("doc-73")
    expect(chunkDocument).toHaveBeenCalledTimes(100)
  })

  it("reconstruit les chunks après un clear explicite", () => {
    const chunkDocument = vi.fn(chunkMarkdown)
    const retriever = createKnowledgeRetriever({
      countTokens: (text) => Math.ceil(text.length / 4),
      chunkDocument,
    })

    retriever.search("gain", documents)
    retriever.clear()
    retriever.search("gain", documents)
    expect(chunkDocument).toHaveBeenCalledTimes(4)
  })

  it("diversifie deux documents de scores proches avant un passage redondant", () => {
    const retriever = createKnowledgeRetriever({
      countTokens: (text) => Math.ceil(text.length / 4),
    })
    const ranked = retriever.search("gain audio", [
      {
        id: "a",
        name: "Audio A",
        sortOrder: 0,
        content: "# Gain\nGain audio principal.\n\n## Suite\nGain audio secondaire.",
      },
      {
        id: "b",
        name: "Audio B",
        sortOrder: 1,
        content: "# Gain\nGain audio alternatif.",
      },
    ])

    expect(ranked.slice(0, 2).map((chunk) => chunk.documentId)).toEqual(["a", "b"])
  })

  it("normalise les séparateurs des identifiants techniques", () => {
    const retriever = createKnowledgeRetriever({ countTokens: (text) => Math.ceil(text.length / 4) })
    const ranked = retriever.search("oscillator frequency", [{
      id: "api",
      name: "API",
      sortOrder: 0,
      content: "# Référence\nUtiliser oscillator_frequency pour régler la fréquence.",
    }])

    expect(ranked[0]).toMatchObject({ documentId: "api" })
  })

  it("favorise une correspondance exacte d’identifiant technique", () => {
    const retriever = createKnowledgeRetriever({ countTokens: (text) => Math.ceil(text.length / 4) })
    const ranked = retriever.search("oscillator_frequency", [
      {
        id: "words",
        name: "API",
        sortOrder: 0,
        content: "# Référence\noscillator frequency",
      },
      {
        id: "exact",
        name: "API",
        sortOrder: 1,
        content: "# Référence\noscillator_frequency",
      },
    ])

    expect(ranked[0]).toMatchObject({ documentId: "exact" })
  })
})
