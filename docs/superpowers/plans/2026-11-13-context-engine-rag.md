# Context Engine et RAG local — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Construire une préparation centralisée du contexte qui sélectionne localement les connaissances et l’historique utiles, respecte la fenêtre réelle du modèle avant chaque appel direct ou MCP et bloque explicitement tout contexte impossible.

**Architecture:** Un domaine pur `src/lib/context/` résout les capacités du modèle, estime les tokens, découpe et classe les connaissances Markdown, sélectionne des tours d’historique et produit une `ContextSession`. `TurnRunner` et `ToolAgent` passent obligatoirement par cette session avant chaque appel fournisseur ; `useChat` reste responsable du séquencement React/SQLite et conserve son contrat anti-perte.

**Tech Stack:** React 19, TypeScript strict, Vitest 5, Tauri v2, SQLite via `tauri-plugin-sql`, API OpenAI-compatible, LM Studio REST v1, MCP, `@dqbd/tiktoken` uniquement pour les modèles OpenAI explicitement connus.

---

## Contraintes d’exécution

- Branche de travail : `feat/context-engine-rag`.
- Aucun worktree local : le dépôt les interdit explicitement.
- Aucun `npm install` sous WSL.
- Les commandes Vitest, TypeScript et Vite s’exécutent via PowerShell dans `C:\dev\LogAssist`.
- Git et les modifications de fichiers s’exécutent depuis WSL dans `/mnt/c/dev/LogAssist`.
- Aucun contenu de message, document, résultat MCP, secret ou Base64 ne doit apparaître dans un log de test ou de production.
- Chaque tâche suit le cycle test rouge → code minimal → test vert → commit.

Commande PowerShell de référence pour un test ciblé :

```bash
powershell.exe -NoProfile -Command "Set-Location 'C:\dev\LogAssist'; npx vitest run src/lib/context/modelCapabilities.test.ts"
```

## Carte des fichiers

### Nouveaux fichiers de production

- `src/lib/context/types.ts` — contrats du profil modèle, des passages, des diagnostics et des tours préparés.
- `src/lib/context/modelCapabilities.ts` — résolution de la fenêtre avec cache éphémère et fallback prudent.
- `src/lib/context/tokenEstimator.ts` — estimation texte/messages/outils/images sans tokeniser le Base64.
- `src/lib/context/markdownChunker.ts` — découpage Markdown dérivé, respectueux des titres et blocs de code.
- `src/lib/context/knowledgeRetriever.ts` — cache par empreinte et classement BM25 local.
- `src/lib/context/historySelector.ts` — regroupement en tours et classement récence/pertinence.
- `src/lib/context/allocator.ts` — allocation déterministe des candidats optionnels.
- `src/lib/context/contextPlanner.ts` — création de `ContextSession` et contrôle de chaque tour.
- `src/lib/context/diagnostics.ts` — projection sûre vers le logger.
- `src/lib/context/index.ts` — exports publics du domaine.
- `src/lib/chat/knowledgeSelection.ts` — sémantique unique des connaissances globales/par conversation.
- `src/lib/chat/prepareConversationContext.ts` — pont entre SQLite/prompts/provider et le domaine pur.
- `src/components/settings/ModelContextSettings.tsx` — formulaire avancé des overrides de contexte.

### Nouveaux tests

- `src/lib/context/modelCapabilities.test.ts`
- `src/lib/context/tokenEstimator.test.ts`
- `src/lib/context/markdownChunker.test.ts`
- `src/lib/context/knowledgeRetriever.test.ts`
- `src/lib/context/historySelector.test.ts`
- `src/lib/context/allocator.test.ts`
- `src/lib/context/contextPlanner.test.ts`
- `src/lib/context/diagnostics.test.ts`
- `src/lib/chat/knowledgeSelection.test.ts`
- `src/lib/chat/prepareConversationContext.test.ts`
- `src/lib/db/activeModel.test.ts`
- `src/components/settings/ModelContextSettings.test.tsx`

### Fichiers modifiés

- `src/lib/db/migrations.ts`, `src/lib/db/database.ts`, `src/lib/db/migrations.test.ts` — migration V11.
- `src/lib/db/providers.ts`, `src/lib/db/providers.test.ts`, `src/lib/db/activeModel.ts` — overrides de modèle.
- `src/lib/ai/types.ts`, `src/lib/ai/errors.ts`, tests i18n/erreurs — erreur de contexte, métadonnées et limite de sortie.
- `src/lib/ai/openai-compat.ts`, `src/lib/ai/openai-compat.test.ts`, `src/lib/ai/url.ts`, `src/lib/ai/url.test.ts` — inspection modèle et traduction du budget de sortie.
- `src/lib/token/pricing.ts`, `src/lib/token/pricing.test.ts`, `src/lib/token/estimate.ts`, `src/lib/token/estimate.test.ts` — tiktoken limité à OpenAI officiel.
- `src/lib/prompts/compose.ts`, `src/lib/prompts/compose.test.ts` — section d’extraits référencés.
- `src/lib/chat/turnRunner.ts`, `src/lib/chat/turnRunner.test.ts` — exécution d’un tour préparé.
- `src/lib/mcp/toolAgent.ts`, `src/lib/mcp/toolAgent.test.ts` — replanification de tous les tours MCP.
- `src/hooks/useChat.ts`, `src/hooks/useChat.test.tsx`, `src/hooks/useChat.media.test.tsx` — intégration envoi/récupération.
- `src/components/chat/InputBar.tsx`, `src/components/chat/InputBar.test.tsx` — dimensions image éphémères.
- `src/components/settings/ModelPickerModal.tsx`, son test et `ProvidersDialog.tsx` — accès aux overrides.
- `src/App.tsx`, `src/App.test.tsx` — transport des capacités du modèle actif.
- `src/i18n/fr.ts` — chaînes d’erreur et réglages.
- `README.md` et `AGENTS.md` — comportement du moteur de contexte et schéma courant.

---

### Task 1: Verrouiller la référence avant modification

**Files:**
- Inspect: `package.json`
- Inspect: `src/hooks/useChat.test.tsx`
- Inspect: `src/lib/mcp/toolAgent.test.ts`

- [x] **Step 1: Vérifier la branche et l’état Git**

Run:

```bash
git status --short --branch
```

Expected: branche `feat/context-engine-rag`, sans modification fonctionnelle non suivie.

- [x] **Step 2: Exécuter la suite Vitest complète sous Windows**

Run:

```bash
powershell.exe -NoProfile -Command "Set-Location 'C:\dev\LogAssist'; npm run test"
```

Expected: tous les tests passent. Noter le nombre exact dans le rapport final.

- [x] **Step 3: Exécuter le build de référence sous Windows**

Run:

```bash
powershell.exe -NoProfile -Command "Set-Location 'C:\dev\LogAssist'; npm run build"
```

Expected: `tsc`, Vitest et Vite passent. En cas d’échec de référence, arrêter et diagnostiquer séparément avant la Task 2.

---

### Task 2: Ajouter le contrat d’erreur et la migration V11

**Files:**
- Modify: `src/lib/ai/types.ts:1-16`
- Modify: `src/lib/ai/errors.ts:1-97`
- Modify: `src/lib/ai/errors.test.ts`
- Modify: `src/lib/ai/errors.i18n.test.ts`
- Modify: `src/i18n/fr.ts:284-294`
- Modify: `src/lib/db/migrations.ts:1-242`
- Modify: `src/lib/db/database.ts:3-125`
- Modify: `src/lib/db/migrations.test.ts:1-211`
- Modify: `src/lib/db/providers.ts:12-117`
- Modify: `src/lib/db/providers.test.ts:20-92`
- Modify: `src/lib/db/activeModel.ts:1-39`
- Create: `src/lib/db/activeModel.test.ts`
- Modify: `src/components/settings/ProvidersDialog.test.tsx`

- [x] **Step 1: Écrire les tests rouges de l’erreur `context_length`**

Ajouter dans `src/lib/ai/errors.test.ts` :

```ts
it.each([
  "n_keep: 37609 >= n_ctx: 8192",
  "maximum context length is 8192 tokens",
  "prompt is too long for this model",
])("classe un dépassement de contexte : %s", (body) => {
  expect(normalizeHttpStatus(400, body)).toMatchObject({ kind: "context_length" })
})
```

Étendre `src/lib/ai/errors.i18n.test.ts` :

```ts
it("déclare un libellé dédié au contexte trop volumineux", () => {
  expect(API_ERROR_KINDS).toContain("context_length")
  expect(KIND_TO_KEY).toHaveProperty("context_length", "contextLength")
  expect(t.errors.contextLength).toContain("contexte")
})
```

- [x] **Step 2: Écrire les tests rouges de la migration V11**

Importer `SCHEMA_V11_STATEMENTS`, attendre `SCHEMA_VERSION === 11`, puis ajouter :

```ts
describe("SCHEMA_V11_STATEMENTS", () => {
  it("ajoute deux overrides nullable et bornés aux modèles", () => {
    expect(SCHEMA_V11_STATEMENTS).toEqual([
      "ALTER TABLE models ADD COLUMN context_window_override INTEGER CHECK (context_window_override IS NULL OR context_window_override BETWEEN 512 AND 2000000)",
      "ALTER TABLE models ADD COLUMN max_output_tokens_override INTEGER CHECK (max_output_tokens_override IS NULL OR max_output_tokens_override BETWEEN 1 AND 262144)",
    ])
  })

  it("applique uniquement V11 à une base V10", async () => {
    const { db, execute } = createMigrationDbMock()
    await executeSchema(db, 10)
    expect(execute.mock.calls.map(([statement]) => statement)).toEqual(SCHEMA_V11_STATEMENTS)
  })
})
```

- [x] **Step 3: Écrire les tests rouges du repository modèle**

Ajouter à `src/lib/db/providers.test.ts` :

```ts
it("enregistre ou réinitialise les overrides de contexte avec des binds", async () => {
  mockExecute.mockResolvedValue(undefined)
  await providers.updateModelContext("m1", {
    contextWindowOverride: 8192,
    maxOutputTokensOverride: 1536,
  })
  expect(mockExecute).toHaveBeenCalledWith(
    "UPDATE models SET context_window_override = ?, max_output_tokens_override = ? WHERE id = ?",
    [8192, 1536, "m1"],
  )

  await providers.updateModelContext("m1", {
    contextWindowOverride: null,
    maxOutputTokensOverride: null,
  })
  expect(mockExecute).toHaveBeenLastCalledWith(
    "UPDATE models SET context_window_override = ?, max_output_tokens_override = ? WHERE id = ?",
    [null, null, "m1"],
  )
})

it("refuse une sortie supérieure ou égale à la fenêtre manuelle", async () => {
  await expect(providers.updateModelContext("m1", {
    contextWindowOverride: 4096,
    maxOutputTokensOverride: 4096,
  })).rejects.toThrow("sortie")
  expect(mockExecute).not.toHaveBeenCalled()
})
```

Créer `src/lib/db/activeModel.test.ts` avec un mock de `select` qui retourne :

```ts
{
  id: "provider-1",
  name: "LM Studio",
  api_family: "openai",
  base_url: "http://localhost:1234/v1",
  model_row_id: "model-row-1",
  model_id: "qwen3.5-9b",
  context_window_override: 8192,
  max_output_tokens_override: 1024,
}
```

Attendre :

```ts
expect(await getActiveModel()).toMatchObject({
  modelRowId: "model-row-1",
  modelId: "qwen3.5-9b",
  contextWindowOverride: 8192,
  maxOutputTokensOverride: 1024,
})
```

- [x] **Step 4: Exécuter les tests et confirmer l’échec**

Run:

```bash
powershell.exe -NoProfile -Command "Set-Location 'C:\dev\LogAssist'; npx vitest run src/lib/ai/errors.test.ts src/lib/ai/errors.i18n.test.ts src/lib/db/migrations.test.ts src/lib/db/providers.test.ts src/lib/db/activeModel.test.ts"
```

Expected: échecs sur `context_length`, V11, `updateModelContext` et les nouveaux champs de `ActiveModel`.

- [x] **Step 5: Implémenter l’erreur et sa traduction**

Dans `src/lib/ai/types.ts`, ajouter `"context_length"` à `ApiErrorKind` et `API_ERROR_KINDS`.

Dans `src/lib/ai/errors.ts`, ajouter :

```ts
context_length: "contextLength",
```

Puis déclarer avant `normalizeHttpStatus` :

```ts
const CONTEXT_HINTS =
  /(?:n_keep\s*:\s*\d+\s*>=\s*n_ctx|max(?:imum)? context length|context window|prompt (?:is )?too long|too many (?:input )?tokens)/i
```

Dans la branche `status >= 400`, tester `CONTEXT_HINTS` avant `IMAGE_HINTS` :

```ts
if (CONTEXT_HINTS.test(body)) {
  return new ApiError(
    "context_length",
    "Le contexte dépasse la fenêtre disponible du modèle",
    detail,
  )
}
```

Dans `src/i18n/fr.ts`, ajouter :

```ts
contextLength: "Le contexte obligatoire dépasse la fenêtre disponible du modèle",
```

- [x] **Step 6: Implémenter V11 et les overrides**

Dans `src/lib/db/migrations.ts` :

```ts
export const SCHEMA_VERSION = 11

export const SCHEMA_V11_STATEMENTS: string[] = [
  "ALTER TABLE models ADD COLUMN context_window_override INTEGER CHECK (context_window_override IS NULL OR context_window_override BETWEEN 512 AND 2000000)",
  "ALTER TABLE models ADD COLUMN max_output_tokens_override INTEGER CHECK (max_output_tokens_override IS NULL OR max_output_tokens_override BETWEEN 1 AND 262144)",
]
```

Dans `executeSchema()` :

```ts
if (fromVersion < 11) {
  for (const statement of SCHEMA_V11_STATEMENTS) {
    await db.execute(statement)
  }
}
```

Importer `SCHEMA_V11_STATEMENTS` dans `database.ts` et dans
`migrations.test.ts` avec les listes précédentes.

Étendre `ModelRow` :

```ts
context_window_override: number | null
max_output_tokens_override: number | null
```

Dans l’objet créé par `addModel()`, initialiser explicitement :

```ts
context_window_override: null,
max_output_tokens_override: null,
```

