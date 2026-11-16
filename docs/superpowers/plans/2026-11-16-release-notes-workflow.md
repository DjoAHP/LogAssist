# Notes de release versionnées — Plan d’implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Publier chaque Release GitHub avec un titre `vX.Y.Z` et des notes Markdown pertinentes, versionnées et validées avant le tag.

**Architecture:** Un script Node isolé valide le tag, charge `.github/release-notes/<tag>.md` et écrit un output multilignes GitHub Actions. Le workflow Release consomme cet output avant `tauri-action`. `AGENTS.md` fixe la convention éditoriale et opérationnelle pour les futures versions.

**Tech Stack:** Node.js ESM, Vitest, GitHub Actions, `tauri-apps/tauri-action@v1`, Markdown.

**Spec source:** `docs/superpowers/specs/2026-11-16-release-notes-workflow-design.md`

**Contrainte projet:** pas de worktree local ; exécution sur la branche `chore/release-notes-workflow`.

---

### Task 1: Chargeur sécurisé de notes de release (TDD)

**Files:**
- Create: `scripts/load-release-notes.mjs`
- Test: `src/releaseNotesWorkflow.test.ts`

- [ ] **Step 1: écrire le test rouge**

Créer `src/releaseNotesWorkflow.test.ts` :

```ts
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { execFileSync } from "node:child_process"
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

let root: string
let githubOutput: string

function run(tag: string) {
  execFileSync(process.execPath, [scriptPath], {
    env: {
      ...process.env,
      LOGASSIST_ROOT: root,
      LOGASSIST_RELEASE_TAG: tag,
      GITHUB_OUTPUT: githubOutput,
    },
    stdio: "pipe",
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

    run("v3.5.0")

    const output = readFileSync(githubOutput, "utf-8")
    const lines = output.trimEnd().split("\n")
    const delimiter = lines[0].replace("body<<", "")
    expect(lines.at(-1)).toBe(delimiter)
    expect(lines.slice(1, -1).join("\n")).toBe(notes)
  })

  it("refuse un tag qui n'est pas un semver vX.Y.Z fermé", () => {
    expect(() => run("v3.5.0/../../secret")).toThrow()
  })

  it("refuse une release sans fichier de notes", () => {
    expect(() => run("v3.5.1")).toThrow()
  })

  it("refuse un fichier de notes vide", () => {
    writeNotes("v3.5.0", "  \n")
    expect(() => run("v3.5.0")).toThrow()
  })
})
```

- [ ] **Step 2: vérifier le rouge**

```powershell
powershell.exe -NoProfile -Command "cd C:\dev\LogAssist; npx vitest run src/releaseNotesWorkflow.test.ts"
```

Attendu : échec `Cannot find module` ou processus Node incapable de trouver `scripts/load-release-notes.mjs`.

- [ ] **Step 3: implémenter le chargeur minimal**

Créer `scripts/load-release-notes.mjs` :

```js
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
```

- [ ] **Step 4: vérifier le vert**

Même commande que Step 2. Attendu : 4/4 tests réussis.

- [ ] **Step 5: commit**

```bash
git add scripts/load-release-notes.mjs src/releaseNotesWorkflow.test.ts
git commit -m "ci: valide et charge les notes de release versionnées"
```

---

### Task 2: Workflow, convention AGENTS et notes v3.5.0

**Files:**
- Modify: `.github/workflows/release.yml`
- Modify: `AGENTS.md`
- Create: `.github/release-notes/v3.5.0.md`

- [ ] **Step 1: connecter le workflow au chargeur**

Dans `.github/workflows/release.yml`, après le contrôle tag/version :

```yaml
      - name: Charge les notes de release versionnées
        id: release_notes
        env:
          LOGASSIST_RELEASE_TAG: ${{ github.ref_name }}
        run: node scripts/load-release-notes.mjs
```

Puis remplacer :

```yaml
          releaseName: "LogAssist v__VERSION__"
          releaseBody: "Mise à jour automatique de LogAssist. Consultez l'historique des changements pour le détail."
```

par :

```yaml
          releaseName: "v__VERSION__"
          releaseBody: ${{ steps.release_notes.outputs.body }}
```

- [ ] **Step 2: ajouter la convention dans AGENTS.md**

Ajouter sous `## 5. Git`, avant le séparateur de section :

```markdown
### Workflow de release

1. Créer `chore/release-vX.Y.Z` depuis `feat/m1-socle-chat`, mettre à jour la
   version et exécuter `npm run sync:version`.
2. L’agent analyse les changements depuis le dernier tag et rédige
   `.github/release-notes/vX.Y.Z.md` : titre principal, introduction courte,
   deux ou trois sections `## <emoji> <titre>`, listes factuelles et phrase de
   conclusion. Le titre GitHub de la Release reste exactement `vX.Y.Z`.
3. Faire approuver le texte par l’utilisateur avant le tag, puis merger la PR
   seulement après les gates TypeScript et Rust.
4. Créer un tag annoté sur le merge commit et pousser uniquement ce tag :
   `git tag -a vX.Y.Z -m "LogAssist vX.Y.Z — <résumé>"`, puis
   `git push origin vX.Y.Z`. Ne jamais utiliser `git push --tags`.
