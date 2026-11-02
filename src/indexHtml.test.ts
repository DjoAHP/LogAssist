// Régression visuelle non testable en jsdom (fond natif) → on vérifie le
// contrat du fichier index.html lui-même, comme console-log.guard scanne le code :
//  - html porte le fond inline sombre = anti-flash du premier paint ;
//  - body ne porte AUCUN style inline : sans ça, le style écrase `bg-background`
//    de index.css et le mode clair affiche un fond noir (bug v2.4.0 light mode) ;
//  - un script précoces adapte le fond html à la préférence persistée.
import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import path from "node:path"

const html = readFileSync(path.resolve(import.meta.dirname, "../index.html"), "utf-8")

describe("index.html — fond anti-flash sans casser le thème", () => {
  it("html garde un fond inline sombre (anti-flash au premier paint)", () => {
    expect(html).toMatch(/<html[^>]*style="background:\s*#09090b"/)
  })

  it("body n'a aucun style inline (le thème pilote via CSS bg-background)", () => {
    expect(html).not.toMatch(/<body[^>]*style=/)
  })

  it("un script précoces adapte le fond html à la préférence light persistée", () => {
    expect(html).toMatch(/logassist:dark/)
  })
})
