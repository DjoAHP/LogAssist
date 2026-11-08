import { describe, expect, it, vi } from "vitest"

import { createTransactionExecutor } from "./database"

type TransactionBatch = Array<{ sql: string; values: unknown[] }>

describe("transaction SQLite", () => {
  it("ignore un lot vide sans charger la DB ni appeler l'IPC", async () => {
    const loadDb = vi.fn(async (): Promise<unknown> => undefined)
    const runBatch = vi.fn(async (_statements: TransactionBatch): Promise<void> => undefined)
    const executeTransaction = createTransactionExecutor(loadDb, runBatch)

    await executeTransaction([])

    expect(loadDb).not.toHaveBeenCalled()
    expect(runBatch).not.toHaveBeenCalled()
  })

  it("charge la DB puis transmet le lot normalisé à l'IPC", async () => {
    const order: string[] = []
    const loadDb = vi.fn(async (): Promise<unknown> => {
      order.push("load")
      return undefined
    })
    const runBatch = vi.fn(async (_statements: TransactionBatch): Promise<void> => {
      order.push("ipc")
    })
    const executeTransaction = createTransactionExecutor(loadDb, runBatch)

    await executeTransaction([
      { sql: "INSERT INTO settings (key, value) VALUES (?, ?)", bind: ["k", "v"] },
      { sql: "DELETE FROM settings" },
    ])

    expect(order).toEqual(["load", "ipc"])
    expect(runBatch).toHaveBeenCalledWith([
      { sql: "INSERT INTO settings (key, value) VALUES (?, ?)", values: ["k", "v"] },
      { sql: "DELETE FROM settings", values: [] },
    ])
  })

  it("sérialise deux lots concurrents", async () => {
    const loadDb = vi.fn(async (): Promise<unknown> => undefined)
    const order: string[] = []
    let releaseFirst!: () => void
    const gate = new Promise<void>((resolve) => { releaseFirst = resolve })
    let markFirstStarted!: () => void
    const firstStarted = new Promise<void>((resolve) => { markFirstStarted = resolve })
    const runBatch = vi.fn(async (statements: TransactionBatch): Promise<void> => {
      if (statements[0]?.values[0] === "first") {
        order.push("first:start")
        markFirstStarted()
        await gate
        order.push("first:end")
        return
      }
      order.push("second")
    })
    const executeTransaction = createTransactionExecutor(loadDb, runBatch)

    const first = executeTransaction([{ sql: "SELECT ?", bind: ["first"] }])
    const second = executeTransaction([{ sql: "SELECT ?", bind: ["second"] }])

    await firstStarted
    expect(order).toEqual(["first:start"])
    releaseFirst()
    await Promise.all([first, second])
    expect(order).toEqual(["first:start", "first:end", "second"])
  })

  it("libère la file si le chargement de la DB échoue", async () => {
    const failure = new Error("chargement impossible")
    let attempt = 0
    const loadDb = vi.fn(async (): Promise<unknown> => {
      attempt += 1
      if (attempt === 1) throw failure
      return undefined
    })
    const runBatch = vi.fn(async (_statements: TransactionBatch): Promise<void> => undefined)
    const executeTransaction = createTransactionExecutor(loadDb, runBatch)

    const first = expect(executeTransaction([{ sql: "SELECT 1" }])).rejects.toBe(failure)
    const second = executeTransaction([{ sql: "SELECT 2" }])

    await first
    await expect(second).resolves.toBeUndefined()
    expect(runBatch).toHaveBeenCalledTimes(1)
    expect(runBatch).toHaveBeenCalledWith([{ sql: "SELECT 2", values: [] }])
  })

  it("libère la file si l'IPC échoue", async () => {
    const failure = new Error("IPC impossible")
    const loadDb = vi.fn(async (): Promise<unknown> => undefined)
    let attempt = 0
    const runBatch = vi.fn(async (_statements: TransactionBatch): Promise<void> => {
      attempt += 1
      if (attempt === 1) throw failure
    })
    const executeTransaction = createTransactionExecutor(loadDb, runBatch)

    const first = expect(executeTransaction([{ sql: "SELECT 1" }])).rejects.toBe(failure)
    const second = executeTransaction([{ sql: "SELECT 2" }])

    await first
    await expect(second).resolves.toBeUndefined()
    expect(runBatch).toHaveBeenCalledTimes(2)
  })
})
