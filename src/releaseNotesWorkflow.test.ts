import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { spawnSync } from "node:child_process"
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs"
import os from "node:os"
import path from "node:path"

const scriptPath = path.resolve(import.meta.dirname, "../scripts/load-release-notes.mjs")
const releaseWorkflowPath = path.resolve(import.meta.dirname, "../.github/workflows/release.yml")

let root: string
let githubOutput: string

function run(tag: string) {
  return spawnSync(process.execPath, [scriptPath], {
    env: {
      ...process.env,
      LOGASSIST_ROOT: root,
      LOGASSIST_RELEASE_TAG: tag,
      GITHUB_OUTPUT: githubOutput,
    },
    encoding: "utf-8",
  })
}

function writeNotes(tag: string, content: string) {
  const directory = path.join(root, ".github", "release-notes")
  mkdirSync(directory, { recursive: true })
  writeFileSync(path.join(directory, `${tag}.md`), content, "utf-8")
}

beforeEach(() => {
  root = mkdtempSync(path.join(os.tmpdir(), "logassist-release-notes-"))
  githubOutput = path.join(root, "github-output.txt")
  writeFileSync(githubOutput, "", "utf-8")
})

afterEach(() => rmSync(root, { recursive: true, force: true }))

describe("scripts/load-release-notes.mjs", () => {
  it("exporte intact le Markdown correspondant au tag", () => {
    const notes = "# Une release utile\n\n## 🚀 Nouveauté\n\n- Mise à jour"
    writeNotes("v3.5.0", notes)

    const result = run("v3.5.0")

    expect(result.status).toBe(0)
    const output = readFileSync(githubOutput, "utf-8")
    const lines = output.trimEnd().split("\n")
    const delimiter = lines[0].replace("body<<", "")
    expect(lines[lines.length - 1]).toBe(delimiter)
    expect(lines.slice(1, -1).join("\n")).toBe(notes)
  })

  it("refuse un tag qui n'est pas un semver vX.Y.Z fermé", () => {
    const result = run("v3.5.0/../../secret")

    expect(result.status).not.toBe(0)
    expect(result.stderr).toContain("Le tag de release doit respecter vX.Y.Z.")
  })

  it("refuse une release sans fichier de notes", () => {
    const result = run("v3.5.1")

    expect(result.status).not.toBe(0)
    expect(result.stderr).toContain(
      "Notes de release introuvables : .github/release-notes/v3.5.1.md",
    )
  })

  it("refuse un fichier de notes vide", () => {
    writeNotes("v3.5.0", "  \n")

    const result = run("v3.5.0")

    expect(result.status).not.toBe(0)
    expect(result.stderr).toContain("Les notes de release v3.5.0 sont vides.")
  })
})

describe("workflow de release", () => {
  it("construit la portable avant publication avec la feature et la config dédiées", () => {
    const workflow = readFileSync(releaseWorkflowPath, "utf-8")
    const portableBuild = workflow.indexOf(
      "npm run tauri build -- --features portable --config src-tauri/tauri.portable.conf.json",
    )
    const publication = workflow.indexOf("uses: tauri-apps/tauri-action@v1")

    expect(portableBuild).toBeGreaterThan(-1)
    expect(publication).toBeGreaterThan(portableBuild)
  })

  it("publie l'exécutable portable et son empreinte dans la release stable", () => {
    const workflow = readFileSync(releaseWorkflowPath, "utf-8")
    expect(workflow).toContain("LogAssistPortable.exe.sha256")
    expect(workflow).toContain("gh release upload")
    expect(workflow).toContain("LogAssistPortable.exe")
  })
})