Ajouter les deux mêmes champs nullable aux fixtures `ModelRow` de
`src/components/settings/ProvidersDialog.test.tsx` afin que TypeScript reste vert
dès ce commit.

Ajouter au repository :

```ts
async updateModelContext(
  id: string,
  input: {
    contextWindowOverride: number | null
    maxOutputTokensOverride: number | null
  },
): Promise<void> {
  const context = input.contextWindowOverride
  const output = input.maxOutputTokensOverride
  if (context !== null && (!Number.isSafeInteger(context) || context < 512 || context > 2_000_000)) {
    throw new Error("La fenêtre de contexte doit être un entier compris entre 512 et 2000000.")
  }
  if (output !== null && (!Number.isSafeInteger(output) || output < 1 || output > 262_144)) {
    throw new Error("La réserve de sortie doit être un entier compris entre 1 et 262144.")
  }
  if (context !== null && output !== null && output >= context) {
    throw new Error("La réserve de sortie doit être inférieure à la fenêtre de contexte.")
  }
  await execute(
    "UPDATE models SET context_window_override = ?, max_output_tokens_override = ? WHERE id = ?",
    [context, output, id],
  )
},
```

Normaliser les champs absents dans `listModels()` avec `?? null` afin que les mocks et anciennes lignes restent compatibles.

Étendre `ActiveModel` et sa requête :

```ts
export interface ActiveModel {
  provider: ProviderConfig
  modelRowId: string
  modelId: string
  contextWindowOverride: number | null
  maxOutputTokensOverride: number | null
}
```

Le `SELECT` doit aliaser `m.id AS model_row_id` et sélectionner les deux colonnes V11.

- [x] **Step 7: Relancer les tests ciblés**

```bash
powershell.exe -NoProfile -Command "Set-Location 'C:\dev\LogAssist'; npx vitest run src/lib/ai/errors.test.ts src/lib/ai/errors.i18n.test.ts src/lib/db/migrations.test.ts src/lib/db/providers.test.ts src/lib/db/activeModel.test.ts"
```

Expected: PASS.

- [x] **Step 8: Committer le contrat et la migration**

```bash
git add src/lib/ai/types.ts src/lib/ai/errors.ts src/lib/ai/errors.test.ts src/lib/ai/errors.i18n.test.ts src/i18n/fr.ts src/lib/db/migrations.ts src/lib/db/database.ts src/lib/db/migrations.test.ts src/lib/db/providers.ts src/lib/db/providers.test.ts src/lib/db/activeModel.ts src/lib/db/activeModel.test.ts src/components/settings/ProvidersDialog.test.tsx
git commit -m "feat: ajoute les limites de contexte par modèle"
```

---

### Task 3: Découvrir la fenêtre réelle du fournisseur

**Files:**
- Modify: `src/lib/ai/types.ts:70-84`
- Modify: `src/lib/ai/openai-compat.ts:34-48,400-419`
- Modify: `src/lib/ai/openai-compat.test.ts:85-145`
- Modify: `src/lib/ai/url.ts`
- Modify: `src/lib/ai/url.test.ts`
- Create: `src/lib/context/types.ts`
- Create: `src/lib/context/modelCapabilities.ts`
- Create: `src/lib/context/modelCapabilities.test.ts`
- Create: `src/lib/context/index.ts`

- [x] **Step 1: Écrire les tests rouges du détecteur loopback**

Dans `src/lib/ai/url.test.ts` :

```ts
it.each([
  "http://localhost:1234/v1",
  "http://127.0.0.1:1234/v1",
  "http://[::1]:1234/v1",
])("reconnaît une API loopback : %s", (url) => {
  expect(isLoopbackApiBaseUrl(url)).toBe(true)
})

it.each([
  "https://openrouter.ai/api/v1",
  "http://192.168.1.20:1234/v1",
  "https://example.com/v1",
])("refuse une API non loopback : %s", (url) => {
  expect(isLoopbackApiBaseUrl(url)).toBe(false)
})
```

- [x] **Step 2: Écrire les tests rouges de l’inspection LM Studio**

Dans `src/lib/ai/openai-compat.test.ts`, utiliser une configuration locale et deux réponses fetch :

```ts
const LM_STUDIO_CFG: ProviderConfig = {
  id: "lm-studio",
  name: "LM Studio",
  apiFamily: "openai",
  baseUrl: "http://localhost:1234/v1",
  secretRef: "logassist/provider/lm-studio",
}

it("retient la fenêtre chargée LM Studio plutôt que le maximum théorique", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(makeRes({
    json: {
      models: [{
        key: "qwen/qwen3.5-9b",
        max_context_length: 131072,
        loaded_instances: [
          { id: "qwen/qwen3.5-9b", config: { context_length: 8192 } },
        ],
      }],
    },
  })))

  await expect(
    createOpenAICompatible(LM_STUDIO_CFG).inspectModelContext("not-needed", "qwen/qwen3.5-9b"),
  ).resolves.toEqual({ contextWindowTokens: 8192, source: "loaded" })
})

it("retient la plus petite fenêtre quand plusieurs instances correspondent", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(makeRes({
    json: {
      models: [{
        key: "qwen",
        max_context_length: 131072,
        loaded_instances: [
          { id: "qwen", config: { context_length: 32768 } },
          { id: "qwen", config: { context_length: 8192 } },
        ],
      }],
    },
  })))
  await expect(
    createOpenAICompatible(LM_STUDIO_CFG).inspectModelContext("not-needed", "qwen"),
  ).resolves.toMatchObject({ contextWindowTokens: 8192, source: "loaded" })
})
```

Ajouter un test générique où `/api/v1/models` retourne 404 puis `/v1/models` retourne :

```ts
{ data: [{ id: "openai/gpt-4o", context_length: 128000 }] }
```

Attendre `{ contextWindowTokens: 128000, source: "metadata" }`.

- [x] **Step 3: Écrire les tests rouges du résolveur de profil**

Créer `src/lib/context/modelCapabilities.test.ts` :

```ts
import { describe, expect, it, vi } from "vitest"
import { resolveModelContextProfile } from "./modelCapabilities"

describe("resolveModelContextProfile", () => {
  it("donne la priorité à l’override sans appeler le fournisseur", async () => {
    const inspect = vi.fn()
    const profile = await resolveModelContextProfile({
      cacheKey: "p/m",
      contextWindowOverride: 16384,
      maxOutputTokensOverride: 2048,
      inspect,
    })
    expect(profile).toMatchObject({
      contextWindowTokens: 16384,
      maxOutputTokens: 2048,
      source: "manual",
    })
    expect(inspect).not.toHaveBeenCalled()
  })

  it("utilise la fenêtre chargée puis calcule 20 % de sortie", async () => {
    const profile = await resolveModelContextProfile({
      cacheKey: "p/m",
      contextWindowOverride: null,
      maxOutputTokensOverride: null,
      inspect: vi.fn().mockResolvedValue({ contextWindowTokens: 8192, source: "loaded" }),
    })
    expect(profile).toMatchObject({
      contextWindowTokens: 8192,
      maxOutputTokens: 1638,
      source: "provider_loaded",
    })
  })

  it("utilise le registre vérifié après une inspection sans métadonnée", async () => {
    const profile = await resolveModelContextProfile({
      cacheKey: "openai/gpt-4o-mini",
      contextWindowOverride: null,
      maxOutputTokensOverride: null,
      registryContextWindow: 128000,
      inspect: vi.fn().mockResolvedValue(null),
    })
    expect(profile).toMatchObject({
      contextWindowTokens: 128000,
      source: "registry",
    })
  })

  it("retombe prudemment sur 4096 si l’inspection échoue", async () => {
    const profile = await resolveModelContextProfile({
      cacheKey: "p/inconnu",
      contextWindowOverride: null,
      maxOutputTokensOverride: null,
      inspect: vi.fn().mockRejectedValue(new Error("offline")),
    })
    expect(profile).toMatchObject({
      contextWindowTokens: 4096,
      maxOutputTokens: 1024,
      source: "fallback",
    })
  })
})
```

- [x] **Step 4: Exécuter les tests et confirmer l’échec**

```bash
powershell.exe -NoProfile -Command "Set-Location 'C:\dev\LogAssist'; npx vitest run src/lib/ai/url.test.ts src/lib/ai/openai-compat.test.ts src/lib/context/modelCapabilities.test.ts"
```

Expected: fonctions et méthode d’inspection absentes.

- [x] **Step 5: Ajouter les contrats de capacité**

Dans `src/lib/ai/types.ts` :

```ts
export interface ProviderModelContext {
  contextWindowTokens: number
  source: "loaded" | "metadata"
}
```

Étendre `IProvider` dans `openai-compat.ts` :

```ts
inspectModelContext(apiKey: string, modelId: string): Promise<ProviderModelContext | null>
```

Créer `src/lib/context/types.ts` avec :

```ts
export type ContextWindowSource =
  | "manual"
  | "provider_loaded"
  | "provider_metadata"
  | "registry"
  | "fallback"

export type TokenizerKind = "openai_tiktoken" | "conservative"

export interface ModelContextProfile {
  contextWindowTokens: number
  maxOutputTokens: number
  source: ContextWindowSource
  tokenizer: TokenizerKind
}
```

- [x] **Step 6: Implémenter l’inspection fournisseur**

Dans `src/lib/ai/url.ts` :

```ts
export function isLoopbackApiBaseUrl(baseUrl: string): boolean {
  try {
    const url = new URL(baseUrl)
    const host = url.hostname.replace(/^\[|\]$/g, "").toLowerCase()
    return host === "localhost" || host === "::1" || /^127(?:\.\d{1,3}){3}$/.test(host)
  } catch {
    return false
  }
}
```

Dans l’adaptateur, valider chaque fenêtre :

```ts
function validContextWindow(value: unknown): number | null {
  return Number.isSafeInteger(value) && (value as number) >= 512 && (value as number) <= 2_000_000
    ? value as number
    : null
}
```

Pour une URL loopback, appeler `${new URL(base).origin}/api/v1/models`, rechercher
le modèle par `key` ou par identifiant d’instance, puis retourner la plus petite
`config.context_length` valide. Si l’endpoint n’est pas disponible, appeler
`${base}/models`, trouver `data[].id === modelId` et lire `context_length`, puis
`max_context_length`. Chaque lecture de métadonnées utilise un `AbortController`
interne et un timer de 2 000 ms nettoyé dans `finally`. Un timeout, un statut
non-OK ou un JSON malformé retourne `null` pour cette capacité optionnelle ; il ne
bloque jamais le chat et ne journalise ni clé ni corps de réponse.

- [x] **Step 7: Implémenter le résolveur et son cache**

Dans `src/lib/context/modelCapabilities.ts` :

```ts
import type { ModelContextProfile } from "./types"
import type { ProviderModelContext } from "@/lib/ai/types"
import { isOfficialOpenAiBaseUrl } from "@/lib/ai/url"

const FALLBACK_CONTEXT_WINDOW = 4096
const CACHE_TTL_MS = 30_000
const cache = new Map<string, { expiresAt: number; value: ProviderModelContext | null }>()
const VERIFIED_OPENAI_WINDOWS: Record<string, number> = {
  "gpt-4o": 128_000,
  "gpt-4o-mini": 128_000,
  "gpt-4-turbo": 128_000,
  "gpt-4": 8_192,
  "gpt-3.5-turbo": 16_385,
}

export function getVerifiedContextWindow(baseUrl: string, modelId: string): number | null {
  if (!isOfficialOpenAiBaseUrl(baseUrl)) return null
  return VERIFIED_OPENAI_WINDOWS[modelId] ?? null
}

function outputReserve(windowTokens: number, override: number | null): number {
  const requested = override ?? Math.min(8192, Math.max(1024, Math.floor(windowTokens * 0.2)))
  return Math.min(requested, Math.max(1, windowTokens - 512))
}

export async function resolveModelContextProfile(input: {
  cacheKey: string
  contextWindowOverride: number | null
  maxOutputTokensOverride: number | null
  registryContextWindow?: number | null
  inspect(): Promise<ProviderModelContext | null>
  now?: number
}): Promise<ModelContextProfile> {
  if (input.contextWindowOverride !== null) {
    return {
      contextWindowTokens: input.contextWindowOverride,
      maxOutputTokens: outputReserve(input.contextWindowOverride, input.maxOutputTokensOverride),
      source: "manual",
      tokenizer: "conservative",
    }
  }

  const now = input.now ?? Date.now()
  let inspected = cache.get(input.cacheKey)
  if (!inspected || inspected.expiresAt <= now) {
    let value: ProviderModelContext | null = null
    try {
      value = await input.inspect()
    } catch {
      value = null
    }
    inspected = { expiresAt: now + CACHE_TTL_MS, value }
    cache.set(input.cacheKey, inspected)
  }

  const registryWindow = input.registryContextWindow ?? null
  const windowTokens = inspected.value?.contextWindowTokens ?? registryWindow ?? FALLBACK_CONTEXT_WINDOW
  return {
    contextWindowTokens: windowTokens,
    maxOutputTokens: outputReserve(windowTokens, input.maxOutputTokensOverride),
    source: inspected.value?.source === "loaded"
      ? "provider_loaded"
      : inspected.value?.source === "metadata"
        ? "provider_metadata"
        : registryWindow !== null
          ? "registry"
          : "fallback",
    tokenizer: "conservative",
  }
}

export function invalidateModelContextProfile(cacheKey: string): void {
  cache.delete(cacheKey)
}
```

- [x] **Step 8: Relancer les tests ciblés**

```bash
powershell.exe -NoProfile -Command "Set-Location 'C:\dev\LogAssist'; npx vitest run src/lib/ai/url.test.ts src/lib/ai/openai-compat.test.ts src/lib/context/modelCapabilities.test.ts"
```

Expected: PASS.

- [x] **Step 9: Committer la découverte fournisseur**

```bash
git add src/lib/ai/types.ts src/lib/ai/openai-compat.ts src/lib/ai/openai-compat.test.ts src/lib/ai/url.ts src/lib/ai/url.test.ts src/lib/context/types.ts src/lib/context/modelCapabilities.ts src/lib/context/modelCapabilities.test.ts src/lib/context/index.ts
git commit -m "feat: détecte la fenêtre réelle des modèles"
```

---

### Task 4: Construire l’estimateur de tokens multi-modèles

