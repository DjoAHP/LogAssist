import { execute, select } from "./database"

export interface ImageRow {
  id: string
  filename: string
  created_at: string
}

export const images = {
  async create(id: string, filename: string): Promise<ImageRow> {
    const now = new Date().toISOString().slice(0, 19).replace("T", " ")
    const row: ImageRow = { id, filename, created_at: now }
    await execute("INSERT INTO images (id, filename, created_at) VALUES (?,?,?)", [row.id, row.filename, row.created_at])
    return row
  },
  async get(id: string): Promise<ImageRow | null> {
    const rows = await select<ImageRow>("SELECT * FROM images WHERE id = ?", [id])
    return rows[0] ?? null
  },
  async remove(id: string): Promise<void> {
    await execute("DELETE FROM images WHERE id = ?", [id])
  },
}