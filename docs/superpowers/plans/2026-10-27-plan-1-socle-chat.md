# LogAssist — Plan 1 : Socle chat fonctionnel

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Une application de bureau Tauri 2 dans laquelle on crée, renomme et supprime des conversations, on envoie un message à un modèle IA OpenAI-compatible (URL + clé configurés en base, clé secrète dans le Credential Manager Windows), on voit la réponse en streaming avec le badge fournisseur/modèle + latence, et tout est persisté en SQLite.

**Architecture:** Frontend React/TS (UI + logique métier + adaptateur API en `src/lib/`), bridge Tauri minimal pour secrets/exports, SQLite via `tauri-plugin-sql`, secrets via crate `keyring`. Prompt système = instructions générales + profil (V1 : un seul « Apprentissage ») + projet (ultérieur).

**Tech Stack:** Tauri 2 · React 19 (19.1, fourni par le scaffold — écart vs React 18 initial assumé) · TypeScript 6 (strict) · Vite 8 · Tailwind CSS 3.4 · shadcn/ui (variables + cn(), init explicite en Task 9) · lucide-react · Vitest · tauri-plugin-sql v2 · keyring crate v3. Note : `npm`/`node` doivent TOUJOURS être lancés via `powershell.exe` (node_modules à binaires Windows).

## Global Constraints

- UI entièrement en **français** : aucun libellé codé en dur dans les composants, tout passe par `src/i18n/fr.ts`.
- **Clés API jamais en clair** : ni en base, ni dans les logs, ni dans un fichier. Stockage : Credential Manager via commands Rust (`set_secret`/`get_secret`/`delete_secret`).
- Build et outils côté **Windows** (Rust MSVC) ; projet à `C:\dev\LogAssist`. Les tests Vitest se lancent côté Windows (PowerShell).
- Schema SQLite **versionné** : `PRAGMA user_version` = 1 en fin de Task 4.
- Erreurs API affichées via la taxonomie normalisée (Task 3) — jamais d'erreur brute à l'utilisateur.
- Commits : messages conventionnels courts en français (`feat:`, `test:`, `chore:`…).
- Chaque tâche finit par des tests verts + commit.

**Prérequis (à vérifier une fois avant Task 1, PowerShell) :** `node -v` ≥ 20 · `rustc --version` ≥ 1.77 · `cargo --version` · VS Build Tools + WebView2 présents (`cargo tauri` ne sera pas utilisé : on pilotera via npm scripts).

---

### Task 1 : Scaffolding Tauri 2 + React + Tailwind + shadcn/ui

**Files:**
- Create: projet complet via `npm create tauri-app` (template `react-ts`), puis config Tailwind + shadcn
- Modify: `src-tauri/tauri.conf.json` (identifiant app, taille fenêtre). **En complément (revue Task 1)** : Task 9 doit inclure l'init shadcn réel — variables CSS `--border`/`--background`/`--foreground` dans `index.css`, `src/lib/utils.ts` (cn) via `npx shadcn@latest init` ou manuellement + `components.json` (dép. clsx/tailwind-merge/cva déjà installées mais dormantes) ; et supprimer les résidus scaffold : `src/App.css`, `src/assets/react.svg`, favicon `public/vite.svg` dans `index.html` ; penser à durcir le CSP (`csp: null` par défaut du scaffold → `connect-src` fournisseurs) au moment du branchement réseau (Task 9/10).
- Create: `src/i18n/fr.ts`

**Interfaces:**
- Produces: un squelette d'app qui s'ouvre (`npm run tauri dev`), Vitest pas encore installé (Task 2), alias `@/` configuré.

- [ ] **Step 1: Créer le projet (PowerShell, dans `C:\dev`, le dossier `LogAssist` doit être vide de code si freshly scaffolded — le dépôt git existe déjà, conserver `docs/`)**

```powershell
cd C:\dev\LogAssist
npm create tauri-app@latest app-scaffold -- --template react-ts --manager npm --yes
# déplacer le contenu du scaffold dans la racine (fusion avec docs/, .git/)
```

Si le scaffold refuse de fusionner avec un dépôt existant : générer dans `%TEMP%` puis copier `app-scaffold/*` (sauf `.git/`) vers `C:\dev\LogAssist`.

- [ ] **Step 2: Installer les dépendances de base**

```powershell
cd C:\dev\LogAssist
npm install
npm install -D tailwindcss@3.4 postcss autoprefixer
npm install tailwindcss-animate class-variance-authority clsx tailwind-merge
npm install lucide-react
```

- [ ] **Step 3: Configurer Tailwind + alias `@/`**

`tailwind.config.js` (contenu complet, remplace celui généré) :

```js
/** @type {import('tailwindcss').Config} */
export default {
  darkMode: ["class"],
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: { border: "hsl(var(--border))", background: "hsl(var(--background))", foreground: "hsl(var(--foreground))" },
    },
  },
  plugins: [require("tailwindcss-animate")],
}
```

`postcss.config.js` :

```js
export default { plugins: { tailwindcss: {}, autoprefixer: {} } }
```

`tsconfig.json` — ajouter dans `compilerOptions` :

```json
"baseUrl": ".",
"paths": { "@/*": ["./src/*"] }
```

`vite.config.ts` — ajouter l'alias :

```ts
import path from "path"
// dans defineConfig :
resolve: { alias: { "@": path.resolve(__dirname, "./src") } }
```

- [ ] **Step 4: Vérifier l'ouverture de l'app**

Run: `npm run tauri dev`
Expected: une fenêtre s'ouvre, titre contenant « Tauri ». Fermer.

- [ ] **Step 5: Renseigner identifiant + fenêtre**

`src-tauri/tauri.conf.json` — champs à ajuster :

```json
{
  "productName": "LogAssist",
  "identifier": "fr.djodev.logassist",
  "app": {
    "windows": [{
      "title": "LogAssist",
      "width": 1200,
      "height": 800,
      "minWidth": 900,
      "minHeight": 600
    }]
  }
}
```

- [ ] **Step 6: Créer le module i18n initial**

`src/i18n/fr.ts` :

```ts
export const fr = {
  app: { title: "LogAssist" },
  sidebar: {
    newConversation: "Nouvelle conversation",
    search: "Rechercher…",
    general: "Générales",
    rename: "Renommer",
    archive: "Archiver",
    delete: "Supprimer",
  },
  chat: {
    placeholder: "Écrivez votre message… (Entrée pour envoyer, Maj+Entrée pour une nouvelle ligne)",
    send: "Envoyer",
    stop: "Interrompre",
    copy: "Copier",
    regenerate: "Régénérer",
    noConversation: "Sélectionnez ou créez une conversation",
  },
  errors: {
    auth: "Clé API invalide ou expirée",
    modelNotfound: "Modèle inexistant chez ce fournisseur",
    network: "Fournisseur injoignable — vérifiez l'URL et votre connexion",
    rateLimit: "Limite de débit atteinte",
    quota: "Quota ou crédit épuisé",
    unavailable: "Service momentanément indisponible",
    imageUnsupported: "Images non supportées par ce modèle",
    unknown: "Erreur inattendue du fournisseur",
  },
} as const
export type Dict = typeof fr
export const t = fr // point d'entrée unique (i18n complet en V1.1)
```

- [ ] **Step 7: Commit**

```powershell
git add -A
git commit -m "chore: scaffolding Tauri 2 + React + Tailwind + i18n fr"
```

---

### Task 2 : Vitest + test de sanité

**Files:**
- Create: `vitest.config.ts`, test d'erreurs **co-localisé nouveau en Task 3 : `src/lib/ai/errors.test.ts`**
- Modify: `package.json` (scripts)

**Interfaces:**
- Produces: commande `npm test` fonctionnelle utilisée par toutes les tâches suivantes.

- [ ] **Step 1: Installer Vitest**

```powershell
npm install -D vitest @vitest/coverage-v8 jsdom
```

`package.json` — scripts :

```json
"test": "vitest run",
"test:watch": "vitest"
```

- [ ] **Step 2: Créer `vitest.config.ts`**

```ts
import { defineConfig } from "vitest/config"
import path from "path"

export default defineConfig({
  resolve: { alias: { "@": path.resolve(__dirname, "./src") } },
  test: { environment: "node", include: ["src/**/*.test.ts"] },
})
```

- [ ] **Step 3: Test de sanité (fichier jetable) puis commit**

`src/sanity.test.ts` :

```ts
import { describe, it, expect } from "vitest"
import { t } from "@/i18n/fr"

describe("sanité", () => {
  it("charge l'i18n", () => {
    expect(t.app.title).toBe("LogAssist")
  })
})
```

Run: `npm test`
Expected: `1 passed`. Supprimer ensuite `src/sanity.test.ts`.

*(Note controller post-revue : le script `test` porte temporairement `--passWithNoTests` pour rester vert entre Task 2 et 3 ; à retirer dès le premier test permanent de Task 3. Le pattern `include` des tests acceptera aussi les `.tsx` et `vitest.config.ts` sera ajouté à `tsconfig.node.json` — suivi fait en Task 3.)*

```powershell
git add -A
git commit -m "chore: configuration Vitest"
```