**Files:**
- Create: `src/lib/context/tokenEstimator.ts`
- Create: `src/lib/context/tokenEstimator.test.ts`
- Modify: `src/lib/context/types.ts`
- Modify: `src/lib/context/index.ts`
- Modify: `src/lib/ai/types.ts:8-16`
- Modify: `src/lib/token/pricing.ts:109-123`
- Modify: `src/lib/token/pricing.test.ts`
- Modify: `src/lib/token/estimate.ts:1-94`
- Modify: `src/lib/token/estimate.test.ts`
- Modify: `src/hooks/useChat.ts:571-580,749-758`
- Modify: `src/hooks/useChat.test.tsx`

- [x] **Step 1: Écrire les tests rouges de l’estimateur conservateur**

Créer `src/lib/context/tokenEstimator.test.ts` :

```ts
import { describe, expect, it } from "vitest"
import { createTokenEstimator } from "./tokenEstimator"

describe("tokenEstimator", () => {
  it("utilise une heuristique conservatrice pour un modèle local", () => {
    const estimator = createTokenEstimator({
      baseUrl: "http://localhost:1234/v1",
      modelId: "qwen3.5-9b",
    })
    expect(estimator.kind).toBe("conservative")
    expect(estimator.countText("a".repeat(300))).toBeGreaterThanOrEqual(100)
    expect(estimator.countText("漢字".repeat(50))).toBeGreaterThanOrEqual(100)
    estimator.dispose()
  })

  it("ne fait jamais dépendre le coût image de la longueur Base64", () => {
    const estimator = createTokenEstimator({ baseUrl: "http://localhost:1234/v1", modelId: "qwen" })
    const short = estimator.countImage({ base64: "A", mimeType: "image/png", width: 1024, height: 768 })
    const long = estimator.countImage({ base64: "A".repeat(1_000_000), mimeType: "image/png", width: 1024, height: 768 })
    expect(short).toBe(long)
    expect(short).toBeGreaterThan(0)
    estimator.dispose()
  })

  it("compte les schémas et descriptions d’outils", () => {
    const estimator = createTokenEstimator({ baseUrl: "https://example.com/v1", modelId: "m" })
    const small = estimator.countTools([])
    const large = estimator.countTools([{
      type: "function",
      function: {
        name: "search",
        description: "Recherche documentaire détaillée",
        parameters: { type: "object", properties: { query: { type: "string" } } },
      },
    }])
    expect(large).toBeGreaterThan(small)
    estimator.dispose()
  })
})
```

- [x] **Step 2: Écrire le test rouge qui réserve tiktoken à OpenAI officiel**

Dans `src/lib/token/pricing.test.ts` :

```ts
it("ne fournit un tokenizer exact qu’à un modèle OpenAI officiel connu", () => {
  expect(getExactTiktokenModel("https://api.openai.com/v1", "gpt-4o-mini")).toBe("gpt-4o-mini")
  expect(getExactTiktokenModel("http://localhost:1234/v1", "gpt-4o-mini")).toBeNull()
  expect(getExactTiktokenModel("https://openrouter.ai/api/v1", "openai/gpt-4o-mini")).toBeNull()
  expect(getExactTiktokenModel("https://api.openai.com/v1", "modele-inconnu")).toBeNull()
})
```

Remplacer les trois tests historiques qui attendaient `cl100k_base` pour un
serveur privé par des attentes `getExactTiktokenModel(...) === null`. Conserver
les tests de normalisation des snapshots OpenAI officiels en leur passant
`https://api.openai.com/v1`.

- [x] **Step 3: Exécuter les tests et confirmer l’échec**

```bash
powershell.exe -NoProfile -Command "Set-Location 'C:\dev\LogAssist'; npx vitest run src/lib/context/tokenEstimator.test.ts src/lib/token/pricing.test.ts src/lib/token/estimate.test.ts"
```

Expected: nouveaux exports absents.

- [x] **Step 4: Étendre les images internes avec leurs dimensions éphémères**

Dans `ChatMessage` :

```ts
images?: {
  base64: string
  mimeType: string
  width?: number
  height?: number
}[]
```

Dans `src/lib/context/types.ts` :

```ts
import type { ChatMessage, ToolDefinition } from "@/lib/ai/types"

export interface ContextTokenEstimator {
  readonly kind: TokenizerKind
  countText(text: string): number
  countMessage(message: ChatMessage): number
  countMessages(messages: readonly ChatMessage[]): number
  countTools(tools: readonly ToolDefinition[]): number
  countImage(image: NonNullable<ChatMessage["images"]>[number]): number
  dispose(): void
}
```

- [x] **Step 5: Implémenter la résolution tiktoken exacte**

Dans `src/lib/token/pricing.ts` :

```ts
export function getExactTiktokenModel(baseUrl: string, modelId: string): TiktokenModel | null {
  if (!isOfficialOpenAiBaseUrl(baseUrl)) return null
  return MODEL_PRICING.openai[normalizeModelId(modelId)]?.tiktokenModel ?? null
}
```

Ne pas utiliser la recherche transversale actuelle de `getTiktokenModel()` dans le
préflight. La fonction historique peut rester exportée le temps d’adapter les
consommateurs, puis être retirée si elle n’est plus référencée.

- [x] **Step 6: Implémenter l’estimateur**

Dans `src/lib/context/tokenEstimator.ts`, utiliser :

```ts
function conservativeTextTokens(text: string): number {
  if (text.length === 0) return 0
  const codePoints = Array.from(text).length
  const bytes = new TextEncoder().encode(text).length
  return Math.max(1, Math.ceil(codePoints / 3), Math.ceil(bytes / 4))
}

function conservativeImageTokens(image: {
  width?: number
  height?: number
}): number {
  if (!image.width || !image.height || image.width <= 0 || image.height <= 0) return 4096
  const patches = Math.ceil(image.width / 32) * Math.ceil(image.height / 32)
  return Math.min(8192, Math.max(256, patches))
}
```

`countMessage()` additionne : 4 tokens d’enveloppe, le contenu, l’identifiant
d’outil, les appels d’outils sérialisés et les images. `countTools()` compte le
JSON des noms, descriptions et paramètres, plus 8 tokens par définition.

Si `getExactTiktokenModel()` retourne un modèle, créer un encodeur avec
`encoding_for_model`; sinon utiliser `conservativeTextTokens`. `dispose()` libère
l’encodeur une seule fois.

- [x] **Step 7: Faire utiliser l’estimateur honnête aux métriques locales**

Changer la signature :

```ts
export function estimateTurnMetrics(
  messages: ChatMessage[],
  output: string,
  baseUrl: string,
  modelId: string,
): TurnMetrics
```

Créer l’estimateur, compter entrée et sortie, puis appeler `dispose()` dans un
`finally`. Adapter les tests : un endpoint local reste `usageSource: "estimated"`
et aucun coût n’est inventé.

Dans les deux appels encore présents dans `useChat.ts`, passer
`provider.baseUrl` à la place de `pricingProvider`. Mettre à jour les attentes de
mock correspondantes dans `useChat.test.tsx` afin que ce commit compile avant la
migration complète de `useChat`.

- [x] **Step 8: Relancer les tests ciblés**

```bash
powershell.exe -NoProfile -Command "Set-Location 'C:\dev\LogAssist'; npx vitest run src/lib/context/tokenEstimator.test.ts src/lib/token/pricing.test.ts src/lib/token/estimate.test.ts"
```

Expected: PASS.

- [x] **Step 9: Committer l’estimateur**

```bash
git add src/lib/context/tokenEstimator.ts src/lib/context/tokenEstimator.test.ts src/lib/context/types.ts src/lib/context/index.ts src/lib/ai/types.ts src/lib/token/pricing.ts src/lib/token/pricing.test.ts src/lib/token/estimate.ts src/lib/token/estimate.test.ts src/hooks/useChat.ts src/hooks/useChat.test.tsx
git commit -m "feat: estime prudemment tous les éléments du contexte"
```

---

### Task 5: Découper les documents Markdown sans toucher aux originaux

**Files:**
- Create: `src/lib/context/markdownChunker.ts`
- Create: `src/lib/context/markdownChunker.test.ts`
- Modify: `src/lib/context/types.ts`
- Modify: `src/lib/context/index.ts`

- [x] **Step 1: Écrire les tests rouges du chunker**

Créer `src/lib/context/markdownChunker.test.ts` :

```ts
import { describe, expect, it } from "vitest"
import { chunkMarkdown } from "./markdownChunker"

const countTokens = (text: string) => Math.max(1, Math.ceil(text.length / 20))

describe("chunkMarkdown", () => {
  it("conserve le chemin des titres imbriqués", () => {
    const content = "# HISE\nIntroduction.\n\n## ScriptNode\nCréer un node.\n\n### Paramètres\nRégler gain."
    const chunks = chunkMarkdown({
      documentId: "k1",
      documentName: "HISE",
      content,
      countTokens,
      targetTokens: 20,
      hardLimitTokens: 30,
    })
    expect(chunks.map((chunk) => chunk.headingPath)).toContainEqual(["HISE", "ScriptNode", "Paramètres"])
    expect(content).toBe("# HISE\nIntroduction.\n\n## ScriptNode\nCréer un node.\n\n### Paramètres\nRégler gain.")
  })

  it("garde un bloc de code ordinaire dans un seul passage", () => {
    const chunks = chunkMarkdown({
      documentId: "k1",
      documentName: "HISE",
      content: "## Code\n```js\nconst gain = 1\nconsole.log(gain)\n```",
      countTokens,
      targetTokens: 20,
      hardLimitTokens: 30,
    })
    expect(chunks.filter((chunk) => chunk.content.includes("const gain"))).toHaveLength(1)
  })

  it("scinde par lignes un bloc de code qui dépasse seul la limite", () => {
    const code = Array.from({ length: 80 }, (_, index) => `line_${index}()`).join("\n")
    const chunks = chunkMarkdown({
      documentId: "k1",
      documentName: "HISE",
      content: `## Code\n\`\`\`js\n${code}\n\`\`\``,
      countTokens,
      targetTokens: 10,
      hardLimitTokens: 15,
    })
    expect(chunks.length).toBeGreaterThan(1)
    expect(chunks.every((chunk) => chunk.tokenEstimate <= 15)).toBe(true)
    expect(chunks.every((chunk) => chunk.headingPath.at(-1) === "Code")).toBe(true)
  })
})
```

- [x] **Step 2: Exécuter le test et confirmer l’échec**

```bash
powershell.exe -NoProfile -Command "Set-Location 'C:\dev\LogAssist'; npx vitest run src/lib/context/markdownChunker.test.ts"
```

Expected: module absent.

- [x] **Step 3: Définir les types de document et passage**

Dans `src/lib/context/types.ts` :

```ts
export interface KnowledgeDocument {
  id: string
  name: string
  content: string
  sortOrder: number
}

export interface KnowledgeChunk {
  documentId: string
  documentName: string
  fingerprint: string
  chunkIndex: number
  headingPath: string[]
  content: string
  tokenEstimate: number
}
```

- [x] **Step 4: Implémenter le fingerprint non cryptographique**

Dans `markdownChunker.ts` :

```ts
export function fingerprintText(value: string): string {
  let hash = 0x811c9dc5
  for (const character of value) {
    hash ^= character.codePointAt(0) ?? 0
    hash = Math.imul(hash, 0x01000193)
  }
  return (hash >>> 0).toString(16).padStart(8, "0")
}
```

Cette empreinte sert uniquement à l’invalidation et au diagnostic ; elle n’est
pas présentée comme une garantie cryptographique.

- [x] **Step 5: Implémenter le parseur et le regroupement**

Le parseur lit les lignes, maintient `headingPath` pour `#{1,6}`, accumule les
paragraphes séparés par ligne vide et reconnaît les fences commençant par trois
backticks ou tildes. Il regroupe des unités tant que `targetTokens` tient. Une
unité supérieure à `hardLimitTokens` est découpée par lignes avec réouverture et
fermeture de fence pour chaque morceau de code. Après construction, attribuer des
`chunkIndex` séquentiels et la même empreinte du document à tous les passages.

La fonction publique doit avoir cette signature exacte :

```ts
export function chunkMarkdown(input: {
  documentId: string
  documentName: string
  content: string
  countTokens(text: string): number
  targetTokens?: number
  hardLimitTokens?: number
}): KnowledgeChunk[]
```

Valeurs par défaut : `targetTokens = 450`, `hardLimitTokens = 700`.

- [x] **Step 6: Relancer le test ciblé**

```bash
powershell.exe -NoProfile -Command "Set-Location 'C:\dev\LogAssist'; npx vitest run src/lib/context/markdownChunker.test.ts"
```

Expected: PASS.

- [x] **Step 7: Committer le chunker**

```bash
git add src/lib/context/markdownChunker.ts src/lib/context/markdownChunker.test.ts src/lib/context/types.ts src/lib/context/index.ts
git commit -m "feat: découpe les connaissances par sections Markdown"
```

---

### Task 6: Rechercher localement les passages pertinents

**Files:**
- Create: `src/lib/context/knowledgeRetriever.ts`
- Create: `src/lib/context/knowledgeRetriever.test.ts`
- Create: `src/lib/chat/knowledgeSelection.ts`
- Create: `src/lib/chat/knowledgeSelection.test.ts`
- Modify: `src/lib/context/types.ts`
- Modify: `src/lib/context/index.ts`

- [x] **Step 1: Écrire les tests rouges du classement lexical**

Créer `src/lib/context/knowledgeRetriever.test.ts` :

