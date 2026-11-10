import { describe, expect, it } from "vitest"
import { readFileSync, readdirSync, statSync } from "node:fs"
import path from "node:path"

const SOURCE_EXTENSIONS = [".ts", ".tsx", ".css"]

function collectProductionFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const filePath = path.join(dir, name)
    if (statSync(filePath).isDirectory()) return collectProductionFiles(filePath)
    if (!SOURCE_EXTENSIONS.some((extension) => name.endsWith(extension))) return []
    if (name.includes(".test.")) return []
    return [filePath]
  })
}

describe("garde-fou de l'accent de marque", () => {
  it("utilise l'accent #9fbfd6 et conserve le cyan", () => {
    const css = readFileSync(path.resolve(import.meta.dirname, "index.css"), "utf-8")
    expect(css).toContain("--brand-from: #9fbfd6;")
    expect(css).toContain("--brand-to: #27c8d6;")
    expect(css).toContain("--brand-foreground: #000000;")

    const tailwindConfig = readFileSync(path.resolve(import.meta.dirname, "../tailwind.config.js"), "utf-8")
    expect(tailwindConfig).toContain('foreground: "var(--brand-foreground)"')
  })

  it("ne réintroduit ni l'ancien hex orange ni une classe Tailwind orange", () => {
    const offenders = collectProductionFiles(path.resolve(import.meta.dirname, ".")).flatMap((filePath) => {
      const content = readFileSync(filePath, "utf-8")
      if (!/#d64627|\borange-\d+\b/i.test(content)) return []
      return [path.relative(import.meta.dirname, filePath)]
    })

    expect(offenders).toEqual([])
  })

  it("associe toujours les boutons brand-from au texte noir de marque", () => {
    const offenders = collectProductionFiles(path.resolve(import.meta.dirname, ".")).flatMap((filePath) => {
      if (!filePath.endsWith(".tsx")) return []
      return readFileSync(filePath, "utf-8")
        .split("\n")
        .flatMap((line, index) => {
          // On autorise les variantes avec opacité (ex: bg-brand-from/10) utilisées en hover sur éléments muets
          const hasBrandFrom = /bg-brand-from(?!\/\d)/.test(line)
          return hasBrandFrom && !line.includes("text-brand-foreground")
            ? [`${path.relative(import.meta.dirname, filePath)}:${index + 1}`]
            : []
        })
    })

    expect(offenders).toEqual([])
  })
})
