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

function countLoggerDebug(file: string): number {
  return [...readFileSync(file, "utf-8").matchAll(/logger\.debug\s*\(/g)].length
}

describe("garde-fou console.log", () => {
  it("aucun console.log dans src/ hors tests et logger", () => {
    const files = collect(path.resolve(import.meta.dirname, "."))
    const offenders = files.flatMap(findConsoleLog)
    expect(offenders).toEqual([])
  })

  it("limite logger.debug aux quatre appels explicitement audités", () => {
    const root = path.resolve(import.meta.dirname, ".")
    const callSites = Object.fromEntries(
      collect(root)
        .map((file) => [
          path.relative(root, file).split(path.sep).join("/"),
          countLoggerDebug(file),
        ] as const)
        .filter(([, count]) => count > 0),
    )

    // Toute nouvelle journalisation doit être revue : ces sites ne passent que
    // des métadonnées UI, un détail HTTP déjà nettoyé ou le diagnostic sûr.
    expect(callSites).toEqual({
      "components/chat/ChatView.tsx": 2,
      "lib/ai/openai-compat.ts": 1,
      "lib/chat/prepareConversationContext.ts": 1,
    })
  })
})