```ts
import { describe, expect, it } from "vitest"
import { createKnowledgeRetriever } from "./knowledgeRetriever"

const documents = [
  { id: "hise", name: "HISE", sortOrder: 0, content: "# ScriptNode\nCréer un ScriptNode et régler le gain audio." },
  { id: "resolve", name: "DaVinci Resolve", sortOrder: 1, content: "# Étalonnage\nUtiliser les nodes de couleur et les scopes." },
]

describe("knowledgeRetriever", () => {
  it("classe le passage correspondant à la question", () => {
    const retriever = createKnowledgeRetriever({ countTokens: (text) => Math.ceil(text.length / 4) })
    const ranked = retriever.search("Comment régler le gain dans ScriptNode ?", documents)
    expect(ranked[0]).toMatchObject({ documentId: "hise" })
    expect(ranked[0].score).toBeGreaterThan(0)
  })

  it("ne force aucun passage quand aucun terme ne correspond", () => {
    const retriever = createKnowledgeRetriever({ countTokens: (text) => Math.ceil(text.length / 4) })
    expect(retriever.search("recette de pain au levain", documents)).toEqual([])
  })

  it("invalide le cache quand le contenu change", () => {
    const retriever = createKnowledgeRetriever({ countTokens: (text) => Math.ceil(text.length / 4) })
    expect(retriever.search("oscillateur", documents)).toEqual([])
    const changed = [{ ...documents[0], content: "# Synthèse\nAjouter un oscillateur sinusoïdal." }, documents[1]]
    expect(retriever.search("oscillateur", changed)[0]).toMatchObject({ documentId: "hise" })
  })

  it("diversifie deux documents de scores proches avant un passage redondant", () => {
    const retriever = createKnowledgeRetriever({ countTokens: (text) => Math.ceil(text.length / 4) })
    const ranked = retriever.search("gain audio", [
      { id: "a", name: "Audio A", sortOrder: 0, content: "# Gain\nGain audio principal.\n\n## Suite\nGain audio secondaire." },
      { id: "b", name: "Audio B", sortOrder: 1, content: "# Gain\nGain audio alternatif." },
    ])
    expect(ranked.slice(0, 2).map((chunk) => chunk.documentId)).toEqual(["a", "b"])
  })
})
```

- [x] **Step 2: Écrire les tests rouges de la sélection globale/par conversation**

Créer `src/lib/chat/knowledgeSelection.test.ts` avec repositories injectés :

```ts
it("utilise les connaissances globales sans override", async () => {
  const listEnabled = vi.fn().mockResolvedValue([{ id: "global", enabled: 1 }])
  const result = await loadEligibleKnowledge("c1", {
    listOverrideIds: vi.fn().mockResolvedValue([]),
    listAll: vi.fn(),
    listEnabled,
  })
  expect(result).toEqual([{ id: "global", enabled: 1 }])
  expect(listEnabled).toHaveBeenCalledTimes(1)
})

it("remplace la globale par l’override non vide et exclut un document désactivé", async () => {
  const result = await loadEligibleKnowledge("c1", {
    listOverrideIds: vi.fn().mockResolvedValue(["k2", "k1"]),
    listAll: vi.fn().mockResolvedValue([
      { id: "k1", enabled: 0 },
      { id: "k2", enabled: 1 },
    ]),
    listEnabled: vi.fn(),
  })
  expect(result).toEqual([{ id: "k2", enabled: 1 }])
})
```

- [x] **Step 3: Exécuter les tests et confirmer l’échec**

```bash
powershell.exe -NoProfile -Command "Set-Location 'C:\dev\LogAssist'; npx vitest run src/lib/context/knowledgeRetriever.test.ts src/lib/chat/knowledgeSelection.test.ts"
```

Expected: modules absents.

- [x] **Step 4: Implémenter la tokenisation lexicale et BM25**

Normaliser avec `value.normalize("NFKC").toLocaleLowerCase("fr")`, remplacer les
séparateurs `_`, `-`, `/` par des espaces, puis extraire
`/[\p{L}\p{N}]+/gu`. Conserver les termes d’au moins deux caractères et les
identifiants numériques utiles.

Le score BM25 utilise `k1 = 1.2`, `b = 0.75`. Ajouter :

- `+ 1.5` par terme présent dans le nom du document ;
- `+ 1.0` par terme présent dans le chemin de titres ;
- `+ 2.0` pour une correspondance exacte d’identifiant technique ;
- une déduplication par empreinte de contenu de passage ;
- une diversification MMR : pour des scores bruts distants de moins de 10 %,
  préférer un document pas encore représenté et retrancher `0.35 × similarité
  Jaccard` aux passages redondants ;
- un tri final déterministe `score ajusté desc`, puis `sortOrder`, puis `chunkIndex`.

La fonction publique :

```ts
export interface RankedKnowledgeChunk extends KnowledgeChunk {
  score: number
}

export interface KnowledgeRetriever {
  search(query: string, documents: readonly KnowledgeDocument[]): RankedKnowledgeChunk[]
  clear(): void
}

export function createKnowledgeRetriever(input: {
  countTokens(text: string): number
  chunkDocument?: typeof chunkMarkdown
}): KnowledgeRetriever
```

Le cache est une `Map<documentId, { fingerprint, chunks, termStats }>` et ne
contient jamais de document non fourni à l’appel courant dans les résultats.
`chunkDocument` vaut `chunkMarkdown` par défaut ; l’injection optionnelle permet
de prouver la réutilisation du cache dans les tests volumineux sans exposer de
compteur dans le code de production.

- [x] **Step 5: Implémenter la sélection éligible unique**

Dans `src/lib/chat/knowledgeSelection.ts` :

```ts
import { knowledge, type KnowledgeRow } from "@/lib/db/knowledge"
import { conversationKnowledge } from "@/lib/db/conversationKnowledge"

interface KnowledgeSelectionDeps {
  listOverrideIds(conversationId: string): Promise<string[]>
  listAll(): Promise<KnowledgeRow[]>
  listEnabled(): Promise<KnowledgeRow[]>
}

const defaultDeps: KnowledgeSelectionDeps = {
  listOverrideIds: (conversationId) => conversationKnowledge.listOn(conversationId),
  listAll: () => knowledge.list(),
  listEnabled: () => knowledge.listEnabled(),
}

export async function loadEligibleKnowledge(
  conversationId: string,
  deps: KnowledgeSelectionDeps = defaultDeps,
): Promise<KnowledgeRow[]> {
  const overrideIds = await deps.listOverrideIds(conversationId)
  if (overrideIds.length === 0) return deps.listEnabled()
  const rows = await deps.listAll()
  const byId = new Map(rows.map((row) => [row.id, row]))
  return overrideIds
    .map((id) => byId.get(id))
    .filter((row): row is KnowledgeRow => Boolean(row) && row!.enabled === 1)
}
```

- [x] **Step 6: Relancer les tests ciblés**

```bash
powershell.exe -NoProfile -Command "Set-Location 'C:\dev\LogAssist'; npx vitest run src/lib/context/knowledgeRetriever.test.ts src/lib/chat/knowledgeSelection.test.ts"
```

Expected: PASS.

- [x] **Step 7: Committer le RAG lexical**

```bash
git add src/lib/context/knowledgeRetriever.ts src/lib/context/knowledgeRetriever.test.ts src/lib/chat/knowledgeSelection.ts src/lib/chat/knowledgeSelection.test.ts src/lib/context/types.ts src/lib/context/index.ts
git commit -m "feat: recherche les passages de connaissance pertinents"
```

---

### Task 7: Sélectionner des tours récents et pertinents

**Files:**
- Create: `src/lib/context/historySelector.ts`
- Create: `src/lib/context/historySelector.test.ts`
- Modify: `src/lib/context/types.ts`
- Modify: `src/lib/context/index.ts`

- [x] **Step 1: Écrire les tests rouges de regroupement et sélection**

Créer `src/lib/context/historySelector.test.ts` :

```ts
import { describe, expect, it } from "vitest"
import { selectHistory } from "./historySelector"

const messages = [
  { id: "u1", role: "user" as const, content: "Erreur export vidéo H264" },
  { id: "a1", role: "assistant" as const, content: "Vérifier le codec H264." },
  { id: "u2", role: "user" as const, content: "Comment ouvrir les scopes ?" },
  { id: "a2", role: "assistant" as const, content: "Ouvrir le panneau scopes." },
  { id: "u3", role: "user" as const, content: "Je règle maintenant les couleurs." },
  { id: "a3", role: "assistant" as const, content: "Commencer par les roues primaires." },
]

describe("selectHistory", () => {
  it("conserve des tours complets et rétablit l’ordre chronologique", () => {
    const selected = selectHistory({
      messages,
      query: "Mon export H264 échoue encore",
      tokenBudget: 32,
      countText: (text) => Math.ceil(text.length / 4),
      recentTurns: 1,
    })
    expect(selected.messages.map((message) => message.id)).toEqual(["u1", "a1", "u3", "a3"])
  })

  it("écarte un tour entier s’il ne tient pas", () => {
    const selected = selectHistory({
      messages: [
        { id: "u", role: "user", content: "x".repeat(1000) },
        { id: "a", role: "assistant", content: "y".repeat(1000) },
      ],
      query: "x",
      tokenBudget: 10,
      countText: (text) => Math.ceil(text.length / 4),
      recentTurns: 1,
    })
    expect(selected.messages).toEqual([])
    expect(selected.omittedTurns).toBe(1)
  })
})
```

- [x] **Step 2: Exécuter le test et confirmer l’échec**

```bash
powershell.exe -NoProfile -Command "Set-Location 'C:\dev\LogAssist'; npx vitest run src/lib/context/historySelector.test.ts"
```

Expected: module absent.

- [x] **Step 3: Implémenter le regroupement en tours**

Définir :

```ts
export interface ContextHistoryMessage {
  id: string
  role: "user" | "assistant"
  content: string
}

export interface HistorySelection {
  messages: ContextHistoryMessage[]
  selectedTurns: number
  omittedTurns: number
  tokens: number
}
```

Un tour commence à chaque message utilisateur et contient les assistants suivants
jusqu’au prochain utilisateur. Un assistant orphelin forme un candidat autonome
de priorité minimale afin de rester tolérant aux anciennes données, sans être
fusionné à une question incorrecte.

- [x] **Step 4: Implémenter récence et pertinence**

Réutiliser la tokenisation lexicale exportée par `knowledgeRetriever.ts`.

Algorithme déterministe :

1. prendre jusqu’à `recentTurns` derniers tours, du plus récent au plus ancien,
   seulement s’ils tiennent intégralement ;
2. scorer les autres par chevauchement pondéré avec la requête ;
3. trier `score desc`, puis récence descendante ;
4. ajouter les tours qui tiennent ;
5. trier les tours retenus par index d’origine ;
6. aplatir leurs messages.

Signature :

```ts
export function selectHistory(input: {
  messages: readonly ContextHistoryMessage[]
  query: string
  tokenBudget: number
  countText(text: string): number
  recentTurns?: number
}): HistorySelection
```

Valeur par défaut : `recentTurns = 2`.

- [x] **Step 5: Relancer le test ciblé**

```bash
powershell.exe -NoProfile -Command "Set-Location 'C:\dev\LogAssist'; npx vitest run src/lib/context/historySelector.test.ts"
```

Expected: PASS.

- [x] **Step 6: Committer le sélecteur d’historique**

```bash
git add src/lib/context/historySelector.ts src/lib/context/historySelector.test.ts src/lib/context/types.ts src/lib/context/index.ts
git commit -m "feat: borne l historique par récence et pertinence"
```

---

### Task 8: Allouer le budget et produire une `ContextSession`

**Files:**
- Create: `src/lib/context/allocator.ts`
- Create: `src/lib/context/allocator.test.ts`
- Create: `src/lib/context/contextPlanner.ts`
- Create: `src/lib/context/contextPlanner.test.ts`
- Create: `src/lib/context/diagnostics.ts`
- Create: `src/lib/context/diagnostics.test.ts`
- Modify: `src/lib/context/types.ts`
- Modify: `src/lib/context/index.ts`
- Modify: `src/lib/prompts/compose.ts`
- Modify: `src/lib/prompts/compose.test.ts`

- [x] **Step 1: Écrire les tests rouges de l’allocateur**

Créer `src/lib/context/allocator.test.ts` :

```ts
import { describe, expect, it } from "vitest"
import { allocateCandidates } from "./allocator"

describe("allocateCandidates", () => {
  it("préfère l’utilité puis le meilleur rapport utilité/tokens", () => {
    const selected = allocateCandidates([
      { id: "recent", kind: "history", tokens: 40, utility: 1000 },
      { id: "knowledge", kind: "knowledge", tokens: 20, utility: 600 },
      { id: "old", kind: "history", tokens: 20, utility: 100 },
    ], 60)
    expect(selected.map((candidate) => candidate.id)).toEqual(["recent", "knowledge"])
  })

  it("ne dépasse jamais le budget", () => {
    const selected = allocateCandidates([
      { id: "a", kind: "knowledge", tokens: 8, utility: 5 },
      { id: "b", kind: "knowledge", tokens: 8, utility: 4 },
    ], 10)
    expect(selected.reduce((total, candidate) => total + candidate.tokens, 0)).toBeLessThanOrEqual(10)
  })
})
```

- [x] **Step 2: Écrire les tests rouges du planificateur**

Créer `src/lib/context/contextPlanner.test.ts` avec un estimateur déterministe :

```ts
const estimator = {
  kind: "conservative" as const,
  countText: (text: string) => Math.ceil(text.length / 4),
  countMessage: (message: ChatMessage) => 4 + Math.ceil(message.content.length / 4),
  countMessages: (messages: readonly ChatMessage[]) => messages.reduce((sum, message) => sum + 4 + Math.ceil(message.content.length / 4), 0),
  countTools: (tools: readonly ToolDefinition[]) => Math.ceil(JSON.stringify(tools).length / 4),
  countImage: () => 512,
  dispose: vi.fn(),
}
```

Ajouter les cas :