---

### Task 3 : Types IA + taxonomie d'erreurs normalisée

**Files:**
- Create: `src/lib/ai/types.ts`, `src/lib/ai/errors.ts`
- Test: `src/lib/ai/errors.test.ts`

**Interfaces:**
- Produces (utilisé par Tasks 5, 6, 9, 10) :

```ts
export type ApiErrorKind = "auth" | "model_not_found" | "network" | "rate_limit" | "quota" | "unavailable" | "image_unsupported" | "unknown"
export class ApiError extends Error {
  kind: ApiErrorKind
  detail?: string
  retryAfterMs?: number
  constructor(kind, message, detail?, retryAfterMs?)
}
export function normalizeHttpStatus(status: number, body: string, retryAfterMs?: number): ApiError
export function normalizeNetworkError(err: unknown): ApiError | Error   // ApiError normalisée, ou l'AbortError d'origine (chaînes inaltérée) — le consommateur teste e.name === "AbortError"
export const API_ERROR_KINDS: ApiErrorKind[]                            // liste exportée des 8 kinds (garde-fou i18n)
export interface ChatMessage { role: "system" | "user" | "assistant"; content: string; images?: { base64: string; mimeType: string }[] }
export interface ChatRequest { messages: ChatMessage[]; timeoutMs?: number }
export interface StreamCallbacks { onFirstToken?: () => void; onDelta?: (text: string) => void; onDone?: (final: { text: string; firstTokenMs: number; totalMs: number }) => void; onError?: (e: Error) => void } // ApiError ou AbortError — TODO Task 5 : distinguer timeout (AbortSignal.timeout) et interruption volontaire via signal.reason, sinon Task 9 affichera un timeout comme interruption silencieuse
export interface ProviderConfig { id: string; name: string; apiFamily: "openai" | "gemini"; baseUrl: string; secretRef: string }
export interface ModelConfig { id: string; providerId: string; modelId: string; supportsImages: boolean; isDefault: boolean }
```

- [ ] **Step 1: Écrire le test qui échoue**

`src/lib/ai/errors.test.ts` :

```ts
import { describe, it, expect } from "vitest"
import { normalizeHttpStatus, normalizeNetworkError, ApiError } from "@/lib/ai/errors"

describe("normalizeHttpStatus", () => {
  it("401 → auth", () => {
    const e = normalizeHttpStatus(401, '{"error":"bad key"}')
    expect(e.kind).toBe("auth")
    expect(e.detail).toContain("bad key")
  })
  it("403 → auth", () => { expect(normalizeHttpStatus(403, "").kind).toBe("auth") })
  it("404 → model_not_found", () => { expect(normalizeHttpStatus(404, "").kind).toBe("model_not_found") })
  it("429 avec retry-after → rate_limit et retryAfterMs", () => {
    const e = normalizeHttpStatus(429, "", 800)
    expect(e.kind).toBe("rate_limit")
    expect(e.retryAfterMs).toBe(800)
  })
  it("429 avec quota dans le corps / 402 → quota", () => {
    expect(normalizeHttpStatus(429, "insufficient_quota").kind).toBe("quota")
    expect(normalizeHttpStatus(402, "").kind).toBe("quota")
  })
  it("5xx → unavailable", () => {
    expect(normalizeHttpStatus(503, "").kind).toBe("unavailable")
    expect(normalizeHttpStatus(500, "").kind).toBe("unavailable")
  })
  it("400 avec image dans le corps → image_unsupported", () => {
    expect(normalizeHttpStatus(400, "image not supported").kind).toBe("image_unsupported")
  })
  it("400 sans motif connu → unknown avec détail", () => {
    const e = normalizeHttpStatus(400, '{"error": {"message": "foo"}}')
    expect(e.kind).toBe("unknown")
    expect(e.detail).toContain("foo")
  })
})

describe("normalizeNetworkError", () => {
  it("ECONNREFUSED → network", () => { expect(normalizeNetworkError(new Error("fetch failed: ECONNREFUSED")).kind).toBe("network") })
  it("AbortError propagé tel quel (flux interrompu volontaire ≠ erreur)", () => {
    const abort = new Error("aborted"); abort.name = "AbortError"
    expect(normalizeNetworkError(abort)).toBe(abort)
  })
  it("erreur inconnue → kind unknown", () => {
    expect(normalizeNetworkError("boom").kind).toBe("unknown")
  })
})

describe("ApiError", () => {
  it("porte kind, detail, retryAfterMs", () => {
    const e = new ApiError("quota", "q", "détail", 100)
    expect(e.kind).toBe("quota"); expect(e.detail).toBe("détail"); expect(e.retryAfterMs).toBe(100)
  })
})
```

- [ ] **Step 2: Vérifier l'échec**

Run: `npm test`
Expected: FAIL — « Cannot find module '@/lib/ai/errors' »

- [ ] **Step 3: Implémenter `src/lib/ai/types.ts`**

```ts
export type ApiErrorKind =
  | "auth" | "model_not_found" | "network" | "rate_limit" | "quota"
  | "unavailable" | "image_unsupported" | "unknown"

export interface ChatMessage {
  role: "system" | "user" | "assistant"
  content: string
  images?: { base64: string; mimeType: string }[]
}

export interface ChatRequest { messages: ChatMessage[]; timeoutMs?: number }

export interface CompletionStats { text: string; firstTokenMs: number; totalMs: number }

export interface StreamCallbacks {
  onFirstToken?: () => void
  onDelta?: (text: string) => void
  onDone?: (stats: CompletionStats) => void
  onError?: (e: Error) => void // ApiError ou AbortError — TODO Task 5 : distinguer timeout (AbortSignal.timeout) et interruption volontaire via signal.reason
}

export interface ProviderConfig {
  id: string
  name: string
  apiFamily: "openai" | "gemini"
  baseUrl: string
  secretRef: string // identifiant Credential Manager, pas la clé
}

export interface ModelConfig {
  id: string
  providerId: string
  modelId: string
  supportsImages: boolean
  isDefault: boolean
}
```

- [ ] **Step 4: Implémenter `src/lib/ai/errors.ts`**

```ts
import type { ApiErrorKind } from "./types"

export class ApiError extends Error {
  kind: ApiErrorKind
  detail?: string
  retryAfterMs?: number

  constructor(kind: ApiErrorKind, message: string, detail?: string, retryAfterMs?: number) {
    super(message)
    this.name = "ApiError"
    this.kind = kind
    this.detail = detail
    this.retryAfterMs = retryAfterMs
  }
}

const QUOTA_HINTS = ["quota", "credit", "billing", "insufficient"]
const IMAGE_HINTS = ["image", "vision", "multimod"]

export function normalizeHttpStatus(status: number, body: string, retryAfterMs?: number): ApiError {
  const lower = body.toLowerCase()
  const detail = body.slice(0, 500) || undefined

  if (status === 401 || status === 403) return new ApiError("auth", "Clé API invalide ou expirée", detail)
  if (status === 404) return new ApiError("model_not_found", "Modèle inexistant chez ce fournisseur", detail)
  if (status === 429) {
    if (QUOTA_HINTS.some((h) => lower.includes(h)))
      return new ApiError("quota", "Quota ou crédit épuisé", detail)
    return new ApiError("rate_limit", "Limite de débit atteinte", detail, retryAfterMs)
  }
  if (status === 402) return new ApiError("quota", "Quota ou crédit épuisé", detail)
  if (status >= 500) return new ApiError("unavailable", "Service momentanément indisponible", detail)
  if (status >= 400) {
    if (IMAGE_HINTS.some((h) => lower.includes(h)))
      return new ApiError("image_unsupported", "Images non supportées par ce modèle", detail)
    return new ApiError("unknown", "Erreur inattendue du fournisseur", detail)
  }
  return new ApiError("unknown", "Erreur inattendue du fournisseur", detail)
}

export function normalizeNetworkError(err: unknown): Error {
  if (err instanceof Error && err.name === "AbortError") return err
  const msg = err instanceof Error ? err.message : String(err)
  if (/econnrefused|fetch failed|timeout|connect|dns|network/i.test(msg))
    return new ApiError("network", "Fournisseur injoignable — vérifiez l'URL et votre connexion", msg)
  return new ApiError("unknown", "Erreur inattendue du fournisseur", msg)
}
```

- [ ] **Step 5: Vérifier le passage**

Run: `npm test`
Expected: PASS (tous les tests `errors.test.ts`)

- [ ] **Step 6: Commit**

```powershell
git add src/lib/ai
git commit -m "feat: taxonomie d'erreurs API normalisée + types IA"
```

---

### Task 4 : Schéma SQLite + service conversations

**Files:**
- Create: `src/lib/db/migrations.ts`, `src/lib/db/database.ts`, `src/lib/db/conversations.ts`
- Test: `src/lib/db/conversations.test.ts`
- Modify: `src-tauri/Cargo.toml` + `src-tauri/src/lib.rs` (plugin sql)

**Interfaces:**
- Consumes: rien.
- Produces (utilisé par Tasks 9, 10) :

