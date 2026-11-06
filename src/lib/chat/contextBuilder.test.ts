import { describe, expect, it } from "vitest"
import { buildChatMessages } from "./contextBuilder"

describe("buildChatMessages", () => {
  it("place le système avant l'historique et attache les images au dernier user", () => {
    const currentImages = [{ base64: "AAAA", mimeType: "image/png" }]
    const result = buildChatMessages({
      system: "SYSTEM",
      history: [
        { role: "user", content: "Question" },
        { role: "assistant", content: "Réponse" },
        { role: "user", content: "Capture" },
        { role: "assistant", content: "Suite" },
      ],
      currentImages,
    })
    expect(result).toEqual([
      { role: "system", content: "SYSTEM" },
      { role: "user", content: "Question" },
      { role: "assistant", content: "Réponse" },
      {
        role: "user",
        content: "Capture",
        images: [{ base64: "AAAA", mimeType: "image/png" }],
      },
      { role: "assistant", content: "Suite" },
    ])
    expect(currentImages).toEqual([{ base64: "AAAA", mimeType: "image/png" }])
    expect(result[3].images).not.toBe(currentImages)
    expect(result[3].images?.[0]).not.toBe(currentImages[0])
  })

  it("attache plusieurs images uniquement au dernier user", () => {
    const result = buildChatMessages({
      system: "",
      history: [
        { role: "user", content: "Premier" },
        { role: "assistant", content: "Réponse" },
        { role: "user", content: "Dernier" },
        { role: "assistant", content: "Fin" },
      ],
      currentImages: [
        { base64: "AAAA", mimeType: "image/png" },
        { base64: "BBBB", mimeType: "image/jpeg" },
      ],
    })

    expect(result).toEqual([
      { role: "user", content: "Premier" },
      { role: "assistant", content: "Réponse" },
      {
        role: "user",
        content: "Dernier",
        images: [
          { base64: "AAAA", mimeType: "image/png" },
          { base64: "BBBB", mimeType: "image/jpeg" },
        ],
      },
      { role: "assistant", content: "Fin" },
    ])
  })

  it("ignore les images quand l'historique ne contient aucun user", () => {
    const result = buildChatMessages({
      system: "SYSTEM",
      history: [{ role: "assistant", content: "Réponse" }],
      currentImages: [{ base64: "AAAA", mimeType: "image/png" }],
    })

    expect(result).toEqual([
      { role: "system", content: "SYSTEM" },
      { role: "assistant", content: "Réponse" },
    ])
  })

  it("omet le système vide et ne mute pas l'historique source", () => {
    const history = [{ role: "user" as const, content: "Question" }]
    const result = buildChatMessages({ system: "  ", history, currentImages: [] })
    expect(result).toEqual([{ role: "user", content: "Question" }])
    expect(history[0]).toEqual({ role: "user", content: "Question" })
  })

  it("retire les propriétés étrangères des messages d'historique", () => {
    const history = [
      { role: "user", content: "Question", id: "message-1" },
    ] as unknown as Parameters<typeof buildChatMessages>[0]["history"]

    const result = buildChatMessages({ system: "", history, currentImages: [] })

    expect(result).toEqual([{ role: "user", content: "Question" }])
  })
})