```ts
it("préserve intégralement le système et le message courant", () => {
  const session = createContextSession({
    modelId: "qwen",
    profile: { contextWindowTokens: 4096, maxOutputTokens: 1024, source: "fallback", tokenizer: "conservative" },
    estimator,
    baseSystem: "INSTRUCTIONS",
    documents: [],
    history: [],
    currentUser: { content: "QUESTION COURANTE", images: [] },
    retrievalQuery: "QUESTION COURANTE",
  })
  const round = session.prepareRound({ additionalMessages: [], tools: [] })
  expect(round.request.messages[0]).toEqual({ role: "system", content: "INSTRUCTIONS" })
  expect(round.request.messages.at(-1)).toEqual({ role: "user", content: "QUESTION COURANTE" })
  expect(round.request.maxOutputTokens).toBe(1024)
})

it("bloque avant réseau si les éléments obligatoires dépassent la fenêtre", () => {
  const session = createContextSession({
    modelId: "qwen",
    profile: { contextWindowTokens: 4096, maxOutputTokens: 1024, source: "fallback", tokenizer: "conservative" },
    estimator,
    baseSystem: "S".repeat(20000),
    documents: [],
    history: [],
    currentUser: { content: "QUESTION", images: [] },
    retrievalQuery: "QUESTION",
  })
  let caught: unknown
  try {
    session.prepareRound({ additionalMessages: [], tools: [] })
  } catch (error) {
    caught = error
  }
  expect(caught).toMatchObject({ kind: "context_length" })
})

it("réduit progressivement connaissances et historique sans muter les sources", () => {
  const documents = [{ id: "k1", name: "HISE", content: "# ScriptNode\n" + "gain ".repeat(2000), sortOrder: 0 }]
  const history = Array.from({ length: 40 }, (_, index) => ({
    id: `m${index}`,
    role: index % 2 === 0 ? "user" as const : "assistant" as const,
    content: `tour ${index} ` + "ancien ".repeat(100),
  }))
  const original = JSON.stringify({ documents, history })
  const session = createContextSession({
    modelId: "qwen",
    profile: { contextWindowTokens: 4096, maxOutputTokens: 1024, source: "fallback", tokenizer: "conservative" },
    estimator,
    baseSystem: "SYSTEM",
    documents,
    history,
    currentUser: { content: "Comment régler le gain ScriptNode ?", images: [] },
    retrievalQuery: "Comment régler le gain ScriptNode ?",
  })
  const round = session.prepareRound({ additionalMessages: [], tools: [] })
  expect(round.stats.totalWithReserve).toBeLessThanOrEqual(4096)
  expect(round.stats.omitted.historyTurns + round.stats.omitted.knowledgeChunks).toBeGreaterThan(0)
  expect(JSON.stringify({ documents, history })).toBe(original)
})
```

- [x] **Step 3: Écrire le test rouge des résultats MCP segmentés**

Dans le même fichier :

```ts
it("tronque un résultat MCP par segments et garde son enveloppe", () => {
  const session = createContextSession({
    modelId: "qwen",
    profile: { contextWindowTokens: 4096, maxOutputTokens: 1024, source: "fallback", tokenizer: "conservative" },
    estimator,
    baseSystem: "SYSTEM",
    documents: [],
    history: [],
    currentUser: { content: "Question", images: [] },
    retrievalQuery: "Question",
  })
  const round = session.prepareRound({
    tools: [],
    additionalMessages: [{
      kind: "external_tool",
      toolCallId: "call-1",
      prefix: "<external_mcp_result>",
      segments: Array.from({ length: 500 }, (_, index) => `segment ${index} ${"x".repeat(100)}`),
      suffix: "</external_mcp_result>",
    }],
  })
  const tool = round.request.messages.find((message) => message.role === "tool")
  expect(tool?.content).toContain("<external_mcp_result>")
  expect(tool?.content).toContain("Résultat tronqué pour respecter la fenêtre de contexte")
  expect(tool?.content).toContain("</external_mcp_result>")
  expect(round.stats.totalWithReserve).toBeLessThanOrEqual(4096)
})
```

- [x] **Step 4: Écrire les tests rouges du diagnostic sûr**

Créer `src/lib/context/diagnostics.test.ts` :

```ts
it("n’expose aucun contenu privé dans le diagnostic", () => {
  const sensitive = "PRIVATE_SENTINEL_9f3c"
  const safe = toSafeContextDiagnostic({
    modelId: "qwen",
    profile: { contextWindowTokens: 8192, maxOutputTokens: 1024, source: "provider_loaded", tokenizer: "conservative" },
    categories: { system: 10, knowledge: 20, history: 30, currentUser: 40, images: 50, tools: 60, mcpResults: 70, outputReserve: 1024, safetyMargin: 256 },
    inputTokens: 280,
    totalWithReserve: 1560,
    selectedKnowledge: [{ documentId: "k1", fingerprint: "abcd1234", chunkIndex: 2, documentName: sensitive, headingPath: [sensitive], content: sensitive }],
    historyMessages: 4,
    historyTurns: 2,
    omitted: { knowledgeChunks: 3, historyTurns: 5, mcpSegments: 7, reasons: ["budget_history"] },
  })
  expect(JSON.stringify(safe)).not.toContain(sensitive)
  expect(safe.selected.knowledge).toEqual([{ documentId: "k1", fingerprint: "abcd1234", chunkIndex: 2 }])
})
```

- [x] **Step 5: Exécuter les tests et confirmer l’échec**

```bash
powershell.exe -NoProfile -Command "Set-Location 'C:\dev\LogAssist'; npx vitest run src/lib/context/allocator.test.ts src/lib/context/contextPlanner.test.ts src/lib/context/diagnostics.test.ts src/lib/prompts/compose.test.ts"
```

Expected: allocateur, session et diagnostic absents.

- [x] **Step 6: Définir les messages additionnels et statistiques**

Dans `src/lib/context/types.ts` :

```ts
export type ContextAdditionalMessage =
  | { kind: "message"; message: ChatMessage }
  | {
      kind: "external_tool"
      toolCallId: string
      prefix: string
      segments: string[]
      suffix: string
    }

export interface ContextRoundInput {
  additionalMessages: ContextAdditionalMessage[]
  tools: ToolDefinition[]
}

export interface ContextStats {
  categories: {
    system: number
    knowledge: number
    history: number
    currentUser: number
    images: number
    tools: number
    mcpResults: number
    outputReserve: number
    safetyMargin: number
  }
  inputTokens: number
  totalWithReserve: number
  selectedKnowledge: KnowledgeChunk[]
  historyMessages: number
  historyTurns: number
  omitted: {
    knowledgeChunks: number
    historyTurns: number
    mcpSegments: number
    reasons: string[]
  }
}

export interface SafeContextDiagnostic {
  modelId: string
  contextWindowTokens: number
  contextWindowSource: ContextWindowSource
  tokenizer: TokenizerKind
  tokens: ContextStats["categories"] & {
    input: number
    totalWithReserve: number
  }
  selected: {
    knowledge: Array<{ documentId: string; fingerprint: string; chunkIndex: number }>
    historyMessages: number
    historyTurns: number
  }
  omitted: ContextStats["omitted"]
}

export interface PreparedContextRound {
  request: ChatRequest
  stats: ContextStats
}

export interface ContextSession {
  prepareRound(input: ContextRoundInput): PreparedContextRound
  estimateOutput(text: string): number
  dispose(): void
}
```

- [x] **Step 7: Implémenter l’allocateur déterministe**

`allocateCandidates()` trie par `utility desc`, puis `utility / tokens desc`, puis
`id`. Il ignore les tokens non sûrs, n’ajoute un candidat que si le total reste
inférieur ou égal au budget et retourne une nouvelle liste sans muter l’entrée.

- [x] **Step 8: Ajouter la composition des extraits référencés**

Dans `src/lib/prompts/compose.ts`, ajouter :

```ts
export interface KnowledgeExcerpt {
  label: string
  documentName: string
  headingPath: string[]
  content: string
}

export function buildKnowledgePrompt(excerpts: readonly KnowledgeExcerpt[]): string {
  if (excerpts.length === 0) return ""
  const blocks = excerpts.map((excerpt) => {
    const location = [excerpt.documentName, ...excerpt.headingPath].filter(Boolean).join(" — ")
    return `[${excerpt.label}] ${location}\n${excerpt.content.trim()}`
  })
  return [
    "## Extraits de connaissances récupérés",
    "Utilise uniquement les extraits utiles et conserve leur référence [K…] lorsqu’une attribution aide la réponse.",
    ...blocks,
  ].join("\n\n")
}
```

Ajouter des tests d’ordre, de labels et d’omission quand la liste est vide.

- [x] **Step 9: Implémenter la session et l’allocation**

`createContextSession()` reçoit exactement :

```ts
export interface CreateContextSessionInput {
  modelId: string
  profile: ModelContextProfile
  estimator: ContextTokenEstimator
  baseSystem: string
  documents: readonly KnowledgeDocument[]
  history: readonly ContextHistoryMessage[]
  currentUser: {
    content: string
    images: NonNullable<ChatMessage["images"]>
  }
  retrievalQuery: string
  onDiagnostic?(diagnostic: SafeContextDiagnostic): void
}
```

Pour chaque `prepareRound()` :

1. calculer `safetyMargin = max(128, ceil(window * 0.08))` ;
2. matérialiser les wrappers MCP sans leurs segments ;
3. compter système de base, user courant, images, outils, messages additionnels,
   sortie et marge ;
4. lever `new ApiError("context_length", t.errors.contextLength)` si ce socle
   dépasse la fenêtre ;
5. allouer d’abord les segments MCP dans leur ordre ;
6. réserver jusqu’à 50 % du solde aux deux tours récents ;
7. réserver jusqu’à 35 % du solde aux passages de connaissance ;
8. remettre tout budget inutilisé dans un pool commun pour les anciens tours
   pertinents et passages suivants ;
9. construire le système `baseSystem + buildKnowledgePrompt(excerpts)` ;
10. produire `[system?, historique sélectionné, user courant, messages additionnels]` ;
11. renseigner `stats.inputTokens` avec le coût réel des messages et outils ; la
    catégorie `currentUser` compte uniquement le texte/enveloppe et `images`
    compte séparément les images afin d’éviter tout double comptage ;
12. recompter la requête finale et retirer les derniers candidats optionnels tant
    que le total dépasse la fenêtre ;
13. si seul le socle reste et dépasse encore, lever `context_length` ;
14. émettre le diagnostic sûr.

Un résultat externe sans tous ses segments contient exactement :

```text
[Résultat tronqué pour respecter la fenêtre de contexte.]
```

avant le suffixe de fermeture.

`dispose()` appelle une seule fois `estimator.dispose()`.

- [x] **Step 10: Implémenter la projection de diagnostic**

Utiliser cette signature :

```ts
export function toSafeContextDiagnostic(input: {
  modelId: string
  profile: ModelContextProfile
  categories: ContextStats["categories"]
  inputTokens: number
  totalWithReserve: number
  selectedKnowledge: KnowledgeChunk[]
  historyMessages: number
  historyTurns: number
  omitted: ContextStats["omitted"]
}): SafeContextDiagnostic
```

`toSafeContextDiagnostic()` reconstruit un nouvel objet champ par champ. Il ne
fait jamais de spread d’un objet contenant des textes privés. Les seules
références de connaissance retournées sont `documentId`, `fingerprint` et
`chunkIndex`.

- [x] **Step 11: Relancer les tests ciblés**

```bash
powershell.exe -NoProfile -Command "Set-Location 'C:\dev\LogAssist'; npx vitest run src/lib/context/allocator.test.ts src/lib/context/contextPlanner.test.ts src/lib/context/diagnostics.test.ts src/lib/prompts/compose.test.ts"
```

Expected: PASS.

- [x] **Step 12: Committer le planificateur**

```bash
git add src/lib/context/allocator.ts src/lib/context/allocator.test.ts src/lib/context/contextPlanner.ts src/lib/context/contextPlanner.test.ts src/lib/context/diagnostics.ts src/lib/context/diagnostics.test.ts src/lib/context/types.ts src/lib/context/index.ts src/lib/prompts/compose.ts src/lib/prompts/compose.test.ts
git commit -m "feat: planifie chaque requête dans son budget de contexte"
```

---

### Task 9: Traduire la limite de sortie dans l’adaptateur OpenAI-compatible

**Files:**
- Modify: `src/lib/ai/types.ts:16`
- Modify: `src/lib/ai/openai-compat.ts:175-199`
- Modify: `src/lib/ai/openai-compat.test.ts:153-216,565-602`

- [x] **Step 1: Écrire les tests rouges du paramètre de sortie**

Dans `src/lib/ai/openai-compat.test.ts` :

```ts
it("envoie max_tokens aux endpoints OpenAI-compatibles", async () => {
  const stream = sseStream([`data: [DONE]${SSE}`])
  const fetchMock = vi.fn().mockResolvedValue(makeRes({ body: stream }))
  vi.stubGlobal("fetch", fetchMock)
  await createOpenAICompatible(CFG).runTurn(
    { messages: [{ role: "user", content: "Salut" }], maxOutputTokens: 1024 },
    "K",
    "m",
    {},
    {},
    new AbortController().signal,
  )
  const body = JSON.parse(fetchMock.mock.calls[0][1].body)
  expect(body.max_tokens).toBe(1024)
  expect(body).not.toHaveProperty("max_completion_tokens")
})

it("envoie max_completion_tokens à OpenAI officiel", async () => {
  const stream = sseStream([`data: [DONE]${SSE}`])
  const fetchMock = vi.fn().mockResolvedValue(makeRes({ body: stream }))
  vi.stubGlobal("fetch", fetchMock)
  await createOpenAICompatible(OFFICIAL_OPENAI_CFG).runTurn(
    { messages: [{ role: "user", content: "Salut" }], maxOutputTokens: 2048 },
    "K",
    "gpt-4o-mini",
    {},
    {},
    new AbortController().signal,
  )
  const body = JSON.parse(fetchMock.mock.calls[0][1].body)
  expect(body.max_completion_tokens).toBe(2048)
  expect(body).not.toHaveProperty("max_tokens")
})
```

- [x] **Step 2: Exécuter les tests et confirmer l’échec**

```bash
powershell.exe -NoProfile -Command "Set-Location 'C:\dev\LogAssist'; npx vitest run src/lib/ai/openai-compat.test.ts"
```

Expected: propriétés absentes du corps.

- [x] **Step 3: Étendre `ChatRequest` et le corps HTTP**

```ts
export interface ChatRequest {
  messages: ChatMessage[]
  timeoutMs?: number
  maxOutputTokens?: number
}
```

Dans `chatRequest()` :

```ts
if (req.maxOutputTokens !== undefined) {
  if (isOfficialOpenAi) body.max_completion_tokens = req.maxOutputTokens
  else body.max_tokens = req.maxOutputTokens
}
```

Valider en amont que la valeur est un entier strictement positif ; une valeur
interne invalide lève `ApiError("unknown", "Limite de sortie interne invalide")`
avant `fetch`.

- [x] **Step 4: Relancer le test ciblé**

```bash
powershell.exe -NoProfile -Command "Set-Location 'C:\dev\LogAssist'; npx vitest run src/lib/ai/openai-compat.test.ts"
```

Expected: PASS.

- [x] **Step 5: Committer la traduction fournisseur**

