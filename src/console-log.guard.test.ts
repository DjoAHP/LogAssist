import { describe, it, expect } from "vitest"
import { readFileSync, readdirSync, statSync } from "node:fs"
import path from "node:path"

// Garde-fou : aucun console.log ne doit subsister dans le code de production.
// Passer par src/lib/logger.ts (no-op en prod). Les fichiers de test et le
// logger lui-même utilisent légitimement console.log.
const SKIP = ["logger.ts"]
const EXTS = [".ts", ".tsx"]

function collect(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = path.join(dir, name)
    if (SKIP.some((s) => name.startsWith(s))) return []
    if (statSync(p).isDirectory()) return collect(p)
    if (!EXTS.some((e) => name.endsWith(e))) return []
    if (name.includes(".test.")) return []
    return [p]
  })
}

function findConsoleLog(file: string): string[] {
  const hits: string[] = []
  readFileSync(file, "utf-8").split("\n").forEach((line, i) => {
    if (/console\.log\(/.test(line)) hits.push(`${file}:${i + 1} — ${line.trim()}`)
  })
  return hits
}

describe("garde-fou console.log", () => {
  it("aucun console.log dans src/ hors tests et logger", () => {
    const files = collect(path.resolve(import.meta.dirname, "."))
    const offenders = files.flatMap(findConsoleLog)
    expect(offenders).toEqual([])
  })
})
