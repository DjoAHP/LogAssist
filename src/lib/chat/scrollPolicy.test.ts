import { describe, expect, it } from "vitest"
import { CHAT_BOTTOM_THRESHOLD, isNearChatBottom } from "./scrollPolicy"

describe("isNearChatBottom", () => {
  it("suit le bas exact", () => {
    expect(isNearChatBottom({ scrollTop: 700, clientHeight: 300, scrollHeight: 1_000 })).toBe(true)
  })

  it("inclut exactement le seuil", () => {
    expect(isNearChatBottom({
      scrollTop: 700 - CHAT_BOTTOM_THRESHOLD,
      clientHeight: 300,
      scrollHeight: 1_000,
    })).toBe(true)
  })

  it("fige au-delà du seuil", () => {
    expect(isNearChatBottom({
      scrollTop: 699 - CHAT_BOTTOM_THRESHOLD,
      clientHeight: 300,
      scrollHeight: 1_000,
    })).toBe(false)
  })

  it("suit un contenu plus court que le conteneur", () => {
    expect(isNearChatBottom({ scrollTop: 0, clientHeight: 500, scrollHeight: 300 })).toBe(true)
  })
})
