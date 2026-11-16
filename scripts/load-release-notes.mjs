// Charge les notes correspondant au tag GitHub et les expose comme output
// multilignes. Le tag est validé avant de construire le chemin : aucun tag
// distant ne peut provoquer une traversée hors de .github/release-notes/.
import { randomUUID } from "node:crypto"
import { appendFileSync, readFileSync } from "node:fs"
import path from "node:path"

const TAG_PATTERN = /^v\d+\.\d+\.\d+$/
const root = process.env.LOGASSIST_ROOT || path.resolve(import.meta.dirname, "..")
const tag = process.env.LOGASSIST_RELEASE_TAG
const githubOutput = process.env.GITHUB_OUTPUT

if (!tag || !TAG_PATTERN.test(tag)) {
  throw new Error("Le tag de release doit respecter vX.Y.Z.")
}

if (!githubOutput) {
  throw new Error("GITHUB_OUTPUT est requis pour exporter les notes de release.")
}

const notesPath = path.join(root, ".github", "release-notes", `${tag}.md`)
let body
try {
  body = readFileSync(notesPath, "utf-8").trim()
} catch {
  throw new Error(`Notes de release introuvables : .github/release-notes/${tag}.md`)
}

if (!body) {
  throw new Error(`Les notes de release ${tag} sont vides.`)
}

const delimiter = `LOGASSIST_RELEASE_NOTES_${randomUUID().replaceAll("-", "")}`
appendFileSync(githubOutput, `body<<${delimiter}\n${body}\n${delimiter}\n`, "utf-8")