```bash
git add src/lib/ai/types.ts src/lib/ai/openai-compat.ts src/lib/ai/openai-compat.test.ts
git commit -m "feat: borne la génération selon le budget disponible"
```

---

### Task 10: Faire passer TurnRunner et tous les tours MCP par la garde

**Files:**
- Modify: `src/lib/chat/turnRunner.ts`
- Modify: `src/lib/chat/turnRunner.test.ts`
- Modify: `src/lib/mcp/toolAgent.ts`
- Modify: `src/lib/mcp/toolAgent.test.ts`
- Modify: `src/lib/context/types.ts`
- Modify: `src/lib/context/contextPlanner.ts`

- [x] **Step 1: Écrire le test rouge du tour direct préparé**

Dans `turnRunner.test.ts`, créer un faux `ContextSession` :

```ts
const preparedRequest: ChatRequest = {
  messages: [{ role: "user", content: "Question bornée" }],
  maxOutputTokens: 1024,
}
const context = {
  prepareRound: vi.fn().mockReturnValue({
    request: preparedRequest,
    stats: { totalWithReserve: 2048 },
  }),
  estimateOutput: vi.fn().mockReturnValue(12),
  dispose: vi.fn(),
} as unknown as ContextSession
```

Appeler `runAssistantTurn({ context, ... })` et attendre que `provider.runTurn`
reçoive `preparedRequest`, ainsi que :

```ts
expect(context.prepareRound).toHaveBeenCalledWith({ additionalMessages: [], tools: [] })
```

- [x] **Step 2: Écrire le test rouge de tous les tours MCP**

Dans `toolAgent.test.ts`, injecter une session dont `prepareRound` retourne une
requête distincte à chaque appel. Simuler : premier appel outil, second appel
outil, réponse finale forcée. Attendre :

```ts
expect(context.prepareRound).toHaveBeenCalledTimes(3)
expect(runTurn).toHaveBeenNthCalledWith(
  3,
  expect.objectContaining({ maxOutputTokens: 1024 }),
  "LLM-KEY",
  "model",
  { toolChoice: "none" },
  expect.any(Object),
  expect.any(AbortSignal),
)
```

Ajouter un cas d’incompatibilité outils et attendre un appel supplémentaire de
`prepareRound({ additionalMessages: [], tools: [] })` pour le repli.

- [x] **Step 3: Écrire le test rouge de l’enveloppe MCP structurée**

Après un résultat de 200 paragraphes, vérifier que `prepareRound` reçoit un
élément :

```ts
expect.objectContaining({
  kind: "external_tool",
  toolCallId: "c1",
  prefix: expect.stringContaining("<external_mcp_result"),
  segments: expect.arrayContaining([expect.stringContaining("paragraphe")]),
  suffix: "</external_mcp_result>",
})
```

Vérifier séparément que le Base64 média n’apparaît ni dans `prefix`, ni dans
`segments`, ni dans `suffix`.

- [x] **Step 4: Exécuter les tests et confirmer l’échec**

```bash
powershell.exe -NoProfile -Command "Set-Location 'C:\dev\LogAssist'; npx vitest run src/lib/chat/turnRunner.test.ts src/lib/mcp/toolAgent.test.ts"
```

Expected: `context` non accepté et appels fournisseur directs.

- [x] **Step 5: Adapter TurnRunner avec compatibilité transitoire**

Étendre l’entrée avec `context?: ContextSession`. Tant que `useChat` n’est pas
encore migré, conserver `request` et créer une session passthrough interne qui
retourne cette requête. Quand `context` existe, le chemin direct exécute :

```ts
const prepared = input.context.prepareRound({ additionalMessages: [], tools: [] })
const result = await input.provider.runTurn(
  prepared.request,
  input.apiKey,
  input.modelId,
  {},
  input.callbacks,
  input.signal,
)
```

Le résultat uniforme ajoute, pour le chemin direct :

```ts
estimatedUsage: {
  inputTokens: prepared.stats.inputTokens,
  outputTokens: input.context.estimateOutput(result.text),
}
```

Étendre explicitement le contrat :

```ts
export interface AssistantTurnResult extends ToolAgentResult {
  estimatedUsage?: TokenUsage
}
```

Ne jamais substituer cette estimation à `result.usage` lorsque le fournisseur
rapporte son usage exact.

- [x] **Step 6: Adapter ToolAgent**

`ToolAgentInput` reçoit `context: ContextSession`. Remplacer le tableau initial de
requêtes complètes par :

```ts
const additionalMessages: ContextAdditionalMessage[] = []
```

Avant chaque appel, construire les définitions offertes puis appeler :

```ts
const prepared = input.context.prepareRound({
  additionalMessages,
  tools: buildToolDefinitions(offered),
})
```

Les messages assistant intermédiaires deviennent :

```ts
additionalMessages.push({
  kind: "message",
  message: { role: "assistant", content: result.text, toolCalls: result.toolCalls },
})
```

Transformer `externalResult()` pour retourner `{ prefix, segments, suffix }`.
Découper le payload par doubles sauts de ligne ; si un segment JSON ne contient
aucun saut, le découper par lignes puis par tranches Unicode de 2 000 points de
code. Ajouter l’élément `external_tool` à `additionalMessages`.

Les refus, limites et erreurs d’outil restent de petits messages `kind: "message"`.

- [x] **Step 7: Préserver usage, annulation, sources et médias**

Conserver `UsageAccumulator`, la limite de deux tours, quatre appels, la
déduplication des sources, la note média sans Base64, les approbations et le même
`AbortSignal`. Seule la construction de la requête change.

- [x] **Step 8: Relancer les tests ciblés**

```bash
powershell.exe -NoProfile -Command "Set-Location 'C:\dev\LogAssist'; npx vitest run src/lib/chat/turnRunner.test.ts src/lib/mcp/toolAgent.test.ts"
```

Expected: PASS.

- [x] **Step 9: Committer la garde des tours**

```bash
git add src/lib/chat/turnRunner.ts src/lib/chat/turnRunner.test.ts src/lib/mcp/toolAgent.ts src/lib/mcp/toolAgent.test.ts src/lib/context/types.ts src/lib/context/contextPlanner.ts
git commit -m "feat: contrôle chaque tour direct et MCP"
```

---

### Task 11: Préparer un contexte de conversation depuis les sources existantes

**Files:**
- Create: `src/lib/chat/prepareConversationContext.ts`
- Create: `src/lib/chat/prepareConversationContext.test.ts`
- Modify: `src/lib/prompts/compose.ts`
- Modify: `src/lib/context/modelCapabilities.ts`
- Modify: `src/lib/context/tokenEstimator.ts`

- [x] **Step 1: Écrire les tests rouges du pont de préparation**

Créer `prepareConversationContext.test.ts` avec dépendances injectées. Cas global :

```ts
const providerConfig: ProviderConfig = {
  id: "lm-studio",
  name: "LM Studio",
  apiFamily: "openai",
  baseUrl: "http://localhost:1234/v1",
  secretRef: "logassist/provider/lm-studio",
}
const providerAdapter = {
  inspectModelContext: vi.fn().mockResolvedValue({ contextWindowTokens: 8192, source: "loaded" }),
} as unknown as IProvider
const estimator: ContextTokenEstimator = {
  kind: "conservative",
  countText: (text) => Math.ceil(text.length / 4),
  countMessage: (message) => 4 + Math.ceil(message.content.length / 4),
  countMessages: (messages) => messages.reduce((sum, message) => sum + 4 + Math.ceil(message.content.length / 4), 0),
  countTools: (tools) => Math.ceil(JSON.stringify(tools).length / 4),
  countImage: () => 512,
  dispose: vi.fn(),
}

it("prépare une session avec la dernière ligne user comme message courant", async () => {
  const session = { prepareRound: vi.fn(), estimateOutput: vi.fn(), dispose: vi.fn() }
  const createSession = vi.fn().mockReturnValue(session)
  const result = await prepareConversationContext({
    conversationId: "c1",
    history: [
      { id: "u1", role: "user", content: "Ancienne question" },
      { id: "a1", role: "assistant", content: "Ancienne réponse" },
      { id: "u2", role: "user", content: "Question courante" },
    ],
    currentImages: [{ base64: "PRIVATE_BASE64", mimeType: "image/png", width: 800, height: 600 }],
    provider: providerConfig,
    providerAdapter,
    apiKey: "PRIVATE_KEY",
    modelId: "qwen",
    contextWindowOverride: null,
    maxOutputTokensOverride: null,
    webEnabled: true,
  }, {
    loadPromptSettings: vi.fn().mockResolvedValue({ general: "GEN", profile: "PROF" }),
    loadKnowledge: vi.fn().mockResolvedValue([{ id: "k1", name: "HISE", content: "# Gain\nRégler gain", enabled: 1, sort_order: 0, created_at: "x" }]),
    resolveProfile: vi.fn().mockResolvedValue({ contextWindowTokens: 8192, maxOutputTokens: 1024, source: "provider_loaded", tokenizer: "conservative" }),
    createEstimator: vi.fn().mockReturnValue(estimator),
    createSession,
  })
  expect(result).toBe(session)
  expect(createSession).toHaveBeenCalledWith(expect.objectContaining({
    baseSystem: expect.stringContaining("GEN"),
    history: [
      { id: "u1", role: "user", content: "Ancienne question" },
      { id: "a1", role: "assistant", content: "Ancienne réponse" },
    ],
    currentUser: expect.objectContaining({ content: "Question courante" }),
  }))
})
```

Ajouter un cas où la dernière ligne n’est pas `user` et attendre une erreur
interne avant création de session.

- [x] **Step 2: Exécuter le test et confirmer l’échec**

```bash
powershell.exe -NoProfile -Command "Set-Location 'C:\dev\LogAssist'; npx vitest run src/lib/chat/prepareConversationContext.test.ts"
```

Expected: module absent.

- [x] **Step 3: Implémenter le pont**

Signature publique :

```ts
export async function prepareConversationContext(
  input: PrepareConversationContextInput,
  deps: PrepareConversationContextDeps = defaultDeps,
): Promise<ContextSession>
```

Séquence :

1. vérifier que `history.at(-1)?.role === "user"` ;
2. charger en parallèle prompt et connaissances éligibles ;
3. appeler `resolveModelContextProfile` avec les overrides,
   `getVerifiedContextWindow(provider.baseUrl, modelId)` et
   `providerAdapter.inspectModelContext(apiKey, modelId)` ;
4. créer l’estimateur avec `provider.baseUrl` et `modelId` ;
   remplacer `profile.tokenizer` par `estimator.kind` avant de créer la session,
   afin que le diagnostic reflète l’estimateur réellement utilisé ;
5. composer le système sans document intégral : général, profil et garde Web ;
6. convertir les connaissances en `KnowledgeDocument` ;
7. passer `history.slice(0, -1)` comme historique optionnel ;
8. passer la dernière ligne intégralement comme user courant ;
9. construire la requête de retrieval avec le user courant et au plus les deux
   derniers contenus utilisateur antérieurs, chacun borné à 2 000 points de code ;
10. fournir `logger.debug({ context: "context.plan", ...diagnostic })` comme
    callback, sans autre donnée.

Si la création de session échoue après création de l’estimateur, appeler
`estimator.dispose()` avant de propager l’erreur.

- [x] **Step 4: Relancer le test ciblé**

```bash
powershell.exe -NoProfile -Command "Set-Location 'C:\dev\LogAssist'; npx vitest run src/lib/chat/prepareConversationContext.test.ts"
```

Expected: PASS.

- [x] **Step 5: Committer le pont de préparation**

```bash
git add src/lib/chat/prepareConversationContext.ts src/lib/chat/prepareConversationContext.test.ts src/lib/prompts/compose.ts src/lib/context/modelCapabilities.ts src/lib/context/tokenEstimator.ts
git commit -m "feat: centralise les sources du contexte de conversation"
```

---

### Task 12: Intégrer le contexte borné à l’envoi normal

**Files:**
- Modify: `src/hooks/useChat.ts:188-627`
- Modify: `src/hooks/useChat.test.tsx:1-1274`
- Modify: `src/hooks/useChat.media.test.tsx`
- Modify: `src/App.tsx:85-148`
- Modify: `src/App.test.tsx`
- Modify: `src/lib/chat/contextBuilder.ts`
- Modify: `src/lib/chat/contextBuilder.test.ts`

- [x] **Step 1: Écrire le test rouge d’une longue conversation bornée**

Dans `useChat.test.tsx`, ne pas mocker le planificateur pour ce cas ; injecter une
fabrique de session via `prepareConversationContext` mockée :

```ts
it("transmet une ContextSession au runner au lieu de tout l’historique", async () => {
  const context = {
    prepareRound: vi.fn().mockReturnValue({
      request: { messages: [{ role: "user", content: "Question courante" }], maxOutputTokens: 1024 },
      stats: { totalWithReserve: 2048 },
    }),
    estimateOutput: vi.fn().mockReturnValue(8),
    dispose: vi.fn(),
  }
  prepareConversationContextMock.mockResolvedValueOnce(context)
  const { result } = renderHook(() => useChat(modelSelection))
  await act(async () => expect(await result.current.send("conv-1", "Question courante")).toBe(true))
  expect(runAssistantTurnMock).toHaveBeenCalledWith(expect.objectContaining({ context }))
  expect(context.dispose).toHaveBeenCalledTimes(1)
})
```

- [x] **Step 2: Écrire le test rouge de l’overflow après persistance**

```ts
it("persiste une erreur de contexte et retourne true après l’insert user", async () => {
  prepareConversationContextMock.mockRejectedValueOnce(
    new ApiError("context_length", "Le contexte dépasse la fenêtre disponible du modèle"),
  )
  const { result } = renderHook(() => useChat(modelSelection))
  await act(async () => expect(await result.current.send("conv-1", "Question immense")).toBe(true))
  expect(messagesDb.insert).toHaveBeenCalledWith(expect.objectContaining({ role: "user" }))
  expect(messagesDb.insert).toHaveBeenCalledWith(expect.objectContaining({
    role: "assistant",
    error: expect.stringContaining("context_length"),
  }))
  expect(runAssistantTurnMock).not.toHaveBeenCalled()
})
```

Ajouter un test où `runAssistantTurn` rejette une `ApiError("context_length",
...)` provenant du fournisseur et attendre :