```ts
// database.ts
export async function getDb(): Promise<Database>          // charge 'sqlite:logassist.db' + exécute migrations une fois
export function execute(sql: string, bind?: unknown[]): Promise<QueryResult>
export function select<T>(sql: string, bind?: unknown[]): Promise<T[]>

// conversations.ts
export interface ConversationRow { id: string; project_id: string | null; title: string; archived: number; created_at: string; updated_at: string }
export const conversations = {
  create(title: string): Promise<ConversationRow>,
  list(includeArchived?: boolean): Promise<ConversationRow[]>,
  rename(id: string, title: string): Promise<void>,
  setArchived(id: string, archived: boolean): Promise<void>,
  remove(id: string): Promise<void>,
  setProject(id: string, projectId: string | null): Promise<void>,
  touch(id: string): Promise<void>,
}
```

- [ ] **Step 1: Installer le plugin côté Tauri (PowerShell)**

```powershell
npm install @tauri-apps/plugin-sql
cd src-tauri
cargo add tauri-plugin-sql --features sqlite
```

`src-tauri/src/lib.rs` — enregistrer le plugin :

```rust
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_sql::Builder::default().build())
        .invoke_handler(tauri::generate_handler![...])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
```

(ne garder l'invoke_handler existant que si déjà rempli — Task 7 y ajoutera les secrets)

- [ ] **Step 2: Écrire le test qui échoue**

`src/lib/db/conversations.test.ts` — mock du plugin pour piloter un mini-fake ; on vérifie le SQL émis + le mapping :

```ts
import { describe, it, expect, vi, beforeEach } from "vitest"

const mockDb = { execute: vi.fn(), select: vi.fn() }
vi.mock("@tauri-apps/plugin-sql", () => ({ default: { Database: { load: vi.fn().mockResolvedValue(mockDb) } } }))

import { conversations } from "@/lib/db/conversations"

beforeEach(() => { vi.clearAllMocks() })

describe("conversations.create", () => {
  it("insère avec un id uuid v4 et retourne la row", async () => {
    mockDb.execute.mockResolvedValueOnce({ rowsAffected: 1 })
    const row = await conversations.create("Apprendre HISE")
    expect(row.title).toBe("Apprendre HISE")
    expect(row.id).toMatch(/^[0-9a-f-]{36}$/)
    const [sql, bind] = mockDb.execute.mock.calls[0]
    expect(sql).toContain("INSERT INTO conversations")
    expect(bind[0]).toBe(row.id)
  })
})

describe("conversations.list", () => {
  it("exclut les archivées par défaut et mappe archived en booléen-friendly numérique", async () => {
    mockDb.select.mockResolvedValueOnce([{ id: "a", project_id: null, title: "T", archived: 0, created_at: "x", updated_at: "y" }])
    const rows = await conversations.list()
    const [sql] = mockDb.select.mock.calls[0]
    expect(sql).toContain("archived = 0")
    expect(rows[0].id).toBe("a")
  })
  it("includeArchived=true ne filtre pas", async () => {
    mockDb.select.mockResolvedValueOnce([])
    await conversations.list(true)
    expect(mockDb.select.mock.calls[0][0]).not.toContain("archived = 0")
  })
})

describe("conversations.rename / setArchived / remove / setProject", () => {
  it("émet les UPDATE/DELETE attendus", async () => {
    mockDb.execute.mockResolvedValue({ rowsAffected: 1 })
    await conversations.rename("id1", "Nouveau titre")
    expect(mockDb.execute.mock.calls[0][0]).toContain("UPDATE conversations SET title")
    await conversations.setArchived("id1", true)
    expect(mockDb.execute.mock.calls[1][0]).toContain("UPDATE conversations SET archived")
    await conversations.setProject("id1", "p1")
    expect(mockDb.execute.mock.calls[2][0]).toContain("UPDATE conversations SET project_id")
    await conversations.remove("id1")
    expect(mockDb.execute.mock.calls[3][0]).toContain("DELETE FROM conversations WHERE id =")
  })
})
```

- [ ] **Step 3: Vérifier l'échec**

Run: `npm test`
Expected: FAIL — module `@/lib/db/conversations` introuvable

- [ ] **Step 4: Implémenter `src/lib/db/migrations.ts`**

```ts
export const SCHEMA_VERSION = 1

export const SCHEMA_V1 = `
CREATE TABLE IF NOT EXISTS providers (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  api_family TEXT NOT NULL CHECK (api_family IN ('openai','gemini')),
  base_url TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS models (
  id TEXT PRIMARY KEY,
  provider_id TEXT NOT NULL REFERENCES providers(id) ON DELETE CASCADE,
  model_id TEXT NOT NULL,
  supports_images INTEGER NOT NULL DEFAULT 0,
  is_default INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS conversations (
  id TEXT PRIMARY KEY,
  project_id TEXT,
  title TEXT NOT NULL,
  archived INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS messages (
  id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('system','user','assistant')),
  content TEXT NOT NULL,
  attachments TEXT NOT NULL DEFAULT '[]',
  model_label TEXT,
  latency_ms INTEGER,
  error TEXT
);
CREATE TABLE IF NOT EXISTS images (
  id TEXT PRIMARY KEY,
  filename TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  software TEXT NOT NULL DEFAULT '',
  software_version TEXT NOT NULL DEFAULT '',
  goal TEXT NOT NULL DEFAULT '',
  context_md TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS profiles (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  instructions_md TEXT NOT NULL DEFAULT '',
  is_builtin INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_messages_conversation ON messages(conversation_id);
CREATE INDEX IF NOT EXISTS idx_conversations_project ON conversations(project_id);
`
```

- [ ] **Step 5: Implémenter `src/lib/db/database.ts`**

```ts
import Database from "@tauri-apps/plugin-sql"
import { SCHEMA_V1, SCHEMA_VERSION } from "./migrations"

let dbPromise: Promise<Database> | null = null

export function getDb(): Promise<Database> {
  if (!dbPromise) dbPromise = init()
  return dbPromise
}

async function init(): Promise<Database> {
  const db = await Database.load("sqlite:logassist.db")
  const rows = await db.select<{ user_version: number }[]>(["PRAGMA user_version"]) as never as { user_version: number }[]
  const version = (rows as unknown as { user_version: number }[])[0]?.user_version ?? 0
  if (version < SCHEMA_VERSION) {
    await db.execute(SCHEMA_V1)
    await db.execute(`PRAGMA user_version = ${SCHEMA_VERSION}`)
  }
  return db
}

export async function execute(sql: string, bind: unknown[] = []): Promise<void> {
  const db = await getDb()
  await db.execute(sql, bind)
}

export async function select<T>(sql: string, bind: unknown[] = []): Promise<T[]> {
  const db = await getDb()
  return (await db.select(sql, bind)) as T[]
}
```

(`PRAGMA` via `select` car `execute` ne renvoie pas de lignes sur ce plugin — si le plugin rejette `PRAGMA` en select, utiliser `db.select` avec cast ; à ajuster en implémentation, comportement du plugin documenté : SELECT renvoie des lignes objet.)

- [ ] **Step 6: Implémenter `src/lib/db/conversations.ts`**

```ts
import { execute, select } from "./database"

export interface ConversationRow {
  id: string
  project_id: string | null
  title: string
  archived: number
  created_at: string
  updated_at: string
}

function uuid(): string {
  return crypto.randomUUID()
}

export const conversations = {
  async create(title = "Nouvelle conversation"): Promise<ConversationRow> {
    const row: ConversationRow = {
      id: uuid(), project_id: null, title, archived: 0,
      created_at: new Date().toISOString().slice(0, 19).replace("T", " "),
      updated_at: new Date().toISOString().slice(0, 19).replace("T", " "),
    }
    await execute(
      "INSERT INTO conversations (id, project_id, title, archived, created_at, updated_at) VALUES (?,?,?,0,?,?)",
      [row.id, row.project_id, row.title, row.created_at, row.updated_at],
    )
    return row
  },

  async list(includeArchived = false): Promise<ConversationRow[]> {
    const sql = includeArchived
      ? "SELECT * FROM conversations ORDER BY updated_at DESC"
      : "SELECT * FROM conversations WHERE archived = 0 ORDER BY updated_at DESC"
    return select<ConversationRow>(sql)
  },

  async rename(id: string, title: string): Promise<void> {
    await execute("UPDATE conversations SET title = ?, updated_at = datetime('now') WHERE id = ?", [title, id])
  },

  async setArchived(id: string, archived: boolean): Promise<void> {
    await execute("UPDATE conversations SET archived = ?, updated_at = datetime('now') WHERE id = ?", [archived ? 1 : 0, id])
  },

  async setProject(id: string, projectId: string | null): Promise<void> {
    await execute("UPDATE conversations SET project_id = ?, updated_at = datetime('now') WHERE id = ?", [projectId, id])
  },

  async touch(id: string): Promise<void> {
    await execute("UPDATE conversations SET updated_at = datetime('now') WHERE id = ?", [id])
  },

  async remove(id: string): Promise<void> {
    await execute("DELETE FROM conversations WHERE id = ?", [id])
  },
}
```

- [ ] **Step 7: Vérifier le passage**

Run: `npm test`
Expected: PASS (conversations.test.ts)

- [ ] **Step 8: Vérification manuelle du schéma réel**

Run: `npm run tauri dev` puis dans un terminal PowerShell... Alternative fiable : ajouter temporairement sur le clic d'un bouton console.log(await conversations.create("test")). Vérifier `%APPDATA%\fr.djodev.logassist\logassist.db` créé. (Le chemin par défaut de plugin-sql est le répertoire de l'app.)

Expected: fichier db présent, 8 tables.

- [ ] **Step 9: Commit**

```powershell
git add -A
git commit -m "feat: schéma SQLite v1 + service conversations"
```

---

### Task 5 : Adaptateur OpenAI-compatible — complete() + testConnection() + factory

**Files:**
- Create: `src/lib/ai/openai-compat.ts`, `src/lib/ai/factory.ts`
- Test: `src/lib/ai/openai-compat.test.ts`

**Interfaces:**
- Consumes: `ApiError`, `normalizeHttpStatus`, `normalizeNetworkError` (Task 3), `ProviderConfig`, `ModelConfig`, `ChatRequest` (Task 3).
- Produces (Task 6, 9, 10) :

```ts
export interface IProvider {
  complete(req: ChatRequest, apiKey: string): Promise<{ text: string; totalMs: number }>
  stream(req: ChatRequest, apiKey: string, cb: StreamCallbacks, signal: AbortSignal): Promise<void>
  testConnection(apiKey: string): Promise<{ ok: boolean; error?: ApiError }>
}
export function createOpenAICompatible(cfg: ProviderConfig): IProvider
export function createProvider(cfg: ProviderConfig): IProvider  // switch sur apiFamily ; gemini → lance "V2" en attendant
export function buildPreview(providerName: string, modelLabel: string): string // "Fournisseur › modèle"
```

**Note clé** : la clé est **passée à chaque appel** (récupérée au moment de l'appel via le service secrets, Task 7) — l'adaptateur ne la stocke pas.

- [ ] **Step 1: Écrire le test qui échoue**

`src/lib/ai/openai-compat.test.ts` :

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { createOpenAICompatible, createProvider } from "@/lib/ai/openai-compat"
import { ApiError } from "@/lib/ai/errors"

const CFG = { id: "p1", name: "OpenRouter", apiFamily: "openai" as const, baseUrl: "https://or.test/v1", secretRef: "ref1" }

// helper: Response-like minimal
function fakeRes(opts: { status?: number; ok?: boolean; body?: unknown; raw?: string }) {
  const { status = 200, ok = status < 400, body, raw } = opts
  return {
    ok, status,
    json: () => Promise.resolve(body),
    text: () => Promise.resolve(raw ?? JSON.stringify(body ?? {})),
    headers: new Map(),
  }
}

beforeEach(() => { vi.stubGlobal("fetch", vi.fn()) })
afterEach(() => { vi.unstubAllGlobals() })

describe("complete()", () => {
  it("POST /chat/completions avec model, messages, et renvoie le texte", async () => {
    const p = createOpenAICompatible(CFG)
    vi.mocked(fetch).mockResolvedValueOnce(fakeRes({
      body: { choices: [{ message: { content: "Bonjour" } }] },
    }))
    const r = await p.complete({ messages: [{ role: "user", content: "salut" }] }, "KEY")
    expect(r.text).toBe("Bonjour")
    const [url, init] = vi.mocked(fetch).mock.calls[0]
    expect(String(url)).toContain("https://or.test/v1/chat/completions")
    const sent = JSON.parse(init.body)
    expect(sent.model).toBe("test-model")
    expect(sent.messages[0].content).toBe("salut")
    expect(init.headers.Authorization).toBe("Bearer KEY")
    expect(r.totalMs).toBeGreaterThanOrEqual(0)
  })

  it("complete passe le modelId explicitement", async () => {
    const p = createOpenAICompatible(CFG)
    vi.mocked(fetch).mockResolvedValueOnce(fakeRes({ body: { choices: [{ message: { content: "" } }] } }))
    await p.complete({ messages: [{ role: "user", content: "x" }] }, "KEY", "other-model")
    expect(JSON.parse(vi.mocked(fetch).mock.calls[0][1].body).model).toBe("other-model")
  })

  it("401 → ApiError kind auth", async () => {
    const p = createOpenAICompatible(CFG)
    vi.mocked(fetch).mockResolvedValueOnce(fakeRes({ status: 401, raw: "bad key" }))
    await expect(p.complete({ messages: [] }, "KEY")).rejects.toMatchObject({ kind: "auth" })
  })

  it("429 + Retry-After 800ms → rate_limit/retryAfterMs", async () => {
    const p = createOpenAICompatible(CFG)
    const res = fakeRes({ status: 429, raw: "rate limited" })
    res.headers = new Map([["retry-after", "0.8"]]) as never
    vi.mocked(fetch).mockResolvedValueOnce(res)
    await expect(p.complete({ messages: [] }, "KEY")).rejects.toMatchObject({ kind: "rate_limit", retryAfterMs: 800 })
  })

  it("fetch échoué → kind network", async () => {
    const p = createOpenAICompatible(CFG)
    vi.mocked(fetch).mockRejectedValueOnce(new Error("fetch failed"))
    await expect(p.complete({ messages: [] }, "KEY")).rejects.toMatchObject({ kind: "network" })
  })
})

describe("testConnection()", () => {
  it("ok sur 200 GET /models", async () => {
    const p = createOpenAICompatible(CFG)
    vi.mocked(fetch).mockResolvedValueOnce(fakeRes({ body: { data: [] } }))
    const r = await p.testConnection("KEY")
    expect(r.ok).toBe(true)
    expect(String(vi.mocked(fetch).mock.calls[0][0])).toContain("/models")
    expect(vi.mocked(fetch).mock.calls[0][1].headers.Authorization).toBe("Bearer KEY")
  })
  it("erreur normalisée : ok=false + ApiError", async () => {
    const p = createOpenAICompatible(CFG)
    vi.mocked(fetch).mockResolvedValueOnce(fakeRes({ status: 401, raw: "nope" }))
    const r = await p.testConnection("BAD")
    expect(r.ok).toBe(false)
    expect(r.error).toBeInstanceOf(ApiError)
    expect(r.error!.kind).toBe("auth")
  })
})

describe("createProvider", () => {
  it("openai → OpenAICompatible", () => { expect(createProvider(CFG)).toBeDefined() })
  it("gemini → erreur explicite V2", () => {
    expect(() => createProvider({ ...CFG, apiFamily: "gemini" }))
      .toThrow(/Google Gemini.*V2|V2.*Gemini/)
  })
})
```

(Remarque : adapter le helper selon la forme réelle de `fetch` mockée ; l'important est le SQL/HTTP émis.)

- [ ] **Step 2: Vérifier l'échec**

Run: `npm test`
Expected: FAIL — `openai-compat` introuvable

- [ ] **Step 3: Implémenter `src/lib/ai/openai-compat.ts`**

```ts
import { ApiError, normalizeHttpStatus, normalizeNetworkError } from "./errors"
import type { ChatRequest, ModelConfig, ProviderConfig, StreamCallbacks } from "./types"

interface IProvider {
  complete(req: ChatRequest, apiKey: string, modelId: string): Promise<{ text: string; totalMs: number }>
  stream(req: ChatRequest, apiKey: string, modelId: string, cb: StreamCallbacks, signal: AbortSignal): Promise<void>
  testConnection(apiKey: string): Promise<{ ok: boolean; error?: ApiError }>
}

export type { IProvider }

function retryAfterMs(headers: Headers): number | undefined {
  const v = headers.get("retry-after")
  if (!v) return undefined
  const n = Number(v)
  return Number.isFinite(n) ? Math.round(n * 1000) : undefined
}

export function createOpenAICompatible(cfg: ProviderConfig): IProvider {
  const base = cfg.baseUrl.replace(/\/+$/, "")

  async function request(req: ChatRequest, apiKey: string, modelId: string, stream: boolean, signal?: AbortSignal) {
    const messages = req.messages.map((m) => ({
      role: m.role,
      content: m.images?.length
        ? [
            { type: "text", text: m.content },
            ...m.images.map((i) => ({ type: "image_url", image_url: { url: `data:${i.mimeType};base64,${i.base64}` } })),
          ]
        : m.content,
    }))
    return fetch(`${base}/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({ model: modelId, messages, stream }),
      signal,
    })
  }

  return {
    async complete(req, apiKey, modelId) {
      const start = performance.now()
      try {
        const res = await request(req, apiKey, modelId, false)
        if (!res.ok) {
          const body = await res.text()
          throw normalizeHttpStatus(res.status, body, retryAfterMs(res.headers))
        }
        const data = await res.json()
        const text: string = data?.choices?.[0]?.message?.content ?? ""
        return { text, totalMs: performance.now() - start }
      } catch (e) {
        if (e instanceof ApiError) throw e
        throw normalizeNetworkError(e)
      }
    },

    async stream(req, apiKey, modelId, cb, signal) {
      const start = performance.now()
      let firstTokenMs = 0
      let acc = ""
      try {
        const res = await request(req, apiKey, modelId, true, signal)
        if (!res.ok) {
          const body = await res.text()
          throw normalizeHttpStatus(res.status, body, retryAfterMs(res.headers))
        }
        if (!res.body) throw new ApiError("unknown", "Réponse vide du fournisseur")
        const reader = res.body.getReader()
        const decoder = new TextDecoder()
        let buf = ""
        for (;;) {
          const { done, value } = await reader.read()
          if (done) break
          buf += decoder.decode(value, { stream: true })
          const lines = buf.split("\n")
          buf = lines.pop() ?? ""
          for (const line of lines) {
            const clean = line.replace(/^data: /, "").trim()
            if (!clean || clean === "[DONE]") continue
            try {
              const chunk = JSON.parse(clean)
              const delta: string = chunk?.choices?.[0]?.delta?.content ?? ""
              if (delta) {
                if (!firstTokenMs) { firstTokenMs = performance.now() - start; cb.onFirstToken?.() }
                acc += delta
                cb.onDelta?.(delta)
              }
            } catch { /* ligne partialle ignorée */ }
          }
        }
        cb.onDone?.({ text: acc, firstTokenMs, totalMs: performance.now() - start })
      } catch (e: unknown) {
        cb.onError?.(e instanceof Error ? e : new Error(String(e)))
      }
    },

    async testConnection(apiKey) {
      try {
        const res = await fetch(`${base}/models`, { headers: { Authorization: `Bearer ${apiKey}` } })
        if (!res.ok) {
          const body = await res.text()
          return { ok: false, error: normalizeHttpStatus(res.status, body, retryAfterMs(res.headers)) }
        }
        return { ok: true }
      } catch (e) {
        return { ok: false, error: normalizeNetworkError(e) as ApiError }
      }
    },
  }
}

export function createProvider(cfg: ProviderConfig): IProvider {
  if (cfg.apiFamily === "gemini") {
    throw new Error("L'adaptateur Google Gemini arrive en V2 (Plan 2). Utilisez un fournisseur openai-compatible pour le moment.")
  }
  return createOpenAICompatible(cfg)
}

export function buildPreview(providerName: string, modelLabel: string): string {
  return `${providerName} › ${modelLabel}`
}
```

- [ ] **Step 4: Adapter le test à la signature exacte** (complete/stream prennent `modelId` explicite) — réécrire les appels de test en conséquence, ex. `p.complete({ messages: [...] }, "KEY", "test-model")`. Ajuster le test « model optionnel » : le modelId explicite remplace `sent.model`.

- [ ] **Step 5: Créer `src/lib/ai/factory.ts`** (ré-export canonique)

```ts
export { createProvider, createOpenAICompatible, buildPreview, type IProvider } from "./openai-compat"
```

- [ ] **Step 6: Vérifier le passage**

Run: `npm test`
Expected: PASS

- [ ] **Step 7: Commit**

```powershell
git add src/lib/ai
git commit -m "feat: adaptateur OpenAI-compatible (complete, stream, testConnection)"
```

---

### Task 6 : Streaming SSE — découpage dans l'adaptateur (étape suivante du même fichier)

**Files:**
- Test: `src/lib/ai/sse.test.ts`
- Create: `src/lib/ai/sse.ts`

**Interfaces:**
- Consumes: rien (utilitaire pur).
- Produces (utilisé par openai-compat.stream refactorisé et l'UI Task 9) :

```ts
export interface SseChunk { event: string | null; data: string }
export function parseSseStream(reader: ReadableStreamDefaultReader<Uint8Array>, onChunk: (c: SseChunk) => Promise<void> | void): Promise<void>
```

Objectif : extraire le parsing SSE réutilisable (Gemini en Plan 2 le réutilisera), le refactoriser depuis `openai-compat.ts`.

- [ ] **Step 1: Écrire le test qui échoue (mock ReadableStream)**

`src/lib/ai/sse.test.ts` :

```ts
import { describe, it, expect } from "vitest"
import { parseSseStream } from "@/lib/ai/sse"

function streamFrom(lines: string[]): { stream: ReadableStream<Uint8Array> } {
  const enc = new TextEncoder()
  return { stream: new ReadableStream({
    start(c) {
      for (const l of lines) c.enqueue(enc.encode(l))
      c.close()
    },
  }) }
}

describe("parseSseStream", () => {
  it("émet les chunks data: et gère les messages scindés", async () => {
    const { stream } = streamFrom([
      'data: {"a":1}\n', 'data: {"b":', '2}\n\n', "event: ping\n", "data: heartbeat\n\n", "data: [DONE]\n",
    ])
    const chunks: string[] = []
    const events: (string | null)[] = []
    await parseSseStream(stream.getReader(), async (c) => { chunks.push(c.data); events.push(c.event) })
    expect(chunks).toEqual(['{"a":1}', '{"b":2}', "heartbeat"])
    expect(events).toEqual([null, null, "ping"])
  })

  it("absorbe les lignes vides et les commentaires", async () => {
    const { stream } = streamFrom(["\n", ":keepalive\n", "data: x\n\n"])
    const chunks: string[] = []
    await parseSseStream(stream.getReader(), async (c) => chunks.push(c.data))
    expect(chunks).toEqual(["x"])
  })
})
```

- [ ] **Step 2: Vérifier l'échec** — Run `npm test` → FAIL (module absent)

- [ ] **Step 3: Implémenter `src/lib/ai/sse.ts`**

```ts
export interface SseChunk { event: string | null; data: string }

export async function parseSseStream(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  onChunk: (c: SseChunk) => Promise<void> | void,
): Promise<void> {
  const decoder = new TextDecoder()
  let buf = ""
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    buf += decoder.decode(value, { stream: true })
    const parts = buf.split("\n\n")
    buf = parts.pop() ?? ""
    for (const part of parts) {
      let event: string | null = null
      const dataLines: string[] = []
      for (const line of part.split("\n")) {
        if (line.startsWith(":") || line.trim() === "") continue
        if (line.startsWith("event:")) event = line.slice(6).trim()
        if (line.startsWith("data:")) dataLines.push(line.slice(5).trim())
      }
      if (dataLines.length) await onChunk({ event, data: dataLines.join("\n") })
    }
  }
}
```

- [ ] **Step 4: Refactoriser `openai-compat.ts`.stream() pour utiliser parseSseStream** (remplace le split manuel ; `[DONE]` filtré dans l'adaptateur, pas dans le parseur générique).

- [ ] **Step 5: Vérifier le passage**

Run: `npm test`
Expected: PASS (sse.test.ts + openai-compat.test.ts)

- [ ] **Step 6: Commit**

```powershell
git add src/lib/ai
git commit -m "feat: parseur SSE réutilisable + refactor streaming adaptateur"
```

---

### Task 7 : Commandes Rust pour secrets (keyring) + service TS

**Files:**
- Create: `src-tauri/src/commands/secrets.rs`, `src/lib/secrets/service.ts` (wrapper TS)
- Modify: `src-tauri/src/lib.rs` (enregistrement), `src-tauri/Cargo.toml` (keyring)
- Test: manuel ciblé (Cargo ne mock pas la plateforme Credential ; les erreurs sont remontées en Result)

**Interfaces:**
- Produces (Task 9, 10) :

```ts
// src/lib/secrets/service.ts
export const secrets = {
  set(secretRef: string, value: string): Promise<void>,
  get(secretRef: string): Promise<string | null>,   // null si absent
  remove(secretRef: string): Promise<void>,
}
```

Convention `secretRef` : `logassist/provider/<provider_id>` — stocké en base côté providers, clé réelle dans Credential Manager.

- [ ] **Step 1: Ajouter la dépendance**

```powershell
cd src-tauri
cargo add keyring@3 --features windows-native
cargo add base64@0.22
```

(Remplacer si nécessaire par `windows-native` selon les features documentées de keyring v3.)

- [ ] **Step 2: Implémenter `src-tauri/src/commands/secrets.rs`**

```rust
use keyring::Entry;
use tauri::command;

const SERVICE: &str = "LogAssist";

fn entry(secret_ref: &str) -> Result<Entry, String> {
    Entry::new(SERVICE, secret_ref).map_err(|e| e.to_string())
}

#[command]
pub fn set_secret(secret_ref: String, value: String) -> Result<(), String> {
    entry(&secret_ref)?.set_password(&value).map_err(|e| e.to_string())
}

#[command]
pub fn get_secret(secret_ref: String) -> Result<Option<String>, String> {
    match entry(&secret_ref)?.get_password() {
        Ok(v) => Ok(Some(v)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(e) => Err(e.to_string()),
    }
}

#[command]
pub fn delete_secret(secret_ref: String) -> Result<(), String> {
    match entry(&secret_ref)?.delete_credential() {
        Ok(()) => Ok(()),
        Err(keyring::Error::NoEntry) => Ok(()), // idempotent
        Err(e) => Err(e.to_string()),
    }
}
```

- [ ] **Step 3: Enregistrer dans `src-tauri/src/lib.rs`**

```rust
mod commands;
use commands::secrets::{set_secret, get_secret, delete_secret};

// dans Builder :
.invoke_handler(tauri::generate_handler![set_secret, get_secret, delete_secret])
```

- [ ] **Step 4: Vérifier la compilation**

Run: `cargo check` (dans `src-tauri/`)
Expected: `Finished` sans erreur

- [ ] **Step 5: Wrapper TS `src/lib/secrets/service.ts`**

```ts
import { invoke } from "@tauri-apps/api/core"

export const secrets = {
  set: (secretRef: string, value: string) => invoke<void>("set_secret", { secretRef, value }),
  get: async (secretRef: string): Promise<string | null> => invoke<string | null>("get_secret", { secretRef }),
  remove: (secretRef: string) => invoke<void>("delete_secret", { secretRef }),
}
```

- [ ] **Step 6: Vérification manuelle ciblée (PowerShell : le Credential Manager est Windows-only)**

Ajouter temporairement dans `src/App.tsx` un bouton de test (à retirer après vérification) :

```tsx
import { invoke } from "@tauri-apps/api/core"

// dans un coin de l'app, temporairement :
<button onClick={async () => {
  await invoke("set_secret", { secretRef: "logassist/test", value: "abc123" })
  const back = await invoke<string | null>("get_secret", { secretRef: "logassist/test" })
  console.log("secret lu :", back === "abc123" ? "OK" : "KO", "(jamais la valeur réelle)")
  await invoke("delete_secret", { secretRef: "logassist/test" })
  const gone = await invoke<string | null>("get_secret", { secretRef: "logassist/test" })
  console.log("secret supprimé :", gone === null ? "OK" : "KO")
}}>test secrets</button>
```

Expected: console = « OK / OK » ; Gestionnaire d'identifiants Windows (Panneau de configuration → Identifiants génériques) montre temporairement une entrée `LogAssist`. Aucune valeur de clé loguée.

- [ ] **Step 7: Commit**

```powershell
git add -A
git commit -m "feat: secrets via Credential Manager (keyring) + wrapper TS"
```

---

### Task 8 : Composition du prompt système

**Files:**
- Create: `src/lib/prompts/compose.ts`, `src/lib/prompts/defaults.ts`
- Test: `src/lib/prompts/compose.test.ts`

**Interfaces:**
- Produces (Task 9) :

```ts
export function buildSystemPrompt(input: { general: string; profile: string; project?: string }): string
export const DEFAULT_GENERAL_INSTRUCTIONS: string   // texte pédagogique prérempli
export const PROFILE_APPRENTISSAGE: string
```

- [ ] **Step 1: Écrire le test qui échoue**

`src/lib/prompts/compose.test.ts` :

```ts
import { describe, it, expect } from "vitest"
import { buildSystemPrompt } from "@/lib/prompts/compose"

describe("buildSystemPrompt", () => {
  it("assemble général + profil + projet dans le bon ordre", () => {
    const p = buildSystemPrompt({ general: "GEN", profile: "PROF", project: "PROJ" })
    expect(p).toContain("## Instructions générales")
    expect(p.indexOf("GEN")).toBeLessThan(p.indexOf("## Profil"))
    expect(p.indexOf("PROF")).toBeLessThan(p.indexOf("## Projet"))
    expect(p.indexOf("PROJ")).toBeLessThan(p.length)
  })
  it("omet les sections vides/inexistantes", () => {
    const p = buildSystemPrompt({ general: "GEN", profile: "" })
    expect(p).toContain("GEN")
    expect(p).not.toContain("## Profil")
    expect(p).not.toContain("## Projet")
  })
  it("retourne une chaîne vide si tout est vide", () => {
    expect(buildSystemPrompt({ general: "", profile: "" })).toBe("")
  })
  it("trimme chaque section", () => {
    const p = buildSystemPrompt({ general: "  GEN  ", profile: " PROF " })
    expect(p).toContain("GEN\n"); expect(p).toContain("PROF")
  })
})
```

- [ ] **Step 2: Vérifier l'échec** — Run `npm test` → FAIL

- [ ] **Step 3: Implémenter `src/lib/prompts/defaults.ts`** — contenu texte pédagogique demandé par l'utilisateur (texte exact, en français) :

```ts
export const DEFAULT_GENERAL_INSTRUCTIONS = `Je souhaite apprendre à utiliser différents logiciels. Adapte tes explications à mon niveau. Lorsque je travaille dans une interface graphique, examine attentivement les captures d'écran que je fournis. Donne-moi des instructions précises, en utilisant les noms exacts des menus, boutons et propriétés. Ne suppose pas qu'un élément existe s'il n'est pas visible ou vérifié. Lorsque je réalise une procédure, guide-moi étape par étape et attends ma confirmation avant de poursuivre. Si je rencontre une erreur, analyse mon retour et reprends le diagnostic à partir de l'état réel du logiciel. Si tu n'es pas certain d'une manipulation, indique-le clairement.`

export const PROFILE_APPRENTISSAGE = `Réponds comme un formateur patient. Explique les concepts avant les manipulations. Vérifie ta compréhension de l'écran avant de proposer une action.`
```

- [ ] **Step 4: Implémenter `src/lib/prompts/compose.ts`**

```ts
export function buildSystemPrompt(input: { general: string; profile: string; project?: string }): string {
  const sections: string[] = []
  if (input.general.trim()) sections.push(`## Instructions générales\n${input.general.trim()}`)
  if (input.profile.trim()) sections.push(`## Profil\n${input.profile.trim()}`)
  if (input.project?.trim()) sections.push(`## Projet\n${input.project.trim()}`)
  return sections.join("\n\n")
}
```

- [ ] **Step 5: Vérifier le passage** — Run `npm test` → PASS

- [ ] **Step 6: Commit**

```powershell
git add src/lib/prompts
git commit -m "feat: composition du prompt système (général + profil + projet)"
```

---

### Task 9 : UI chat minimale fonctionnelle (sidebar + streaming + messages)

**Files:**
- Create: `src/components/chat/ChatView.tsx`, `src/components/chat/InputBar.tsx`, `src/components/sidebar/Sidebar.tsx`, `src/hooks/useConversations.ts`, `src/hooks/useChat.ts`, `src/lib/db/messages.ts`
- Modify: `src/App.tsx` (remplacer le scaffold), `src/index.css` (thème sombre + variables shadcn minimales)
- Test: `src/lib/db/messages.test.ts` (comme Task 4), composants testés manuellement (décision : la couche UI React de cette Milestone est validée en manuel, la logique métier est déjà en TDD)

**Interfaces:**
- Consumes: `conversations` (Task 4), `createProvider` + `IProvider` (Task 5/6), `secrets` (Task 7), `buildSystemPrompt` + defaults (Task 8), `t` (Task 1).
- Produces: app utilisable de bout en bout.

Codage d'état `useChat` : conversation courante → liste de messages locaux `{ role, content, modelLabel?, latencyMs?, apiError? }` ; envoi → insert user en base, stream via provider, deltas => setState, done => insert assistant en base ; abort via `AbortController`.

- [ ] **Step 1: `src/lib/db/messages.ts` + test**

```ts
import { execute, select } from "./database"

export interface MessageRow {
  id: string
  conversation_id: string
  role: "user" | "assistant"
  content: string
  attachments: string
  model_label: string | null
  latency_ms: number | null
  error: string | null
}

export const messages = {
  async listByConversation(conversationId: string): Promise<MessageRow[]> {
    return select<MessageRow[]>(
      "SELECT * FROM messages WHERE conversation_id = ? ORDER BY rowid ASC", [conversationId],
    )
  },
  async insert(row: Omit<MessageRow, "id">): Promise<string> {
    const id = crypto.randomUUID()
    await execute(
      "INSERT INTO messages (id, conversation_id, role, content, attachments, model_label, latency_ms, error) VALUES (?,?,?,?,?,?,?,?)",
      [id, row.conversation_id, row.role, row.content, row.attachments, row.model_label, row.latency_ms, row.error],
    )
    return id
  },
  async updateError(id: string, error: string | null): Promise<void> {
    await execute("UPDATE messages SET error = ? WHERE id = ?", [error, id])
  },
  async removeByConversation(conversationId: string): Promise<void> {
    await execute("DELETE FROM messages WHERE conversation_id = ?", [conversationId])
  },
}
```

Test `src/lib/db/messages.test.ts` (motif identique à Task 4 : mock de `@/lib/db/database`) :

```ts
import { describe, it, expect, vi, beforeEach } from "vitest"

const mockExecute = vi.fn()
const mockSelect = vi.fn()
vi.mock("@/lib/db/database", () => ({
  execute: (...a: unknown[]) => mockExecute(...a),
  select: (...a: unknown[]) => mockSelect(...a),
}))

import { messages } from "@/lib/db/messages"

beforeEach(() => { vi.clearAllMocks() })

describe("messages", () => {
  it("listByConversation trie par rowid ASC", async () => {
    mockSelect.mockResolvedValueOnce([{ id: "m1", conversation_id: "c1", role: "user", content: "a", attachments: "[]", model_label: null, latency_ms: null, error: null }])
    await messages.listByConversation("c1")
    const [sql] = mockSelect.mock.calls[0]
    expect(sql).toContain("ORDER BY rowid ASC")
    expect(mockSelect.mock.calls[0][1]).toEqual(["c1"])
  })

  it("insert insère 8 colonnes et retourne un uuid", async () => {
    mockExecute.mockResolvedValueOnce(undefined)
    const id = await messages.insert({
      conversation_id: "c1", role: "assistant", content: "réponse",
      attachments: "[]", model_label: "OpenRouter › gpt-4o", latency_ms: 420, error: null,
    })
    expect(id).toMatch(/^[0-9a-f-]{36}$/)
    const [sql, bind] = mockExecute.mock.calls[0]
    expect(sql).toContain("INSERT INTO messages")
    expect(bind).toHaveLength(8)
    expect(bind[5]).toBe("OpenRouter › gpt-4o")
    expect(bind[6]).toBe(420)
  })

  it("updateError et removeByConversation ciblent la bonne ligne", async () => {
    mockExecute.mockResolvedValue(undefined)
    await messages.updateError("m1", '{"kind":"auth","message":"Clé API invalide"}')
    expect(mockExecute.mock.calls[0][0]).toContain("UPDATE messages SET error")
    await messages.removeByConversation("c1")
    expect(mockExecute.mock.calls[1][0]).toContain("DELETE FROM messages WHERE conversation_id = ?")
  })
})
```

- [ ] **Step 2 bis: Vérifier l'échec puis le passage** — `npm test` : FAIL (module absent) → implémenter `messages.ts` ci-dessus → PASS.

- [ ] **Step 2: `src/hooks/useConversations.ts`**

```ts
import { useEffect, useState, useCallback } from "react"
import { conversations, type ConversationRow } from "@/lib/db/conversations"

export function useConversations() {
  const [list, setList] = useState<ConversationRow[]>([])
  const refresh = useCallback(async () => setList(await conversations.list()), [])
  useEffect(() => { void refresh() }, [refresh])
  return { list, refresh }
}
```

- [ ] **Step 3: `src/components/sidebar/Sidebar.tsx`**

```tsx
import { useState } from "react"
import { Plus, Search, Trash2 } from "lucide-react"
import { t } from "@/i18n/fr"
import type { ConversationRow } from "@/lib/db/conversations"

interface Props {
  conversations: ConversationRow[]
  activeId: string | null
  onSelect: (id: string) => void
  onNew: () => void
  onDelete: (id: string) => void
}

export function Sidebar({ conversations, activeId, onSelect, onNew, onDelete }: Props) {
  const [query, setQuery] = useState("")
  const filtered = conversations.filter((c) => c.title.toLowerCase().includes(query.toLowerCase()))
  return (
    <aside className="flex h-full w-64 flex-col border-r border-border bg-background p-2 gap-2">
      <button onClick={onNew} className="flex items-center gap-2 rounded-md border border-border px-3 py-2 text-sm hover:bg-foreground/5">
        <Plus className="size-4" /> {t.sidebar.newConversation}
      </button>
      <div className="flex items-center gap-2 rounded-md border border-border px-2 py-1">
        <Search className="size-4 opacity-50" />
        <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t.sidebar.search}
          className="w-full bg-transparent text-sm outline-none" />
      </div>
      <nav className="flex-1 space-y-1 overflow-y-auto">
        {filtered.map((c) => (
          <div key={c.id}
            className={`group flex items-center justify-between rounded-md px-2 py-1.5 text-sm cursor-pointer ${c.id === activeId ? "bg-foreground/10" : "hover:bg-foreground/5"}`}
            onClick={() => onSelect(c.id)}>
            <span className="truncate">{c.title}</span>
            <button aria-label={t.sidebar.delete} className="opacity-0 group-hover:opacity-60 hover:!opacity-100"
              onClick={(e) => { e.stopPropagation(); onDelete(c.id) }}>
              <Trash2 className="size-3.5" />
            </button>
          </div>
        ))}
      </nav>
    </aside>
  )
}
```

- [ ] **Step 4: `src/components/chat/InputBar.tsx` + `ChatView.tsx` + `useChat.ts`**

`src/hooks/useChat.ts` (cœur du flux) :

```ts
import { useCallback, useRef, useState } from "react"
import { createProvider } from "@/lib/ai/factory"
import type { ApiError } from "@/lib/ai/errors"
import type { ProviderConfig } from "@/lib/ai/types"
import { buildSystemPrompt } from "@/lib/prompts/compose"
import { DEFAULT_GENERAL_INSTRUCTIONS, PROFILE_APPRENTISSAGE } from "@/lib/prompts/defaults"
import { messages as messagesDb, type MessageRow } from "@/lib/db/messages"
import { conversations } from "@/lib/db/conversations"
import { secrets } from "@/lib/secrets/service"

export interface ChatMessageVM {
  id?: string
  role: "user" | "assistant"
  content: string
  modelLabel?: string
  latencyMs?: number
  apiError?: ApiError
}

export function useChat(config: { provider: ProviderConfig; modelId: string }) {
  const [vm, setVm] = useState<ChatMessageVM[]>([])
  const [busy, setBusy] = useState(false)
  const abortRef = useRef<AbortController | null>(null)

  const load = useCallback(async (conversationId: string) => {
    const rows = await messagesDb.listByConversation(conversationId)
    setVm(rows.map((r): ChatMessageVM => ({
      id: r.id, role: r.role, content: r.content,
      modelLabel: r.model_label ?? undefined,
      latencyMs: r.latency_ms ?? undefined,
      apiError: r.error ? JSON.parse(r.error) : undefined,
    })))
  }, [])

  const send = useCallback(async (conversationId: string, text: string) => {
    if (!text.trim() || busy) return
    setBusy(true)
    const controller = new AbortController()
    abortRef.current = controller

    setVm((s) => [...s, { role: "user", content: text } as ChatMessageVM])
    const userId = await messagesDb.insert({
      conversation_id: conversationId, role: "user", content: text,
      attachments: "[]", model_label: null, latency_ms: null, error: null,
    })
    await conversations.touch(conversationId)

    const provider = createProvider(config.provider)
    const apiKey = (await secrets.get(config.provider.secretRef)) ?? ""
    const system = buildSystemPrompt({
      general: DEFAULT_GENERAL_INSTRUCTIONS,
      profile: PROFILE_APPRENTISSAGE,
    })

    const history = await messagesDb.listByConversation(conversationId)
    const apiMessages = [
      ...(system ? [{ role: "system" as const, content: system }] : []),
      ...history.map((h) => ({ role: h.role, content: h.content })),
    ]

    const assistantId = crypto.randomUUID()
    const label = `${config.provider.name} › ${config.modelId}`
    setVm((s) => [...s, { id: assistantId, role: "assistant", content: "", modelLabel: label }])

    const accRef = useRef("")
    accRef.current = ""
    const upsertLast = (patch: Partial<ChatMessageVM>) =>
      setVm((s) => s.map((m) => (m.id === assistantId ? { ...m, ...patch } : m)))

    const isAbort = (e: unknown) => e instanceof Error && e.name === "AbortError"

    await provider.stream(
      { messages: apiMessages },
      apiKey,
      config.modelId,
      {
        onFirstToken: () => { /* réservé V1.1 (temps de première réponse) */ },
        onDelta: (d) => {
          accRef.current += d
          upsertLast({ content: accRef.current })
        },
        onDone: async ({ text, totalMs }) => {
          const id = await messagesDb.insert({
            conversation_id: conversationId, role: "assistant", content: text,
            attachments: "[]", model_label: label, latency_ms: Math.round(totalMs), error: null,
          })
          upsertLast({ id, content: text, latencyMs: Math.round(totalMs) })
        },
        onError: async (e) => {
          if (isAbort(e)) {
            // Interruption volontaire : contenu conservé, pas d'erreur affichée.
            const id = await messagesDb.insert({
              conversation_id: conversationId, role: "assistant", content: accRef.current,
              attachments: "[]", model_label: label,
              latency_ms: null,
              error: JSON.stringify({ interrupted: true }),
            })
            upsertLast({ id, content: accRef.current })
            return
          }
          const api = e as ApiError
          const payload = api.kind ? { kind: api.kind, message: api.message, detail: api.detail } : { kind: "unknown", message: api.message }
          upsertLast({ apiError: payload as ApiError })
          const id = await messagesDb.insert({
            conversation_id: conversationId, role: "assistant", content: accRef.current,
            attachments: "[]", model_label: label, latency_ms: null,
            error: JSON.stringify(payload),
          })
          upsertLast({ id, content: accRef.current })
        },
      },
      controller.signal,
    )
    setBusy(false)
  }, [busy, config])

  const interrupt = useCallback(() => abortRef.current?.abort(), [])
  return { vm, busy, send, interrupt, load }
}
```

**Particularités à respecter** : l'accumulation du texte streamé passe par un `useRef` local (`accRef.current += d` puis mise à jour de l'état avec la valeur complète) — jamais de concaténation delta hors closure. `onError` avec `ApiError` stocke `{kind, message, detail}` en JSON dans `messages.error` et affiche la bulle en erreur (bordure rouge + libellé traduit via `t.errors[...]`). Interruption (AbortError) : pas d'erreur affichée, contenu accumulé conservé et persisté.

- [ ] **Step 5: `ChatView.tsx`** (render du VM, badge modèle + latence, bouton Stop quand busy, pas de résumé magique) et **`InputBar.tsx`** (textarea, Entrée envoyer / Shift+Entrée nouvelle ligne, bouton Envoyer désactivé si busy → remplacé par bouton Stop) :

```tsx
// InputBar — extrait clavier
function onKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
  if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); submit() }
}
```

- [ ] **Step 6: `src/App.tsx`** — layout 2 panneaux (Sidebar + ChatView), thème sombre via `class="dark"` sur `<html>` dans `index.html` + palette CSS simple, conversation active dans state local, création/renommage/suppression branchée sur `conversations` service. Pas de markdown-rendering élaboré en Milestone 1 : `<pre class="whitespace-pre-wrap">` (Plan 3 apporte react-markdown).

- [ ] **Step 7: Vérification manuelle de bout en bout (PowerShell)**

1. Ajouter un fournisseur + modèle et une clé de test via Task 10 (ou temporairement en devtools).
2. `npm run tauri dev` → créer une conversation → envoyer « Dis bonjour ».
Expected: message utilisateur + réponse en streaming + badge `Modèle › modèle` + latence < quelques secondes ; redémarrage de l'app → l'historique est là ; bouton Stop coupe le flux ; une mauvaise clé → bulles d'erreur en français (« Clé API invalide… »).

- [ ] **Step 8: `npm test` green + commit**

```powershell
git add -A
git commit -m "feat: chat fonctionnel (streaming, historique, erreurs normalisées)"
```

---

### Task 10 : Écran Fournisseurs minimal (CRUD + test connexion + clé au Credential Manager)

**Files:**
- Create: `src/lib/db/providers.ts`, `src/components/settings/SettingsDialog.tsx`, `src/components/settings/ProviderForm.tsx`
- Modify: `src/hooks/useChat.ts` (sélection du modèle actif via settings), `src/App.tsx` (bouton engrenage ouvrant SettingsDialog)
- Test: `src/lib/db/providers.test.ts`

**Interfaces:**
- Produces (réutilisé en Plan 2/3) :

```ts
// src/lib/db/providers.ts
export interface ProviderRow { id: string; name: string; api_family: "openai" | "gemini"; base_url: string; created_at: string }
export interface ModelRow { id: string; provider_id: string; model_id: string; supports_images: number; is_default: number }
export const providers = {
  create(name: string, apiFamily: "openai" | "gemini", baseUrl: string, secret?: string): Promise<ProviderRow>,
  list(): Promise<ProviderRow[]>,
  update(id: string, patch: Partial<Pick<ProviderRow, "name" | "api_family" | "base_url">>): Promise<void>,
  remove(id: string): Promise<void>, // cascade models ; delete_secret(secretRef)
  // models
  addModel(providerId: string, modelId: string): Promise<ModelRow>,
  listModels(providerId: string): Promise<ModelRow[]>,
  removeModel(id: string): Promise<void>,
  setDefaultModel(id: string): Promise<void>,
}
export function secretRefFor(providerId: string): string  // `logassist/provider/${id}`
```

- [ ] **Step 1: Test du service `src/lib/db/providers.test.ts` (motif Task 4)**

```ts
import { describe, it, expect, vi, beforeEach } from "vitest"

const mockExecute = vi.fn()
const mockSelect = vi.fn()
const mockSecrets = { set: vi.fn(), get: vi.fn(), remove: vi.fn() }
vi.mock("@/lib/db/database", () => ({
  execute: (...a: unknown[]) => mockExecute(...a),
  select: (...a: unknown[]) => mockSelect(...a),
}))
vi.mock("@/lib/secrets/service", () => ({ secrets: mockSecrets }))

import { providers, secretRefFor } from "@/lib/db/providers"

beforeEach(() => { vi.clearAllMocks() })

describe("providers", () => {
  it("create insère le provider et écrit la clé dans le Credential Manager", async () => {
    mockExecute.mockResolvedValue(undefined)
    const row = await providers.create("OpenRouter", "openai", "https://openrouter.ai/api/v1", "sk-test")
    expect(row.name).toBe("OpenRouter")
    const [sql, bind] = mockExecute.mock.calls[0]
    expect(sql).toContain("INSERT INTO providers")
    expect(bind).toMatchObject([row.id, "OpenRouter", "openai"])
    expect(mockSecrets.set).toHaveBeenCalledWith(secretRefFor(row.id), "sk-test")
  })

  it("create sans clé n'écrit aucun secret", async () => {
    await providers.create("NVIDIA", "openai", "https://integrate.api.nvidia.com/v1")
    expect(mockSecrets.set).not.toHaveBeenCalled()
  })

  it("remove supprime les models (cascade), le secret, puis le provider", async () => {
    mockExecute.mockResolvedValue(undefined)
    mockSelect.mockResolvedValueOnce([])
    await providers.remove("p1")
    expect(mockSecrets.remove).toHaveBeenCalledWith(secretRefFor("p1"))
    const deleteCall = mockExecute.mock.calls.find((c) => String(c[0]).includes("DELETE FROM providers"))
    expect(deleteCall).toBeDefined()
    expect(deleteCall![1]).toEqual(["p1"])
  })

  it("setDefaultModel désactive les autres defaults du provider avant de setter", async () => {
    mockExecute.mockResolvedValue(undefined)
    mockSelect.mockResolvedValueOnce([{ provider_id: "p1" }])
    await providers.setDefaultModel("m1")
    const calls = mockExecute.mock.calls.map((c) => String(c[0]))
    expect(calls[0]).toContain("UPDATE models SET is_default = 0 WHERE provider_id")
    expect(calls[1]).toContain("UPDATE models SET is_default = 1 WHERE id = ?")
  })

  it("addModel insère avec supports_images heuristique", async () => {
    mockExecute.mockResolvedValue(undefined)
    mockSelect.mockResolvedValueOnce([])
    await providers.addModel("p1", "openai/gpt-4o")
    const [sql, bind] = mockExecute.mock.calls[0]
    expect(sql).toContain("INSERT INTO models")
    expect(bind[1]).toBe("p1")
    expect(typeof bind[2]).toBe("number") // supports_images ∈ {0,1}
  })
})

describe("secretRefFor", () => {
  it("suit la convention logassist/provider/<id>", () => {
    expect(secretRefFor("p1")).toBe("logassist/provider/p1")
  })
})
```

(Dans `addModel`, heuristique simple pour la Milestone 1 : liste figée rennormalisée — ex. `/gpt-4|gpt-5|vision|claude|gemini|o1|o3/i → 1`, sinon `0`. L'utilisateur peut la corriger dans l'UI en Plan 2.)

- [ ] **Step 2: Implémenter le service**

```ts
import { execute, select } from "./database"
import { secrets } from "@/lib/secrets/service"

export function secretRefFor(providerId: string): string {
  return `logassist/provider/${providerId}`
}
// ... CRUD direct en SQL (même style que conversations.ts, uuid crypto.randomUUID())
```

- [ ] **Step 3: `SettingsDialog.tsx`** — dialog simple (overlay plein écran, pas besoin de shadcn Dialog en Milestone 1) listant les fournisseurs (nom, url, modèles, bouton « Tester »), et `ProviderForm.tsx` (champs : nom, famille [openai], URL de base, clé API, ajout de modèles libres, modèle par défaut). Bouton « Tester la connexion » appelle `createProvider({...}).testConnection(await secrets.get(secretRefFor(id)))` → badge vert/rouge + message de l'`ApiError` traduit.
   - La clé est saisie → `secrets.set(secretRefFor(providerId), value)` ; jamais affichée après validation (placeholder `•••••••`, bouton « Remplacer la clé »).

- [ ] **Step 4: Brancher la sélection de modèle dans le chat** — settings: `settings` table : clé `default_model` = `{providerId, modelId}` JSON ; `useChat` lit ce réglage (fallback : premier fournisseur ouvert avec modèle). Sélecteur simple en pied de ChatView : `select` HTML listant `Fournisseur › modèle`.

- [ ] **Step 5: Vérification manuelle** — Ajouter « OpenRouter » (URL `https://openrouter.ai/api/v1`), clé réelle, modèle, « Tester » → vert. Envoyer un message de chat → répond. Une clé erronée → rouge + « Clé API invalide ou expirée ». relancer l'app → config persistée.

- [ ] **Step 6: `npm test` green + commit final de Milestone 1**

```powershell
git add -A
git commit -m "feat: écran fournisseurs (CRUD, test connexion, secrets Credential Manager)"
```

---

## Livrables et suite

**Fin de Milestone 1 =** chat multi-conversations fonctionnel avec un fournisseur OpenAI-compatible, secrets sécurisés, erreurs normalisées.

**Plans suivants (à rédiger après exécution de celui-ci) :**
- **Plan 2** : images (Ctrl+V, import, prévisualisation), adaptateur Gemini, profils éditables, i18n switch, régénérer.
- **Plan 3** : projets + rattachement de conversations, export/backup, Markdown rendering, recherche, archivage UI, stats complètes.
