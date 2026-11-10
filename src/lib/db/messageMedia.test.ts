import { describe, expect, it, vi, beforeEach } from "vitest"

const mockExecute = vi.fn()
const mockSelect = vi.fn()
vi.mock("@/lib/db/database", () => ({
  execute: (...a: unknown[]) => mockExecute(...a),
  select: (...a: unknown[]) => mockSelect(...a),
}))

import { messageMedia } from "@/lib/db/messageMedia"

beforeEach(() => {
  vi.clearAllMocks()
})

describe("messageMedia", () => {
  it("insère chaque média avec un statement paramétré", async () => {
    mockExecute.mockResolvedValue({ rowsAffected: 1 })

    await messageMedia.insertRows([
      {
        id: "media-1",
        message_id: "msg-1",
        kind: "image",
        mime_type: "image/png",
        tool_label: "Cloudflare · generate_image",
        base64: "AAEB",
      },
    ])

    const [sql, bind] = mockExecute.mock.calls[0]
    expect(sql).toBe(
      "INSERT INTO message_media (id, message_id, kind, mime_type, tool_label, base64, created_at) VALUES (?,?,?,?,?,?,datetime('now'))",
    )
    expect(bind).toEqual([
      "media-1",
      "msg-1",
      "image",
      "image/png",
      "Cloudflare · generate_image",
      "AAEB",
    ])
  })

  it("liste les médias par ids de messages avec un IN paramétré", async () => {
    mockSelect.mockResolvedValueOnce([
      {
        id: "media-1", message_id: "msg-1", kind: "image", mime_type: "image/png",
        tool_label: "Cloudflare · generate_image", base64: "AAEB",
        created_at: "2026-11-10 00:00:00",
      },
    ])

    const rows = await messageMedia.listByMessageIds(["msg-1", "msg-2"])

    const [sql, bind] = mockSelect.mock.calls[0]
    expect(sql).toBe(
      "SELECT id, message_id, kind, mime_type, tool_label, base64, created_at FROM message_media WHERE message_id IN (?,?)",
    )
    expect(bind).toEqual(["msg-1", "msg-2"])
    expect(rows).toHaveLength(1)
    expect(rows[0].kind).toBe("image")
  })

  it("retourne [] sans jamais émettre d'IN vide", async () => {
    expect(await messageMedia.listByMessageIds([])).toEqual([])
    expect(mockSelect).not.toHaveBeenCalled()
    await messageMedia.removeByMessageIds([])
    expect(mockExecute).not.toHaveBeenCalled()
  })

  it("supprime les médias d'un message avant sa réécriture", async () => {
    mockExecute.mockResolvedValue({ rowsAffected: 1 })

    await messageMedia.removeByMessageIds(["msg-1"])

    const [sql, bind] = mockExecute.mock.calls[0]
    expect(sql).toBe("DELETE FROM message_media WHERE message_id IN (?)")
    expect(bind).toEqual(["msg-1"])
  })
})