```ts
expect(invalidateModelContextProfileMock).toHaveBeenCalledWith(`${provider.id}/m1`)
```

Le payload d’erreur assistant reste persisté comme dans le test précédent.

- [x] **Step 3: Exécuter les tests et confirmer l’échec**

```bash
powershell.exe -NoProfile -Command "Set-Location 'C:\dev\LogAssist'; npx vitest run src/hooks/useChat.test.tsx src/hooks/useChat.media.test.tsx src/App.test.tsx"
```

Expected: aucune `ContextSession` transmise.

- [x] **Step 4: Étendre la sélection active transportée par App**

Le type de `modelSelection` devient :

```ts
{
  provider: ProviderConfig
  modelRowId: string
  modelId: string
  supportsImages: boolean
  contextWindowOverride: number | null
  maxOutputTokensOverride: number | null
}
```

`App.tsx` prend ces valeurs dans `activeModel` et conserve la recherche de
`supportsImages` actuelle.

- [x] **Step 5: Remplacer la préparation manuelle dans `send()`**

Après l’insert utilisateur et la création du provider :

```ts
const history = await messagesDb.listByConversation(conversationId)
const apiProvider = createProvider(provider)
activeApiKey = (await secrets.get(provider.secretRef)) ?? ""
const context = await prepareConversationContext({
  conversationId,
  history,
  currentImages: apiImages,
  provider,
  providerAdapter: apiProvider,
  apiKey: activeApiKey,
  modelId,
  contextWindowOverride: modelSelection.contextWindowOverride,
  maxOutputTokensOverride: modelSelection.maxOutputTokensOverride,
  webEnabled: mcpRuntime.webAccess.enabled && mcpRuntime.webAccess.configured,
})
```

Passer `context` à `runAssistantTurn`. Dans un `finally` local entourant le
runner et les métriques, appeler `context.dispose()` exactement une fois.

Retirer de ce chemin : chargement direct des connaissances, appel direct à
`buildSystemPrompt`, `buildChatMessages` et log d’images/messages non centralisé.

Dans le chemin d’erreur, si
`normalizeApiErrorKind(api.kind) === "context_length"`, appeler
`invalidateModelContextProfile(cacheKey)` avec `cacheKey` construit comme
`` `${provider.id}/${modelId}` `` avant la persistance de l’erreur afin
qu’un retry redécouvre une fenêtre LM Studio modifiée.

- [x] **Step 6: Adapter les métriques estimées**

Priorité :

```ts
const metrics = result.usage
  ? metricsFromProviderUsage(result.usage, pricingProvider, modelId)
  : result.estimatedUsage
    ? {
        inputTokens: result.estimatedUsage.inputTokens,
        outputTokens: result.estimatedUsage.outputTokens,
        usageSource: "estimated" as const,
        costMicrousd: null,
      }
    : null
```

Ne plus réencoder une requête après le tour dans `useChat`.

- [x] **Step 7: Garder `contextBuilder` uniquement comme compatibilité testée ou le supprimer**

Après migration de tous ses consommateurs, vérifier avec `grep` qu’aucun import de
`buildChatMessages` ne subsiste. S’il n’en reste aucun, supprimer
`contextBuilder.ts` et son test dans ce commit. S’il reste un consommateur réel,
le conserver et documenter ce consommateur dans le rapport final ; ne pas garder
un fichier mort.

- [x] **Step 8: Relancer les tests ciblés**

```bash
powershell.exe -NoProfile -Command "Set-Location 'C:\dev\LogAssist'; npx vitest run src/hooks/useChat.test.tsx src/hooks/useChat.media.test.tsx src/App.test.tsx"
```

Expected: PASS, y compris contrat anti-perte, images et persistance.

- [x] **Step 9: Committer l’envoi borné**

```bash
git add src/hooks/useChat.ts src/hooks/useChat.test.tsx src/hooks/useChat.media.test.tsx src/App.tsx src/App.test.tsx src/lib/chat/contextBuilder.ts src/lib/chat/contextBuilder.test.ts
git commit -m "feat: prépare chaque envoi dans la fenêtre du modèle"
```

Si `contextBuilder.ts` a été supprimé, utiliser `git add -u` pour enregistrer la
suppression avant le commit.

---

### Task 13: Appliquer exactement les mêmes règles au retry et à la régénération

**Files:**
- Modify: `src/hooks/useChat.ts:629-825`
- Modify: `src/hooks/useChat.test.tsx:1275-1514`
- Modify: `src/lib/chat/recoveryPolicy.ts`
- Modify: `src/lib/chat/recoveryPolicy.test.ts`

- [ ] **Step 1: Écrire le test rouge de récupération centralisée**

```ts
it.each(["retry", "regenerate"] as const)(
  "%s prépare le même contexte centralisé que send",
  async (mode) => {
    const rows = mode === "retry" ? [userRow, failedRow] : [userRow, answeredRow]
    vi.mocked(messagesDb.listByConversation).mockResolvedValue(rows)
    const context = {
      prepareRound: vi.fn().mockReturnValue({
        request: { messages: [{ role: "user", content: userRow.content }], maxOutputTokens: 1024 },
        stats: { totalWithReserve: 1500 },
      }),
      estimateOutput: vi.fn().mockReturnValue(10),
      dispose: vi.fn(),
    }
    prepareConversationContextMock.mockResolvedValueOnce(context)
    const { result } = renderHook(() => useChat(modelSelection))
    const target = mode === "retry" ? failedRow.id : answeredRow.id
    await act(async () => {
      const ok = mode === "retry"
        ? await result.current.retryLast("conv-1", target)
        : await result.current.regenerateLast("conv-1", target)
      expect(ok).toBe(true)
    })
    expect(runAssistantTurnMock).toHaveBeenCalledWith(expect.objectContaining({ context }))
    expect(context.dispose).toHaveBeenCalledTimes(1)
  },
)
```

- [ ] **Step 2: Écrire le test rouge d’une régénération bloquée localement**

```ts
it("conserve l’ancienne réponse si le contexte de régénération ne tient pas", async () => {
  vi.mocked(messagesDb.listByConversation).mockResolvedValue([userRow, answeredRow])
  prepareConversationContextMock.mockRejectedValueOnce(
    new ApiError("context_length", "Contexte trop grand"),
  )
  const { result } = renderHook(() => useChat(modelSelection))
  await act(async () => result.current.load("conv-1"))
  await act(async () => expect(
    await result.current.regenerateLast("conv-1", answeredRow.id),
  ).toBe(false))
  expect(messagesDb.updateAssistant).not.toHaveBeenCalled()
  expect(result.current.vm.find((message) => message.id === answeredRow.id)).toMatchObject({
    content: "Ancienne réponse",
    recoveryFailed: true,
  })
})
```

- [ ] **Step 3: Exécuter les tests et confirmer l’échec**

```bash
powershell.exe -NoProfile -Command "Set-Location 'C:\dev\LogAssist'; npx vitest run src/hooks/useChat.test.tsx src/lib/chat/recoveryPolicy.test.ts"
```

Expected: récupération utilise encore prompt et historique complets.

- [ ] **Step 4: Remplacer la préparation dupliquée dans `recoverLast()`**

Après `createRecoveryPlan()`, passer `plan.history` à
`prepareConversationContext()`. La dernière ligne de `plan.history` est la
question déclencheuse et devient le user courant. Les lignes précédentes sont les
candidats optionnels.

Passer la session au runner, conserver `resolveWebIntent(plan.triggerUserContent,
false)`, les outils, approbations, sources et médias. Disposer la session dans un
`finally` local même après AbortError ou erreur SQLite.

Retirer le second bloc dupliqué de chargement prompt/connaissances et
`buildChatMessages`.

- [ ] **Step 5: Relancer les tests ciblés**

```bash
powershell.exe -NoProfile -Command "Set-Location 'C:\dev\LogAssist'; npx vitest run src/hooks/useChat.test.tsx src/lib/chat/recoveryPolicy.test.ts"
```

Expected: PASS ; aucun doublon user et ancienne réponse conservée en échec.

- [ ] **Step 6: Committer la récupération bornée**

```bash
git add src/hooks/useChat.ts src/hooks/useChat.test.tsx src/lib/chat/recoveryPolicy.ts src/lib/chat/recoveryPolicy.test.ts
git commit -m "feat: borne les relances dans le même moteur de contexte"
```

---

### Task 14: Capturer le coût image sans persister le binaire

**Files:**
- Modify: `src/hooks/useChat.ts:39-47,310-339`
- Modify: `src/components/chat/InputBar.tsx:16-65`
- Modify: `src/components/chat/InputBar.test.tsx:20-70`

- [ ] **Step 1: Écrire le test rouge des dimensions éphémères**

Dans `InputBar.test.tsx`, stubber `createImageBitmap` :

Étendre le `afterEach` existant avec `vi.unstubAllGlobals()` pour garantir le
nettoyage même si une assertion échoue.

```ts
it("transmet les dimensions de l’image sans les rendre persistantes", async () => {
  const close = vi.fn()
  vi.stubGlobal("createImageBitmap", vi.fn().mockResolvedValue({ width: 1920, height: 1080, close }))
  renderBar()
  const input = document.getElementById("image-upload") as HTMLInputElement
  const file = new File([new Uint8Array(1)], "shot.png", { type: "image/png" })
  fireEvent.change(input, { target: { files: [file] } })
  await waitFor(() => expect(screen.getByText("shot.png")).toBeTruthy())
  fireEvent.change(screen.getByPlaceholderText(/Écrivez/), { target: { value: "voici" } })
  fireEvent.click(screen.getByRole("button", { name: /Envoyer/ }))
  await waitFor(() => expect(onSend).toHaveBeenCalledWith(
    "voici",
    [expect.objectContaining({ width: 1920, height: 1080 })],
    { forceWeb: false },
  ))
  expect(close).toHaveBeenCalledTimes(1)
  vi.unstubAllGlobals()
})
```

Dans `useChat.test.tsx`, vérifier que l’INSERT user sérialise seulement
`id`, `name`, `mimeType` et `kind`, sans `base64`, `width` ni `height`.

- [ ] **Step 2: Exécuter les tests et confirmer l’échec**

```bash
powershell.exe -NoProfile -Command "Set-Location 'C:\dev\LogAssist'; npx vitest run src/components/chat/InputBar.test.tsx src/hooks/useChat.test.tsx"
```

Expected: dimensions absentes.

- [ ] **Step 3: Étendre `Attachment`**

```ts
width?: number
height?: number
```

Ces champs ne sont valides que pour `kind: "image"` et ne sont pas inclus dans
le JSON de persistance.

- [ ] **Step 4: Lire les dimensions en mémoire**

Ajouter :

```ts
async function imageDimensions(file: File): Promise<{ width: number; height: number } | undefined> {
  if (typeof createImageBitmap !== "function") return undefined
  const bitmap = await createImageBitmap(file)
  try {
    return bitmap.width > 0 && bitmap.height > 0
      ? { width: bitmap.width, height: bitmap.height }
      : undefined
  } finally {
    bitmap.close()
  }
}
```

Dans la conversion, lancer lecture Base64 et dimensions en parallèle, puis
retourner les dimensions si disponibles. Une erreur de lecture des dimensions
ne doit pas rejeter une image dont le Base64 a réussi : utiliser `catch(() =>
undefined)` uniquement autour de `imageDimensions`.

- [ ] **Step 5: Transmettre les dimensions à `ChatMessage.images`**

```ts
apiImages.push({
  base64: att.base64,
  mimeType: att.mimeType,
  ...(att.width ? { width: att.width } : {}),
  ...(att.height ? { height: att.height } : {}),
})
```

L’adaptateur HTTP continue de produire uniquement `data:...;base64,...`; les
dimensions servent au budget local.

- [ ] **Step 6: Relancer les tests ciblés**

```bash
powershell.exe -NoProfile -Command "Set-Location 'C:\dev\LogAssist'; npx vitest run src/components/chat/InputBar.test.tsx src/hooks/useChat.test.tsx"
```

Expected: PASS.

- [ ] **Step 7: Committer les métadonnées image**

```bash
git add src/hooks/useChat.ts src/hooks/useChat.test.tsx src/components/chat/InputBar.tsx src/components/chat/InputBar.test.tsx
git commit -m "feat: estime les images avec leurs dimensions éphémères"
```

---

### Task 15: Ajouter les overrides de contexte à l’interface modèle

**Files:**
- Create: `src/components/settings/ModelContextSettings.tsx`
- Create: `src/components/settings/ModelContextSettings.test.tsx`
- Modify: `src/components/settings/ModelPickerModal.tsx`
- Modify: `src/components/settings/ModelPickerModal.test.tsx`
- Modify: `src/components/settings/ProvidersDialog.tsx:296-315`
- Modify: `src/components/settings/ProvidersDialog.test.tsx`
- Modify: `src/i18n/fr.ts:97-148`

- [ ] **Step 1: Écrire les tests rouges du formulaire**

Créer `ModelContextSettings.test.tsx` :

```ts
it("enregistre deux entiers ou null pour revenir à la détection automatique", async () => {
  const onSave = vi.fn().mockResolvedValue(undefined)
  const { rerender } = render(
    <ModelContextSettings
      modelLabel="qwen3.5-9b"
      contextWindowOverride={8192}
      maxOutputTokensOverride={1024}
      onSave={onSave}
      onClose={vi.fn()}
    />,
  )
  fireEvent.change(screen.getByLabelText(t.providers.contextWindow), { target: { value: "16384" } })
  fireEvent.change(screen.getByLabelText(t.providers.maxOutputTokens), { target: { value: "2048" } })
  fireEvent.click(screen.getByRole("button", { name: t.providers.saveContext }))
  await waitFor(() => expect(onSave).toHaveBeenCalledWith({
    contextWindowOverride: 16384,
    maxOutputTokensOverride: 2048,
  }))

  rerender(
    <ModelContextSettings
      modelLabel="qwen3.5-9b"
      contextWindowOverride={null}
      maxOutputTokensOverride={null}
      onSave={onSave}
      onClose={vi.fn()}
    />,
  )
  fireEvent.click(screen.getByRole("button", { name: t.providers.saveContext }))
  await waitFor(() => expect(onSave).toHaveBeenLastCalledWith({
    contextWindowOverride: null,
    maxOutputTokensOverride: null,
  }))
})
```

