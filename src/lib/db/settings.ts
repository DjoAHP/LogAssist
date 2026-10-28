import { execute, select } from "./database"

// Table settings existante (migrations.ts : key TEXT PK, value TEXT NOT NULL).
export const settings = {
  async get(key: string): Promise<string | null> {
    const rows = await select<{ value: string }>("SELECT value FROM settings WHERE key = ?", [key])
    return rows[0]?.value ?? null
  },
  async set(key: string, value: string): Promise<void> {
    await execute(
      "INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
      [key, value],
    )
  },
}