5. Surveiller le workflow Release et vérifier la présence de `.exe`, `.msi`,
   `.sig` et `latest.json`. Une release sans notes versionnées doit échouer.

La clé privée minisign reste hors dépôt, sauvegardée dans `C:\dev\secrets\`
et dans les Secrets GitHub. Sa perte empêche les installations existantes
d’accepter les futures mises à jour.
```

- [ ] **Step 3: rédiger `.github/release-notes/v3.5.0.md`**

```markdown
# Les mises à jour arrivent dans LogAssist

LogAssist v3.5.0 simplifie enfin le passage d’une version à la suivante : l’application peut désormais détecter, télécharger et installer ses futures mises à jour sans retour manuel sur GitHub.

## 🚀 Une mise à jour, directement depuis l’application

- Vérification silencieuse quelques secondes après le démarrage
- Bannière discrète lorsqu’une nouvelle version est disponible
- Bouton de vérification manuelle dans les paramètres généraux
- Progression du téléchargement et messages d’erreur adaptés

Cette version doit être installée manuellement une dernière fois. À partir de v3.5.0, les prochaines mises à jour seront proposées dans LogAssist.

## 🔐 Des paquets vérifiés avant installation

- Signature minisign de chaque installateur publié
- Vérification cryptographique avant toute installation
- Clé privée conservée uniquement dans les Secrets GitHub et hors du dépôt
- Téléchargement depuis GitHub Releases en HTTPS

Un paquet modifié ou signé avec une autre clé sera refusé par l’application.

## 🧰 Une publication plus fiable

- Création automatique des installateurs `.exe` et `.msi`
- Publication des signatures `.sig` et du manifeste `latest.json`
- Gates TypeScript, Vitest, Rust et Clippy avant merge
- Notes de release versionnées et contrôlées avant chaque tag

Moins d’étapes manuelles pour publier, et une mise à jour plus simple pour utiliser LogAssist au quotidien.
```

- [ ] **Step 4: simuler localement le workflow positif**

```powershell
powershell.exe -NoProfile -Command "$env:LOGASSIST_RELEASE_TAG='v3.5.0'; $env:GITHUB_OUTPUT=Join-Path $env:TEMP 'logassist-release-output.txt'; Remove-Item $env:GITHUB_OUTPUT -ErrorAction SilentlyContinue; cd C:\dev\LogAssist; node scripts/load-release-notes.mjs; Get-Content $env:GITHUB_OUTPUT | Select-Object -First 2"
```

Attendu : première ligne `body<<LOGASSIST_RELEASE_NOTES_...`, puis le titre Markdown.

- [ ] **Step 5: valider YAML et le contrat**

```bash
python3 - <<'PY'
from pathlib import Path
import yaml
data = yaml.safe_load(Path('.github/workflows/release.yml').read_text())
steps = data['jobs']['publish']['steps']
loader = next(step for step in steps if step.get('id') == 'release_notes')
action = next(step for step in steps if step.get('uses') == 'tauri-apps/tauri-action@v1')
assert loader['env']['LOGASSIST_RELEASE_TAG'] == '${{ github.ref_name }}'
assert action['with']['releaseName'] == 'v__VERSION__'
assert action['with']['releaseBody'] == '${{ steps.release_notes.outputs.body }}'
print('Workflow release notes: OK')
PY
```

- [ ] **Step 6: présenter les notes v3.5.0 à l’utilisateur**

Afficher le contenu exact de `.github/release-notes/v3.5.0.md`. Ne pas créer de tag sans son approbation explicite.

- [ ] **Step 7: commit**

```bash
git add .github/workflows/release.yml .github/release-notes/v3.5.0.md AGENTS.md
git commit -m "ci: publie des notes de release versionnées"
```

---

### Task 3: Gates, PR et merge (sans tag)

- [ ] **Step 1:** lancer `npm run build` sous Windows ; attendu : tous les tests et build Vite réussis.
- [ ] **Step 2:** lancer `cargo test` et `cargo clippy -- -D warnings` sous Windows ; attendu : aucune erreur.
- [ ] **Step 3:** pousser `chore/release-notes-workflow` et ouvrir une PR vers `feat/m1-socle-chat`.
- [ ] **Step 4:** attendre la CI Windows et merger uniquement si les deux jobs sont verts.
- [ ] **Step 5:** vérifier l’arbre mergé, la suppression de branche et l’absence du tag `v3.5.0`.

Le tag et la surveillance du workflow Release constituent l’étape suivante, exécutée avec l’utilisateur après validation finale des notes.

---

## Self-review

- **Couverture spec :** chargeur et erreurs (Task 1), workflow/AGENTS/notes (Task 2), validation avant tag (Task 3).
- **Sécurité :** regex semver fermée avant construction du chemin ; aucune donnée secrète lue ou écrite par le chargeur.
- **Cohérence :** output `body` identique entre script, workflow et test ; titre `v__VERSION__` conforme à la convention.
- **Périmètre :** aucun changement updater, signature ou Authenticode ; aucun tag dans ce plan.