Ajouter un test qui saisit sortie `4096` pour fenêtre `4096`, attend un
`role="alert"` et vérifie que `onSave` n’est pas appelé.

- [ ] **Step 2: Écrire le test rouge de l’accès depuis le picker**

Étendre `PickerModel` avec les deux overrides. Ajouter `onConfigure(model)` et
attendre qu’un bouton nommé `Contexte — qwen3.5-9b` appelle cette callback sans
activer le modèle.

- [ ] **Step 3: Exécuter les tests et confirmer l’échec**

```bash
powershell.exe -NoProfile -Command "Set-Location 'C:\dev\LogAssist'; npx vitest run src/components/settings/ModelContextSettings.test.tsx src/components/settings/ModelPickerModal.test.tsx src/components/settings/ProvidersDialog.test.tsx"
```

Expected: composant et chaînes absents.

- [ ] **Step 4: Ajouter les chaînes i18n**

Dans `t.providers` :

```ts
contextSettings: "Contexte du modèle",
contextWindow: "Fenêtre de contexte (tokens)",
maxOutputTokens: "Réserve maximale de sortie (tokens)",
automaticContext: "Vide : détection automatique avec repli prudent.",
saveContext: "Enregistrer le contexte",
invalidContextWindow: "La fenêtre doit être comprise entre 512 et 2000000 tokens.",
invalidOutputTokens: "La sortie doit être positive et inférieure à la fenêtre configurée.",
```

- [ ] **Step 5: Implémenter le formulaire accessible**

Deux inputs `type="number"`, `min`, `max`, un texte d’aide, un `role="alert"`,
Annuler et Enregistrer. Une chaîne vide devient `null`; toute autre valeur doit
être un entier dans les bornes du repository. Le composant ne lit ni n’écrit la
base directement.

- [ ] **Step 6: Câbler le picker et ProvidersDialog**

`ProvidersDialog` conserve `configuringModel: ModelRow | null`. Il passe les
overrides au picker, ouvre `ModelContextSettings`, puis appelle :

```ts
await providers.updateModelContext(configuringModel.id, overrides)
await afterChange()
setConfiguringModel(null)
```

Chaque ligne du picker devient un `<div>` contenant deux boutons frères : un
bouton principal d’activation et un bouton `Settings2` de configuration. Aucun
bouton n’est imbriqué dans un autre bouton. Le bouton de configuration utilise
`type="button"`, un nom accessible et n’appelle jamais `onSelect`.

- [ ] **Step 7: Relancer les tests ciblés**

```bash
powershell.exe -NoProfile -Command "Set-Location 'C:\dev\LogAssist'; npx vitest run src/components/settings/ModelContextSettings.test.tsx src/components/settings/ModelPickerModal.test.tsx src/components/settings/ProvidersDialog.test.tsx"
```

Expected: PASS.

- [ ] **Step 8: Committer les réglages modèle**

```bash
git add src/components/settings/ModelContextSettings.tsx src/components/settings/ModelContextSettings.test.tsx src/components/settings/ModelPickerModal.tsx src/components/settings/ModelPickerModal.test.tsx src/components/settings/ProvidersDialog.tsx src/components/settings/ProvidersDialog.test.tsx src/i18n/fr.ts
git commit -m "feat: permet de corriger la fenêtre d un modèle"
```

---

### Task 16: Ajouter les scénarios de régression volumineux et de confidentialité

**Files:**
- Modify: `src/lib/context/contextPlanner.test.ts`
- Modify: `src/lib/context/knowledgeRetriever.test.ts`
- Modify: `src/lib/context/diagnostics.test.ts`
- Modify: `src/lib/mcp/toolAgent.test.ts`
- Modify: `src/hooks/useChat.test.tsx`
- Modify: `src/console-log.guard.test.ts`

- [ ] **Step 1: Ajouter une bibliothèque synthétique volumineuse**

Construire 100 documents de 40 sections chacun, avec un seul passage contenant la
sentinelle `oscillateur_polyphonique`. Attendre :

```ts
const ranked = retriever.search("oscillateur_polyphonique", documents)
expect(ranked[0].content).toContain("oscillateur_polyphonique")
expect(ranked[0].documentId).toBe("doc-73")
```

Ne pas imposer un seuil temporel fragile dans Vitest. Vérifier plutôt que le
deuxième appel avec les mêmes documents réutilise le cache au moyen d’un compteur
de chunking injecté dans le retriever.

- [ ] **Step 2: Ajouter une conversation de 500 messages**

Préparer 250 tours, placer une ancienne erreur `CUDA out of memory` et poser une
question finale sur CUDA. Attendre :

```ts
expect(round.request.messages.at(-1)?.content).toContain("CUDA")
expect(round.request.messages.some((message) => message.content.includes("CUDA out of memory"))).toBe(true)
expect(round.stats.omitted.historyTurns).toBeGreaterThan(0)
expect(round.stats.totalWithReserve).toBeLessThanOrEqual(profile.contextWindowTokens)
```

- [ ] **Step 3: Ajouter images, outils et résultats MCP dans le même budget**

Créer une fenêtre 8 192, deux images 1920×1080, quatre outils aux schémas longs et
un résultat MCP de 100 000 caractères. Attendre soit un plan inférieur ou égal à
8 192, soit une `ApiError` locale `context_length`; dans les deux cas, un mock
`provider.runTurn` ne doit jamais recevoir une requête estimée au-dessus de la
fenêtre.

- [ ] **Step 4: Ajouter les sentinelles de confidentialité**

Utiliser quatre valeurs distinctes : clé LLM, Base64, contenu Markdown privé et
résultat MCP privé. Sérialiser tous les appels à `logger.debug` et attendre
l’absence des quatre valeurs, tout en vérifiant la présence des IDs, compteurs et
raisons d’omission.

- [ ] **Step 5: Exécuter les tests de contexte et chat**

```bash
powershell.exe -NoProfile -Command "Set-Location 'C:\dev\LogAssist'; npx vitest run src/lib/context src/lib/mcp/toolAgent.test.ts src/hooks/useChat.test.tsx src/console-log.guard.test.ts"
```

Expected: PASS.

- [ ] **Step 6: Committer les régressions**

```bash
git add src/lib/context src/lib/mcp/toolAgent.test.ts src/hooks/useChat.test.tsx src/console-log.guard.test.ts
git commit -m "test: couvre les contextes volumineux et privés"
```

---

### Task 17: Nettoyer la compatibilité transitoire et vérifier les invariants

**Files:**
- Modify: `src/lib/chat/turnRunner.ts`
- Modify: `src/lib/chat/turnRunner.test.ts`
- Modify: `src/hooks/useChat.ts`
- Modify: `src/lib/prompts/compose.ts`
- Modify: `src/lib/prompts/compose.test.ts`
- Inspect: `src/lib/chat/contextBuilder.ts`
- Inspect: `src/lib/token/estimate.ts`
- Inspect: `src/lib/token/pricing.ts`

- [ ] **Step 1: Rechercher les anciens chemins non bornés**

Run:

```bash
rg "buildChatMessages|provider\.runTurn|MAX_INJECTED_CHARS|getTiktokenModel\(" src
```

Expected final :

- `provider.runTurn` uniquement derrière la préparation du runner/tool agent ;
- `MAX_INJECTED_CHARS` peut subsister seulement comme plafond mémoire supérieur ;
- aucun consommateur actif de `buildChatMessages` ;
- aucun fallback tiktoken universel dans le préflight.

- [ ] **Step 2: Retirer `request` de compatibilité du contrat TurnRunner**

Quand tous les appels `runAssistantTurn` transmettent `context`, rendre `context`
obligatoire et supprimer la session passthrough. Mettre à jour les tests pour
prouver qu’aucun appel direct non préparé n’est possible par le type public.

- [ ] **Step 3: Supprimer le code mort confirmé**

Supprimer `contextBuilder.ts` et son test s’ils n’ont plus aucun import. Supprimer
`getTiktokenModel()` si `rg` confirme qu’il n’a plus de consommateur. Ne supprimer
aucun autre fichier ou fonction sans preuve d’absence d’usage.

Après migration de `useChat`, retirer aussi le paramètre `knowledge` et
`KnowledgeSection` de `buildSystemPrompt`, ainsi que les anciens tests qui
attendaient l’injection intégrale. Conserver et tester `buildKnowledgePrompt`, qui
est désormais l’unique chemin d’injection des passages sélectionnés.

- [ ] **Step 4: Exécuter TypeScript avant commit**

```bash
powershell.exe -NoProfile -Command "Set-Location 'C:\dev\LogAssist'; npx tsc --noEmit"
```

Expected: PASS.

- [ ] **Step 5: Exécuter les tests des frontières**

```bash
powershell.exe -NoProfile -Command "Set-Location 'C:\dev\LogAssist'; npx vitest run src/lib/chat/turnRunner.test.ts src/lib/mcp/toolAgent.test.ts src/hooks/useChat.test.tsx"
```

Expected: PASS.

- [ ] **Step 6: Committer le nettoyage**

```bash
git add -u src/lib/chat src/lib/token src/hooks/useChat.ts src/lib/prompts
git add src/lib/chat/turnRunner.ts src/lib/chat/turnRunner.test.ts src/lib/mcp/toolAgent.ts src/lib/mcp/toolAgent.test.ts src/lib/prompts/compose.ts src/lib/prompts/compose.test.ts
git commit -m "refactor: interdit les appels fournisseur non bornés"
```

---

### Task 18: Mettre à jour la documentation et exécuter toutes les gates

**Files:**
- Modify: `README.md`
- Modify: `AGENTS.md`
- Modify: `docs/superpowers/plans/2026-11-13-context-engine-rag.md`

- [ ] **Step 1: Documenter le comportement utilisateur**

Ajouter au README une section concise expliquant :

- recherche locale des passages Markdown actifs ;
- conservation complète des originaux et de SQLite ;
- sélection dynamique de l’historique ;
- détection LM Studio et override manuel ;
- erreur explicite quand les éléments obligatoires ne tiennent pas ;
- absence de résumé automatique dans cette version.

- [ ] **Step 2: Mettre à jour les invariants techniques**

Dans `AGENTS.md` :

- passer le schéma courant à V11 ;
- ajouter l’invariant « tout appel fournisseur passe par `ContextSession` » ;
- noter que le Base64 ne participe jamais à l’estimation image ;
- noter que les diagnostics de contexte ne contiennent que IDs et compteurs ;
- indiquer les nouveaux fichiers `src/lib/context/`.

- [ ] **Step 3: Exécuter TypeScript**

```bash
powershell.exe -NoProfile -Command "Set-Location 'C:\dev\LogAssist'; npx tsc --noEmit"
```

Expected: PASS.

- [ ] **Step 4: Exécuter toute la suite Vitest**

```bash
powershell.exe -NoProfile -Command "Set-Location 'C:\dev\LogAssist'; npm run test"
```

Expected: tous les tests passent. Consigner le nombre exact.

- [ ] **Step 5: Exécuter le build Windows**

```bash
powershell.exe -NoProfile -Command "Set-Location 'C:\dev\LogAssist'; npm run build"
```

Expected: TypeScript, Vitest et bundle Vite passent.

- [ ] **Step 6: Exécuter les tests Rust**

```bash
powershell.exe -NoProfile -Command "Set-Location 'C:\dev\LogAssist\src-tauri'; cargo test"
```

Expected: PASS.

- [ ] **Step 7: Exécuter Clippy sans warning**

```bash
powershell.exe -NoProfile -Command "Set-Location 'C:\dev\LogAssist\src-tauri'; cargo clippy --all-targets -- -D warnings"
```

Expected: PASS sans warning.

- [ ] **Step 8: Vérifier le diff et l’absence de données sensibles**

```bash
git diff --check
git status --short
rg "PRIVATE_SENTINEL|PRIVATE_KEY|PRIVATE_BASE64" src --glob '!*.test.ts' --glob '!*.test.tsx'
```

Expected: aucun problème de whitespace ; seules les modifications attendues ;
aucune sentinelle dans le code de production.

- [ ] **Step 9: Committer la documentation finale**

```bash
git add README.md AGENTS.md
git add -f docs/superpowers/plans/2026-11-13-context-engine-rag.md
git commit -m "docs: décrit la gestion intelligente du contexte"
```

- [ ] **Step 10: Pousser la branche**

```bash
git push origin feat/context-engine-rag
```

- [ ] **Step 11: Ouvrir la PR sans fusion automatique**

```bash
gh pr create --base feat/m1-socle-chat --head feat/context-engine-rag --title "feat: gestion intelligente du contexte IA" --body "Implémente le moteur de contexte centralisé, le RAG Markdown local, la sélection d’historique, la détection de fenêtre LM Studio et le budget de tous les tours MCP. Préserve les données SQLite, le streaming, l’annulation, la vision et le contrat anti-perte."
```

Expected: URL d’une nouvelle PR vers `feat/m1-socle-chat`. Si une PR existe déjà
pour cette branche, récupérer son URL avec :

```bash
gh pr view feat/context-engine-rag --json url --jq .url
```

- [ ] **Step 12: Préparer le rapport final**

Le rapport final doit contenir :

- causes confirmées ;
- architecture et fichiers principaux ;
- migration V11 ;
- stratégie RAG et historique ;
- comportement images et MCP ;
- résultats exacts TypeScript, Vitest, build, Rust et Clippy ;
- limites restantes : tokenizer local estimé, BM25 lexical et absence de résumé ;
- lien de PR vers `feat/m1-socle-chat` sans fusion automatique.

---

## Critères de fin du plan

- Aucun document ni message SQLite n’est supprimé ou tronqué.
- La sélection globale/par conversation est inchangée.
- Le premier message avec une grande bibliothèque ne concatène plus tous les documents.
- Le user courant et ses pièces jointes restent intégraux ou produisent une erreur locale claire.
- La fenêtre chargée LM Studio est préférée au maximum théorique.
- Tous les tours directs, retry, régénération et MCP sont replanifiés.
- Les schémas et résultats MCP sont comptés en tokens.
- Le fournisseur n’est jamais appelé avec un plan local au-dessus de la fenêtre.
- Les diagnostics ne contiennent aucun contenu privé, secret ou Base64.
- `useChat.send()` conserve exactement son contrat anti-perte.
- Toutes les gates de la Task 18 passent avant demande de revue.
