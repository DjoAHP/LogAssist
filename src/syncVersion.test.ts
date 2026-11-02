// Contrat de sync-version.mjs : la version de package.json se répercute sur
// src-tauri/tauri.conf.json (version + titre de fenêtre « Produit vX ») et
// Cargo.toml. Testé via une fixture temporaire — le repo réel n'est jamais
// touché (surcharges LOGASSIST_ROOT, ignorée… tant que la couture n'existe pas).
import { describe, it, expect, beforeEach, afterEach } from "vitest"
import { execFileSync } from "node:child_process"
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs"
import path from "node:path"
import os from "node:os"

const scriptPath = path.resolve(import.meta.dirname, "../scripts/sync-version.mjs")

let root: string

function runSync() {
  execFileSync(process.execPath, [scriptPath], {
    env: { ...process.env, LOGASSIST_ROOT: root },
  })
}

beforeEach(() => {
  root = mkdtempSync(path.join(os.tmpdir(), "logassist-sync-"))
  mkdirSync(path.join(root, "src-tauri"), { recursive: true })
  writeFileSync(
    path.join(root, "package.json"),
    JSON.stringify({ version: "9.9.9" }, null, 2) + "\n",
  )
  writeFileSync(
    path.join(root, "src-tauri", "tauri.conf.json"),
    JSON.stringify(
      {
        productName: "LogAssist",
        version: "2.3.0",
        app: { windows: [{ title: "LogAssist", width: 1200 }] },
      },
      null,
      2,
    ) + "\n",
  )
  writeFileSync(
    path.join(root, "src-tauri", "Cargo.toml"),
    '[package]\nname = "logassist"\nversion = "2.3.0"\n',
  )
})

afterEach(() => rmSync(root, { recursive: true, force: true }))

describe("scripts/sync-version.mjs", () => {
  it("propage la version dans tauri.conf.json et Cargo.toml", () => {
    runSync()
    const conf = JSON.parse(
      readFileSync(path.join(root, "src-tauri", "tauri.conf.json"), "utf-8"),
    )
    expect(conf.version).toBe("9.9.9")
    expect(
      readFileSync(path.join(root, "src-tauri", "Cargo.toml"), "utf-8"),
    ).toContain('version = "9.9.9"')
  })

  it("écrit le titre de la fenêtre « Produit vX » (suffixe version auto)", () => {
    runSync()
    const conf = JSON.parse(
      readFileSync(path.join(root, "src-tauri", "tauri.conf.json"), "utf-8"),
    )
    expect(conf.app.windows[0].title).toBe("LogAssist v9.9.9")
  })
})
