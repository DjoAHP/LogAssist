# Chat Engine — Palier 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extraire l'exécution d'un tour hors de `useChat`, persister des métriques honnêtes par réponse et supprimer l'affichage cumulatif trompeur, sans modifier l'identité visuelle ni le comportement fonctionnel du chat.

**Architecture:** Le palier introduit deux unités pures (`contextBuilder` et `turnRunner`) entre le hook React et les adaptateurs existants. Les adaptateurs remontent l'usage lorsqu'il est fourni ; sinon un estimateur local calcule les tokens une seule fois à la fin du tour. SQLite V6 persiste ces métriques optionnelles afin que `ChatView` affiche les données propres à chaque réponse ; SQLite V7 nettoie les anciens diagnostics fournisseur non vérifiables et V8 répare le cas de développement où l'ancienne V7 aurait laissé un assistant vide sans erreur.

**Tech Stack:** React 19, TypeScript strict, Vitest 5, Testing Library, Tauri SQL/SQLite, `@dqbd/tiktoken`, adaptateurs OpenAI-compatible et MCP TinyFish existants.

---

## Périmètre strict du palier

Ce plan implémente uniquement :

- migration V6 pour les métriques par réponse ;
- migration V7 pour le nettoyage des erreurs legacy ;
- migration V8 idempotente pour réparer les assistants vides passés à `error = NULL` par l'ancienne V7 de développement ;
- usage fournisseur optionnel et estimation locale ;
- extraction de la construction actuelle du contexte, sans fenêtre glissante ni résumé ;
- extraction de l'exécution directe/Web dans `TurnRunner` ;
- intégration de `TurnRunner` dans `useChat` en préservant le contrat anti-perte ;
- affichage des métriques du message concerné ;
- suppression du calcul cumulatif effectué dans `ChatView`.

Ce plan n'implémente pas encore :

- budget de contexte, résumé ou `CapabilityRegistry` ;
- nouvelle présentation hybride, nouveau composeur ou nouvel auto-scroll ;
- retry, continuation ou régénération ;
- changement du comportement éphémère des images ;
- nouvelle famille de fournisseur.

## Carte des fichiers

### Nouveaux fichiers

- `src/lib/chat/contextBuilder.ts` — transforme le prompt système, les lignes SQLite et les images courantes en `ChatMessage[]`.
- `src/lib/chat/contextBuilder.test.ts` — verrouille la reproduction exacte du contexte actuel.
- `src/lib/chat/turnRunner.ts` — choisit le chemin direct ou Web et retourne un résultat uniforme sans dépendre de React.
- `src/lib/chat/turnRunner.test.ts` — couvre chemins direct, Web, annulation et propagation d'erreur.
- `src/lib/token/estimate.ts` — compte une fois l'entrée et la sortie, choisit le tarif connu et produit un coût optionnel.
- `src/lib/token/estimate.test.ts` — couvre estimation, usage fournisseur et coût inconnu.
- `src/lib/token/format.ts` — formate tokens et coût stocké en microdollars.
- `src/lib/token/format.test.ts` — verrouille les unités et arrondis affichés.
- `src/lib/token/pricing.test.ts` — garantit qu'un modèle inconnu ne reçoit aucun faux tarif.
- `src/lib/token/types.ts` — contrat partagé des métriques, sans dépendance vers React ou SQLite.

### Fichiers modifiés

- `src/lib/db/migrations.ts` et `src/lib/db/database.ts` — migrations V6 des métriques, V7 de nettoyage conservateur et V8 de réparation UX.
- `src/lib/db/migrations.test.ts` — contrat de la migration.
- `src/lib/db/messages.ts` et `src/lib/db/messages.test.ts` — lecture/écriture des métriques optionnelles.
- `src/lib/ai/types.ts` — type `TokenUsage` et usage optionnel dans les résultats.
- `src/lib/ai/openai-compat.ts` et son test — demande d'usage réservée à l'endpoint OpenAI officiel, puis lecture opportuniste du champ `usage` SSE/JSON.
- `src/lib/mcp/webAgent.ts` et son test — agrégation de l'usage quand tous les tours le fournissent.
- `src/hooks/useChat.ts` et son test — délégation au runner et persistance des métriques.
- `src/components/chat/ChatView.tsx` et son test — métriques propres au message, sans comptage global.
- `src/App.tsx` et `src/App.test.tsx` — retrait des props utilisées uniquement par l'ancien compteur global.
- `src/lib/token/index.ts` et `src/lib/token/pricing.ts` — nouveaux exports et tarif nullable.
- `src/i18n/fr.ts` — libellé d'estimation accessible.

### Fichier supprimé

- `src/lib/token/useTokenCount.ts` — hook cumulatif devenu inutile ; ses fonctions de formatage sont déplacées dans `format.ts`.

---

### Task 1: Enregistrer la référence avant refactorisation

**Files:**
- Inspect: `package.json`
- Inspect: `src/hooks/useChat.test.tsx`
- Inspect: `src/lib/ai/openai-compat.test.ts`

- [ ] **Step 1: Vérifier la branche et l'absence de modifications fonctionnelles**

Run:

```bash
git status --short --branch
```

Expected:

```text
## feat/chat-engine-modernization
```

- [ ] **Step 2: Exécuter les tests TypeScript de référence sous WSL**

Run:

```bash
npm run test
```

Expected: tous les tests Vitest passent. Noter le nombre exact de tests dans le journal d'exécution du plan.

- [ ] **Step 3: Vérifier le typecheck et le bundle Vite sans réinstaller les dépendances**

Run:

```bash
npm run build
```

Expected: `tsc`, `vitest run` et `vite build` passent. Ne jamais lancer `npm install` depuis WSL.

- [ ] **Step 4: Créer un commit uniquement si une note de référence suivie est ajoutée**

Par défaut, aucune modification et aucun commit ne sont nécessaires pour cette tâche. Si un échec de référence apparaît, arrêter le plan : il doit être diagnostiqué séparément avant toute implémentation.

---

### Task 2: Ajouter les métriques V6, le nettoyage V7 et la réparation V8

**Files:**
- Modify: `src/lib/db/migrations.ts:1-144`
- Modify: `src/lib/db/database.ts:1-62`
- Test: `src/lib/db/migrations.test.ts:1-73`

- [ ] **Step 1: Écrire les tests rouges des migrations V6, V7 et V8**

Ajouter `SCHEMA_V6_STATEMENTS`, `SCHEMA_V7_STATEMENTS` et `SCHEMA_V8_STATEMENTS` à l'import de
`src/lib/db/migrations.test.ts`, passer l'attente de version à `8`, puis verrouiller
les statements et leur ordre d'exécution :

```ts
describe("SCHEMA_V6_STATEMENTS", () => {
  it("ajoute des métriques optionnelles aux réponses historiques", () => {
    expect(SCHEMA_V6_STATEMENTS).toEqual([
      "ALTER TABLE messages ADD COLUMN first_token_ms INTEGER",
      "ALTER TABLE messages ADD COLUMN input_tokens INTEGER",
      "ALTER TABLE messages ADD COLUMN output_tokens INTEGER",
      "ALTER TABLE messages ADD COLUMN usage_source TEXT CHECK (usage_source IN ('provider','estimated'))",
      "ALTER TABLE messages ADD COLUMN cost_microusd INTEGER",
    ])
  })
})

describe("SCHEMA_V7_STATEMENTS", () => {
  it("nettoie les erreurs legacy", () => {
    expect(SCHEMA_V7_STATEMENTS).toEqual([
      `UPDATE messages SET error = CASE WHEN error = '{"interrupted":true}' THEN '{"interrupted":true}' ELSE '{"kind":"unknown","message":""}' END WHERE error IS NOT NULL`,
    ])
  })
})

describe("SCHEMA_V8_STATEMENTS", () => {
  it("répare les assistants vides sans erreur", () => {
    expect(SCHEMA_V8_STATEMENTS).toEqual([
      `UPDATE messages SET error = '{"kind":"unknown","message":""}' WHERE role = 'assistant' AND content = '' AND error IS NULL`,
    ])
  })
})
```

Le test comportemental de `executeSchema` doit aussi prouver qu'une base V7 exécute
uniquement V8, qu'une base V6 exécute V7 puis V8 et qu'une base V5 exécute les cinq
statements V6, puis V7 et V8.

- [ ] **Step 2: Lancer le test pour confirmer l'échec**

Run:

```bash
npx vitest run src/lib/db/migrations.test.ts
```

Expected: FAIL tant que `SCHEMA_V8_STATEMENTS` n'existe pas, qu'une base V7
n'exécute aucune réparation et que `SCHEMA_VERSION` vaut encore `7`.

- [ ] **Step 3: Implémenter les migrations V6, V7 et V8**

Dans `src/lib/db/migrations.ts`, remplacer la version et ajouter après V5 :

```ts
export const SCHEMA_VERSION = 8

export const SCHEMA_V6_STATEMENTS: string[] = [
  "ALTER TABLE messages ADD COLUMN first_token_ms INTEGER",
  "ALTER TABLE messages ADD COLUMN input_tokens INTEGER",
  "ALTER TABLE messages ADD COLUMN output_tokens INTEGER",
  "ALTER TABLE messages ADD COLUMN usage_source TEXT CHECK (usage_source IN ('provider','estimated'))",
  "ALTER TABLE messages ADD COLUMN cost_microusd INTEGER",
]

export const SCHEMA_V7_STATEMENTS: string[] = [
  `UPDATE messages SET error = CASE WHEN error = '{"interrupted":true}' THEN '{"interrupted":true}' ELSE '{"kind":"unknown","message":""}' END WHERE error IS NOT NULL`,
]

export const SCHEMA_V8_STATEMENTS: string[] = [
  `UPDATE messages SET error = '{"kind":"unknown","message":""}' WHERE role = 'assistant' AND content = '' AND error IS NULL`,
]
```

Le statement V7 assume explicitement la perte des anciens diagnostics fournisseur, JSON
ou non JSON, car leur absence de clé exacte empêche de garantir leur innocuité. Le
payload canonique `{"interrupted":true}` généré par l'application reste intact ; toute
autre erreur devient le marqueur non sensible `{"kind":"unknown","message":""}` afin
qu'une réponse vide ou partielle ne soit jamais présentée comme un succès. Les contenus,
sources et autres colonnes des messages ne sont pas modifiés.

V7 corrigée n'a jamais été distribuée ni fusionnée, mais V8 rend le développement
robuste si une base locale a déjà exécuté son ancienne forme qui mettait `error` à
`NULL`. Cette réparation idempotente ne peut pas retrouver les erreurs partielles dont
l'information a été effacée. Elle couvre seulement le cas UX critique
assistant vide/spinner permanent. Une rare réponse assistant réellement vide peut donc
être classée comme erreur générique : ce choix conservateur est préférable à une attente
infinie affichée à l'utilisateur.

Dans `src/lib/db/database.ts`, importer les trois listes puis exécuter V7 après V6 et V8 après V7 :

```ts
if (fromVersion < 6) {
  for (const statement of SCHEMA_V6_STATEMENTS) {
    await db.execute(statement)
  }
}
if (fromVersion < 7) {
  for (const statement of SCHEMA_V7_STATEMENTS) {
    await db.execute(statement)
  }
}
if (fromVersion < 8) {
  for (const statement of SCHEMA_V8_STATEMENTS) {
    await db.execute(statement)
  }
}
```

Le palier V7 séparé est obligatoire pour qu'une base déjà marquée `user_version=6`
exécute le nettoyage lors de l'upgrade V6→V7 sans rejouer les `ALTER` de métriques.

- [ ] **Step 4: Relancer le test de migration**

Run:

```bash
npx vitest run src/lib/db/migrations.test.ts
```

Expected: PASS.

- [ ] **Step 5: Committer la migration seule**

```bash
git add src/lib/db/migrations.ts src/lib/db/database.ts src/lib/db/migrations.test.ts
git commit -m "feat: ajoute les métriques de message en base"
```

---

### Task 3: Étendre le repository `messages`

**Files:**
- Create: `src/lib/token/types.ts`
- Modify: `src/lib/db/messages.ts:3-50`
- Test: `src/lib/db/messages.test.ts:16-63`

- [ ] **Step 1: Écrire les attentes rouges de lecture et d'insertion**

Dans le premier mock de `messages.test.ts`, fournir les colonnes V6 à `null`. Dans le test d'insertion, fournir les valeurs suivantes et attendre quatorze binds :

```ts
first_token_ms: 180,
input_tokens: 240,
output_tokens: 80,
usage_source: "provider",
cost_microusd: 420,
```

Ajouter les assertions :

```ts
expect(bind).toHaveLength(14)
expect(bind.slice(9)).toEqual([180, 240, 80, "provider", 420])
```

Ajouter un second test d'insertion qui omet toutes les métriques :

```ts
it("insère NULL pour les métriques absentes", async () => {
  mockExecute.mockResolvedValueOnce({ rowsAffected: 1 })
  await messages.insert({
    conversation_id: "c1",
    role: "user",
    content: "question",
    attachments: "[]",
    model_label: null,
    latency_ms: null,
    error: null,
  })
  const bind = mockExecute.mock.calls[0][1]
  expect(bind.slice(9)).toEqual([null, null, null, null, null])
})
```

- [ ] **Step 2: Vérifier que les tests échouent**

Run:

```bash
npx vitest run src/lib/db/messages.test.ts
```

Expected: FAIL avec neuf binds au lieu de quatorze.

- [ ] **Step 3: Étendre les types et l'INSERT**

Créer d'abord `src/lib/token/types.ts` :

```ts
export type UsageSource = "provider" | "estimated"

export interface TurnMetrics {
  inputTokens: number
  outputTokens: number
  usageSource: UsageSource
  costMicrousd: number | null
}
```

Puis importer `UsageSource` et remplacer les types en tête de `src/lib/db/messages.ts` par :

```ts
import type { UsageSource } from "@/lib/token/types"

export interface MessageRow {
  id: string
  conversation_id: string
  role: "user" | "assistant"
  content: string
  attachments: string
  model_label: string | null
  latency_ms: number | null
  error: string | null
  sources: string
  first_token_ms: number | null
  input_tokens: number | null
  output_tokens: number | null
  usage_source: UsageSource | null
  cost_microusd: number | null
}

type MetricColumns = Pick<
  MessageRow,
  "first_token_ms" | "input_tokens" | "output_tokens" | "usage_source" | "cost_microusd"
>

type MessageInsert = Omit<MessageRow, "id" | "sources" | keyof MetricColumns> &
  Partial<MetricColumns> & { sources?: string }
```

Remplacer la requête et ses binds dans `insert` par :

```ts
await execute(
  "INSERT INTO messages (id, conversation_id, role, content, attachments, model_label, latency_ms, error, sources, first_token_ms, input_tokens, output_tokens, usage_source, cost_microusd) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
  [
    id,
    row.conversation_id,
    row.role,
    row.content,
    row.attachments,
    row.model_label,
    row.latency_ms,
    row.error,
    row.sources ?? "[]",
    row.first_token_ms ?? null,
    row.input_tokens ?? null,
    row.output_tokens ?? null,
    row.usage_source ?? null,
    row.cost_microusd ?? null,
  ],
)
```

Dans `listByConversation`, normaliser les anciennes valeurs simulées :

```ts
return rows.map((row) => ({
  ...row,
  sources: row.sources ?? "[]",
  first_token_ms: row.first_token_ms ?? null,
  input_tokens: row.input_tokens ?? null,
  output_tokens: row.output_tokens ?? null,
  usage_source: row.usage_source ?? null,
  cost_microusd: row.cost_microusd ?? null,
}))
```

- [ ] **Step 4: Relancer les tests du repository**

Run:

```bash
npx vitest run src/lib/db/messages.test.ts
```

Expected: PASS.

- [ ] **Step 5: Committer le repository**

```bash
git add src/lib/token/types.ts src/lib/db/messages.ts src/lib/db/messages.test.ts
git commit -m "feat: persiste les métriques par réponse"
```

---

### Task 4: Remonter l'usage fourni par les APIs

**Files:**
- Modify: `src/lib/ai/types.ts:8-57`
- Modify: `src/lib/ai/openai-compat.ts:107-199`
- Test: `src/lib/ai/openai-compat.test.ts`
- Modify: `src/lib/mcp/webAgent.ts:86-263`
- Test: `src/lib/mcp/webAgent.test.ts`

- [ ] **Step 1: Écrire le test rouge du champ SSE `usage`**

Dans le bloc `runTurn` de `openai-compat.test.ts`, ajouter :

```ts
it("remonte l'usage du chunk final quand le fournisseur le fournit", async () => {
  const stream = sseStream([
    sseData({ choices: [{ delta: { content: "Bonjour" } }] }),
    sseData({
      choices: [{ delta: {} }],
      usage: { prompt_tokens: 120, completion_tokens: 30, total_tokens: 150 },
    }),
    `data: [DONE]${SSE}`,
  ])
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(makeRes({ body: stream })))
  const result = await createOpenAICompatible(CFG).runTurn(
    { messages: [{ role: "user", content: "Salut" }] },
    "K",
    "m",
    {},
    {},
    new AbortController().signal,
  )
  expect(result.usage).toEqual({ inputTokens: 120, outputTokens: 30 })
})
```

- [ ] **Step 2: Confirmer l'échec**

Run:

```bash
npx vitest run src/lib/ai/openai-compat.test.ts
```

Expected: FAIL car `usage` est absent du résultat.

- [ ] **Step 3: Ajouter le type d'usage**

Dans `src/lib/ai/types.ts`, ajouter puis étendre `CompletionStats` :

```ts
export interface TokenUsage {
  inputTokens: number
  outputTokens: number
  cachedInputTokens?: number
}

export interface CompletionStats {
  text: string
  firstTokenMs: number
  totalMs: number
  usage?: TokenUsage
}
```

- [ ] **Step 4: Lire opportunément l'usage dans `runTurn`**

Dans `openai-compat.ts`, importer `TokenUsage`, déclarer avant le `try` :

```ts
let usage: TokenUsage | undefined
```

Après le `JSON.parse`, avant la lecture de `delta`, ajouter :

```ts
const reportedUsage = (json as {
  usage?: { prompt_tokens?: number; completion_tokens?: number }
}).usage
if (
  typeof reportedUsage?.prompt_tokens === "number" &&
  typeof reportedUsage.completion_tokens === "number"
) {
  usage = {
    inputTokens: reportedUsage.prompt_tokens,
    outputTokens: reportedUsage.completion_tokens,
  }
}
```

Ajouter `...(usage ? { usage } : {})` au résultat de `runTurn` :

```ts
return {
  text,
  toolCalls,
  firstTokenMs,
  totalMs: performance.now() - start,
  ...(usage ? { usage } : {}),
}
```

Déterminer une seule fois si la base nettoyée est l'origine officielle stricte OpenAI
(`https:`, hostname exact `api.openai.com`, port vide, aucun username/password). Pour
une requête streamée vers cette origine uniquement, envoyer
`stream_options: { include_usage: true }`. Ne jamais envoyer ce champ à OpenRouter,
localhost ou un endpoint custom, ni lors de `complete()` où `stream` vaut `false`.

- [ ] **Step 5: Relancer le test adaptateur**

Run:

```bash
npx vitest run src/lib/ai/openai-compat.test.ts
```

Expected: PASS, y compris les tests historiques de streaming et outils.

- [ ] **Step 6: Écrire le test rouge d'agrégation Web**

Dans `webAgent.test.ts`, importer `TokenUsage` puis remplacer le helper `turn` par :

```ts
function turn(
  text: string,
  toolCalls: ToolCall[] = [],
  usage?: TokenUsage,
): TurnResult {
  return {
    text,
    toolCalls,
    firstTokenMs: 5,
    totalMs: 20,
    ...(usage ? { usage } : {}),
  }
}
```

Ajouter les deux tests :

```ts
it("additionne l'usage lorsque tous les tours le fournissent", async () => {
  const { input, call } = createHarness([
    turn("", [searchCall("call-1")], { inputTokens: 100, outputTokens: 10 }),
    turn("Réponse sourcée", [], { inputTokens: 160, outputTokens: 40 }),
  ])
  call.mockResolvedValueOnce({ content: "Résultat", sources: [] })

  const result = await runWebAgent(input)

  expect(result.usage).toEqual({ inputTokens: 260, outputTokens: 50 })
})

it("omet l'usage agrégé si un tour ne le fournit pas", async () => {
  const { input, call } = createHarness([
    turn("", [searchCall("call-1")], { inputTokens: 100, outputTokens: 10 }),
    turn("Réponse sourcée"),
  ])
  call.mockResolvedValueOnce({ content: "Résultat", sources: [] })

  const result = await runWebAgent(input)

  expect(result.usage).toBeUndefined()
})
```

- [ ] **Step 7: Implémenter l'agrégation complète ou l'absence d'usage**

Dans `webAgent.ts`, importer `TokenUsage` et ajouter dans `runWebAgent` :

```ts
const reportedUsage: TokenUsage = { inputTokens: 0, outputTokens: 0 }
let allTurnsReportedUsage = true

const collectUsage = (result: TurnResult): void => {
  if (!result.usage) {
    allTurnsReportedUsage = false
    return
  }
  reportedUsage.inputTokens += result.usage.inputTokens
  reportedUsage.outputTokens += result.usage.outputTokens
}
```

Appeler `collectUsage(result)` immédiatement après chaque `provider.runTurn`, y compris dans `runWithoutTools` et le tour final. Étendre `WebAgentResult` :

```ts
usage?: TokenUsage
```

Remplacer `finalResult` par :

```ts
function finalResult(
  result: TurnResult,
  sources: Map<string, WebSource>,
  started: number,
  warning?: string,
  usage?: TokenUsage,
): WebAgentResult {
  return {
    text: result.text,
    firstTokenMs: result.firstTokenMs,
    totalMs: performance.now() - started,
    sources: [...sources.values()],
    ...(warning ? { warning } : {}),
    ...(usage ? { usage } : {}),
  }
}
```

Après chaque `runTurn`, exécuter :

```ts
collectUsage(result)
```

Puis utiliser cette forme pour chaque retour final :

```ts
return finalResult(
  result,
  sources,
  started,
  warning,
  allTurnsReportedUsage ? { ...reportedUsage } : undefined,
)
```

- [ ] **Step 8: Exécuter les deux suites**

Run:

```bash
npx vitest run src/lib/ai/openai-compat.test.ts src/lib/mcp/webAgent.test.ts
```

Expected: PASS.

- [ ] **Step 9: Committer le contrat d'usage**

```bash
git add src/lib/ai/types.ts src/lib/ai/openai-compat.ts src/lib/ai/openai-compat.test.ts src/lib/mcp/webAgent.ts src/lib/mcp/webAgent.test.ts
git commit -m "feat: remonte l usage des tours fournisseur"
```

---

### Task 5: Produire des métriques honnêtes et un coût nullable

**Files:**
- Create: `src/lib/token/estimate.ts`
- Create: `src/lib/token/estimate.test.ts`
- Create: `src/lib/token/format.ts`
- Create: `src/lib/token/format.test.ts`
- Create: `src/lib/token/pricing.test.ts`
- Modify: `src/lib/token/pricing.ts:20-99`
- Modify: `src/lib/token/index.ts:1-2`

- [ ] **Step 1: Écrire les tests rouges du tarif nullable**

Créer `src/lib/token/pricing.test.ts` :

```ts
import { describe, expect, it } from "vitest"
import { getModelPricing, getTiktokenModel } from "./pricing"

describe("pricing", () => {
  it("normalise le nom du fournisseur", () => {
    expect(getModelPricing(" OpenAI ", "gpt-4o-mini")).toMatchObject({
      input: 0.15,
      output: 0.6,
    })
  })

  it("masque les tarifs OpenRouter approximatifs", () => {
    expect(getModelPricing("OpenRouter", "openai/gpt-4o-mini")).toBeNull()
  })

  it("ne fabrique aucun tarif pour un modèle inconnu", () => {
    expect(getModelPricing("Serveur privé", "modele-inconnu")).toBeNull()
  })

  it("conserve un encodeur générique pour un modèle inconnu", () => {
    expect(getTiktokenModel("Serveur privé", "modele-inconnu")).toBe("cl100k_base")
  })

  it("résout le tokenizer indépendamment du tarif fournisseur", () => {
    expect(getTiktokenModel("Serveur privé", "gpt-4o-mini")).toBe("gpt-4o-mini")
  })
})
```

- [ ] **Step 2: Confirmer l'échec sur le faux tarif générique**

Run:

```bash
npx vitest run src/lib/token/pricing.test.ts
```

Expected: FAIL car `getModelPricing` retourne actuellement le tarif `default`.

- [ ] **Step 3: Rendre le tarif nullable**

Dans `pricing.ts`, ajouter :

```ts
function normalizeProvider(provider: string): string {
  return provider.trim().toLowerCase()
}
```

Remplacer les deux fonctions exportées par :

```ts
export function getModelPricing(provider: string, modelId: string): ModelPricing | null {
  const normalizedProvider = normalizeProvider(provider)
  if (normalizedProvider === "openrouter") return null

  const providerPricing = MODEL_PRICING[normalizedProvider]
  return providerPricing?.[modelId] ?? null
}

export function getTiktokenModel(provider: string, modelId: string): TiktokenModel {
  const providerPricing = MODEL_PRICING[normalizeProvider(provider)]?.[modelId]
  if (providerPricing?.tiktokenModel) return providerPricing.tiktokenModel

  for (const pricing of Object.values(MODEL_PRICING)) {
    const knownModel = pricing[modelId]
    if (knownModel?.tiktokenModel) return knownModel.tiktokenModel
  }

  return "cl100k_base" as TiktokenModel
}
```

Les valeurs `input` et `output` sont des prix en USD par **million** de tokens. Le bloc
`default` peut rester pour compatibilité de l'ancien compteur, mais aucune nouvelle
fonction ne doit l'utiliser comme tarif réel. Les tarifs OpenRouter approximatifs restent
masqués, tandis que leur registre peut aider à résoudre un tokenizer.

L'identité utilisée pour le coût ne vient jamais de `provider.name`, car ce libellé est
modifiable et ne prouve pas quel service facture la requête. `resolvePricingProvider(baseUrl)`
parse l'URL et ne retourne initialement `"openai"` que pour le host exact
`api.openai.com`; proxy, OpenRouter, localhost, host ressemblant et URL invalide donnent
`null`. Le tokenizer reste résolu séparément grâce au `modelId`.

- [ ] **Step 4: Relancer les tests de pricing**

Run:

```bash
npx vitest run src/lib/token/pricing.test.ts
```

Expected: PASS.

- [ ] **Step 5: Écrire les tests rouges de l'estimateur**

Créer `src/lib/token/estimate.test.ts` :

```ts
import { describe, expect, it } from "vitest"
import { estimateTurnMetrics, metricsFromProviderUsage } from "./estimate"

const messages = [
  { role: "system" as const, content: "Tu aides." },
  { role: "user" as const, content: "Bonjour" },
]

describe("turn metrics", () => {
  it("marque le comptage local comme estimé", () => {
    const metrics = estimateTurnMetrics(messages, "Réponse", "Serveur privé", "modele-inconnu")
    expect(metrics.inputTokens).toBeGreaterThan(0)
    expect(metrics.outputTokens).toBeGreaterThan(0)
    expect(metrics.usageSource).toBe("estimated")
    expect(metrics.costMicrousd).toBeNull()
  })

  it("utilise l'usage fournisseur complet pour calculer un coût", () => {
    const metrics = metricsFromProviderUsage(
      { inputTokens: 1_000, outputTokens: 500, cachedInputTokens: 0 },
      "OpenAI",
      "gpt-4o-mini",
    )
    expect(metrics).toEqual({
      inputTokens: 1_000,
      outputTokens: 500,
      usageSource: "provider",
      costMicrousd: 450,
    })
  })
})
```

- [ ] **Step 6: Vérifier l'échec avant création de l'estimateur**

Run:

```bash
npx vitest run src/lib/token/estimate.test.ts
```

Expected: FAIL car `estimate.ts` n'existe pas.

- [ ] **Step 7: Implémenter l'estimateur avec libération de l'encodeur**

Créer `src/lib/token/estimate.ts` :

```ts
import { encoding_for_model, get_encoding, type Tiktoken } from "@dqbd/tiktoken"
import type { ChatMessage, TokenUsage } from "@/lib/ai/types"
import type { TurnMetrics } from "./types"
import { getModelPricing, getTiktokenModel } from "./pricing"

function createEncoder(provider: string, modelId: string): Tiktoken {
  const model = getTiktokenModel(provider, modelId)
  try {
    return encoding_for_model(model)
  } catch {
    return get_encoding("cl100k_base")
  }
}

function isValidTokenUsage(usage: unknown): usage is TokenUsage {
  if (typeof usage !== "object" || usage === null) return false
  const { inputTokens, outputTokens } = usage as Partial<TokenUsage>
  return typeof inputTokens === "number" &&
    Number.isSafeInteger(inputTokens) &&
    inputTokens >= 0 &&
    typeof outputTokens === "number" &&
    Number.isSafeInteger(outputTokens) &&
    outputTokens >= 0
}

function calculateCostMicrousd(
  usage: TokenUsage,
  provider: string,
  modelId: string,
): number | null {
  const pricing = getModelPricing(provider, modelId)
  const cachedInputTokens = usage.cachedInputTokens
  if (
    !pricing ||
    cachedInputTokens === undefined ||
    cachedInputTokens < 0 ||
    cachedInputTokens > usage.inputTokens ||
    pricing.cachedInput === undefined
  ) return null
  const ordinaryInputTokens = usage.inputTokens - cachedInputTokens
  const microUsd =
    ordinaryInputTokens * pricing.input +
    cachedInputTokens * pricing.cachedInput +
    usage.outputTokens * pricing.output
  if (!Number.isFinite(microUsd) || microUsd < 0) return null
  const roundedMicroUsd = Math.round(microUsd)
  return Number.isSafeInteger(roundedMicroUsd) ? roundedMicroUsd : null
}

export function metricsFromProviderUsage(
  usage: TokenUsage,
  provider: string,
  modelId: string,
): TurnMetrics | null {
  if (!isValidTokenUsage(usage)) return null
  return {
    ...usage,
    usageSource: "provider",
    costMicrousd: calculateCostMicrousd(usage, provider, modelId),
  }
}

export function estimateTurnMetrics(
  messages: ChatMessage[],
  output: string,
  provider: string,
  modelId: string,
): TurnMetrics {
  const encoder = createEncoder(provider, modelId)
  try {
    const inputTokens = messages.reduce(
      (total, message) => total + encoder.encode(message.content).length,
      0,
    )
    const outputTokens = encoder.encode(output).length
    const usage = { inputTokens, outputTokens }
    return {
      ...usage,
      usageSource: "estimated",
      // Une estimation locale ne connaît jamais la part réellement cachée.
      costMicrousd: null,
    }
  } finally {
    encoder.free()
  }
}
```

`metricsFromProviderUsage` valide à l'exécution les compteurs obligatoires comme deux
entiers sûrs positifs ou nuls. Un compteur caché absent ou invalide conserve les tokens
fournisseur, mais rend le coût `null`.
Lors de son intégration, prévoir un fallback vers `estimateTurnMetrics` si elle retourne
`null`, afin qu'un usage fournisseur invalide n'empêche pas la métrique locale.

- [ ] **Step 8: Créer les formateurs sans hook React**

Créer `src/lib/token/format.ts` :

```ts
export function formatCostMicrousd(costMicrousd: number): string {
  const cost = costMicrousd / 1_000_000
  if (cost < 0.0001) return "< $0.0001"
  if (cost < 0.01) return `$${cost.toFixed(4)}`
  if (cost < 1) return `$${cost.toFixed(3)}`
  return `$${cost.toFixed(2)}`
}

export function formatTokens(tokens: number): string {
  if (tokens >= 1_000_000) return `${(tokens / 1_000_000).toFixed(1)}M`
  if (tokens >= 1_000) return `${(tokens / 1_000).toFixed(1)}k`
  return String(tokens)
}
```

Créer `src/lib/token/format.test.ts` :

```ts
import { describe, expect, it } from "vitest"
import { formatCostMicrousd, formatTokens } from "./format"

describe("token formatters", () => {
  it("convertit les microdollars en dollars avant formatage", () => {
    expect(formatCostMicrousd(450)).toBe("$0.0005")
    expect(formatCostMicrousd(450_000)).toBe("$0.450")
  })

  it("compacte les volumes de tokens", () => {
    expect(formatTokens(1_200)).toBe("1.2k")
    expect(formatTokens(120)).toBe("120")
  })
})
```

Remplacer `src/lib/token/index.ts` par :

```ts
export * from "./estimate"
export * from "./format"
export * from "./pricing"
export * from "./types"
```

- [ ] **Step 9: Exécuter les tests token**

Run:

```bash
npx vitest run src/lib/token/pricing.test.ts src/lib/token/estimate.test.ts src/lib/token/format.test.ts
```

Expected: PASS.

- [ ] **Step 10: Committer l'estimation honnête**

```bash
git add src/lib/token/estimate.ts src/lib/token/estimate.test.ts src/lib/token/format.ts src/lib/token/format.test.ts src/lib/token/pricing.ts src/lib/token/pricing.test.ts src/lib/token/types.ts src/lib/token/index.ts
git commit -m "fix: rend les métriques de coût honnêtes"
```

---

### Task 6: Extraire la construction actuelle du contexte

**Files:**
- Create: `src/lib/chat/contextBuilder.ts`
- Create: `src/lib/chat/contextBuilder.test.ts`
- Modify later: `src/hooks/useChat.ts`

- [ ] **Step 1: Écrire les tests rouges du builder pur**

Créer `src/lib/chat/contextBuilder.test.ts` :

```ts
import { describe, expect, it } from "vitest"
import { buildChatMessages } from "./contextBuilder"

describe("buildChatMessages", () => {
  it("place le système avant l'historique et attache les images au dernier user", () => {
    const result = buildChatMessages({
      system: "SYSTEM",
      history: [
        { role: "user", content: "Question" },
        { role: "assistant", content: "Réponse" },
        { role: "user", content: "Capture" },
      ],
      currentImages: [{ base64: "AAAA", mimeType: "image/png" }],
    })
    expect(result).toEqual([
      { role: "system", content: "SYSTEM" },
      { role: "user", content: "Question" },
      { role: "assistant", content: "Réponse" },
      {
        role: "user",
        content: "Capture",
        images: [{ base64: "AAAA", mimeType: "image/png" }],
      },
    ])
  })

  it("omet le système vide et ne mute pas l'historique source", () => {
    const history = [{ role: "user" as const, content: "Question" }]
    const result = buildChatMessages({ system: "  ", history, currentImages: [] })
    expect(result).toEqual([{ role: "user", content: "Question" }])
    expect(history[0]).toEqual({ role: "user", content: "Question" })
  })
})
```

- [ ] **Step 2: Confirmer l'échec du module absent**

Run:

```bash
npx vitest run src/lib/chat/contextBuilder.test.ts
```

Expected: FAIL car `contextBuilder.ts` n'existe pas.

- [ ] **Step 3: Implémenter le builder sans politique de troncature**

Créer `src/lib/chat/contextBuilder.ts` :

```ts
import type { ChatMessage } from "@/lib/ai/types"

interface HistoryMessage {
  role: "user" | "assistant"
  content: string
}

interface BuildChatMessagesInput {
  system: string
  history: HistoryMessage[]
  currentImages: NonNullable<ChatMessage["images"]>
}

export function buildChatMessages(input: BuildChatMessagesInput): ChatMessage[] {
  const messages: ChatMessage[] = [
    ...(input.system.trim()
      ? [{ role: "system" as const, content: input.system }]
      : []),
    ...input.history.map((message) => ({ ...message })),
  ]
  if (input.currentImages.length === 0) return messages

  for (let index = messages.length - 1; index >= 0; index--) {
    const message = messages[index]
    if (message.role !== "user") continue
    messages[index] = { ...message, images: [...input.currentImages] }
    break
  }
  return messages
}
```

- [ ] **Step 4: Relancer les tests du builder**

Run:

```bash
npx vitest run src/lib/chat/contextBuilder.test.ts
```

Expected: PASS.

- [ ] **Step 5: Committer l'unité pure**

```bash
git add src/lib/chat/contextBuilder.ts src/lib/chat/contextBuilder.test.ts
git commit -m "refactor: extrait la construction du contexte chat"
```

---

### Task 7: Extraire `TurnRunner`

**Files:**
- Create: `src/lib/chat/turnRunner.ts`
- Create: `src/lib/chat/turnRunner.test.ts`
- Uses: `src/lib/mcp/webAgent.ts`
- Uses: `src/lib/ai/openai-compat.ts`

- [ ] **Step 1: Écrire les tests rouges des chemins direct et Web**

Créer `src/lib/chat/turnRunner.test.ts` :

```ts
import { describe, expect, it, vi } from "vitest"
import type { IProvider } from "@/lib/ai/openai-compat"
import type { WebAgentInput } from "@/lib/mcp/webAgent"
import { runAssistantTurn } from "./turnRunner"

type WebTurnOptions = Omit<
  WebAgentInput,
  "provider" | "request" | "apiKey" | "modelId" | "callbacks" | "signal"
>

const request = { messages: [{ role: "user" as const, content: "Question" }] }
const signal = new AbortController().signal
const callbacks = {}

const createWebOptions = (): WebTurnOptions => ({
  webClient: {
    call: vi.fn().mockResolvedValue({ content: "Résultat", sources: [] }),
  },
  toolChoice: "auto",
  requestId: "assistant-1",
  compatibilityKey: "provider/model",
  unsupportedTools: new Set<string>(),
})

describe("runAssistantTurn", () => {
  it("retourne un résultat uniforme pour un tour direct", async () => {
    const provider = {
      runTurn: vi.fn().mockResolvedValue({
        text: "Réponse",
        toolCalls: [],
        firstTokenMs: 12,
        totalMs: 40,
        usage: { inputTokens: 10, outputTokens: 4 },
      }),
    }
    const result = await runAssistantTurn({
      provider: provider as unknown as IProvider,
      request,
      apiKey: "secret",
      modelId: "model",
      callbacks,
      signal,
    })
    expect(result).toMatchObject({
      text: "Réponse",
      sources: [],
      firstTokenMs: 12,
      usage: { inputTokens: 10, outputTokens: 4 },
    })
    expect(provider.runTurn).toHaveBeenCalledWith(
      request,
      "secret",
      "model",
      {},
      callbacks,
      signal,
    )
  })

  it("délègue le chemin Web au runner injecté", async () => {
    const runWeb = vi.fn().mockResolvedValue({
      text: "Réponse Web",
      sources: [{ url: "https://example.com", origin: "search" }],
      firstTokenMs: 15,
      totalMs: 90,
    })
    const provider = { runTurn: vi.fn() } as unknown as IProvider
    const web = createWebOptions()
    const result = await runAssistantTurn({
      provider,
      request,
      apiKey: "secret",
      modelId: "model",
      callbacks,
      signal,
      web,
      runWeb,
    })
    expect(runWeb).toHaveBeenCalledWith({
      ...web,
      provider,
      request,
      apiKey: "secret",
      modelId: "model",
      callbacks,
      signal,
    })
    expect(result.text).toBe("Réponse Web")
  })

  it("écrase les champs communs étrangers présents à l'exécution", async () => {
    const foreignSignal = new AbortController().signal
    const web = {
      ...createWebOptions(),
      modelId: "modèle étranger",
      signal: foreignSignal,
    } as unknown as WebTurnOptions
    const runWeb = vi.fn().mockResolvedValue({
      text: "Réponse Web",
      sources: [],
      firstTokenMs: 15,
      totalMs: 90,
    })

    await runAssistantTurn({
      provider: { runTurn: vi.fn() } as unknown as IProvider,
      request,
      apiKey: "secret",
      modelId: "model",
      callbacks,
      signal,
      web,
      runWeb,
    })

    expect(runWeb).toHaveBeenCalledWith(expect.objectContaining({
      modelId: "model",
      signal,
    }))
  })
})
```

Ajouter aussi des tests séparés pour une erreur ordinaire et un `AbortError`, sur
les chemins direct et Web. Chaque rejet doit être propagé par identité. Conserver
la vérification de propagation de `warning`, `usage` et `sources` sur le chemin Web.

- [ ] **Step 2: Confirmer l'échec du module absent**

Run:

```bash
npx vitest run src/lib/chat/turnRunner.test.ts
```

Expected: FAIL car `turnRunner.ts` n'existe pas.

- [ ] **Step 3: Implémenter le runner sans persistance ni état React**

Créer `src/lib/chat/turnRunner.ts` :

```ts
import type { IProvider } from "@/lib/ai/openai-compat"
import type { ChatRequest, TokenUsage, TurnCallbacks } from "@/lib/ai/types"
import { runWebAgent, type WebAgentInput, type WebAgentResult } from "@/lib/mcp/webAgent"
import type { WebSource } from "@/lib/mcp/types"

export interface AssistantTurnResult {
  text: string
  firstTokenMs: number
  totalMs: number
  sources: WebSource[]
  warning?: string
  usage?: TokenUsage
}

type WebTurnOptions = Omit<
  WebAgentInput,
  "provider" | "request" | "apiKey" | "modelId" | "callbacks" | "signal"
>

interface BaseTurnInput {
  provider: IProvider
  request: ChatRequest
  apiKey: string
  modelId: string
  callbacks: TurnCallbacks
  signal: AbortSignal
}

type RunAssistantTurnInput = BaseTurnInput & (
  | { web?: undefined; runWeb?: undefined }
  | {
      web: WebTurnOptions
      runWeb?: (input: WebAgentInput) => Promise<WebAgentResult>
    }
)

export async function runAssistantTurn(
  input: RunAssistantTurnInput,
): Promise<AssistantTurnResult> {
  if (input.web) {
    const webInput: WebAgentInput = {
      ...input.web,
      provider: input.provider,
      request: input.request,
      apiKey: input.apiKey,
      modelId: input.modelId,
      callbacks: input.callbacks,
      signal: input.signal,
    }
    return (input.runWeb ?? runWebAgent)(webInput)
  }
  const result = await input.provider.runTurn(
    input.request,
    input.apiKey,
    input.modelId,
    {},
    input.callbacks,
    input.signal,
  )
  return {
    text: result.text,
    firstTokenMs: result.firstTokenMs,
    totalMs: result.totalMs,
    sources: [],
    ...(result.usage ? { usage: result.usage } : {}),
  }
}
```

- [ ] **Step 4: Relancer les tests du runner**

Run:

```bash
npx vitest run src/lib/chat/turnRunner.test.ts
```

Expected: PASS.

- [ ] **Step 5: Committer le runner isolé**

```bash
git add src/lib/chat/turnRunner.ts src/lib/chat/turnRunner.test.ts
git commit -m "refactor: extrait l execution d un tour chat"
```

---

### Task 8: Intégrer le builder et le runner dans `useChat`

**Files:**
- Modify: `src/hooks/useChat.ts:1-416`
- Modify: `src/hooks/useChat.test.tsx:8-386`
- Modify: `src/lib/ai/errors.ts`
- Modify: `src/lib/ai/errors.test.ts`
- Uses: `src/lib/chat/contextBuilder.ts`
- Uses: `src/lib/chat/turnRunner.ts`
- Uses: `src/lib/token/estimate.ts`

- [ ] **Step 1: Adapter les mocks et écrire les assertions rouges**

Dans `useChat.test.tsx`, remplacer `streamMock` par :

```ts
const runTurnMock = vi.hoisted(() => vi.fn())
const estimateTurnMetricsMock = vi.hoisted(() => vi.fn(() => ({
  inputTokens: 7,
  outputTokens: 3,
  usageSource: "estimated" as const,
  costMicrousd: null,
})))
const metricsFromProviderUsageMock = vi.hoisted(() => vi.fn(() => ({
  inputTokens: 40,
  outputTokens: 10,
  usageSource: "provider" as const,
  costMicrousd: 12,
})))
```

Ajouter le mock suivant avec les autres `vi.mock` :

```ts
vi.mock("@/lib/token", () => ({
  estimateTurnMetrics: estimateTurnMetricsMock,
  metricsFromProviderUsage: metricsFromProviderUsageMock,
  resolvePricingProvider: vi.fn(() => null),
}))
```

Dans le mock de factory :

```ts
createProvider: () => ({
  runTurn: runTurnMock,
  stream: vi.fn(),
  complete: vi.fn(),
  testConnection: vi.fn(),
}),
```

Dans `beforeEach` :

```ts
runTurnMock.mockResolvedValue({
  text: "Réponse",
  toolCalls: [],
  firstTokenMs: 25,
  totalMs: 100,
  usage: { inputTokens: 40, outputTokens: 10 },
})
```

Remplacer les attentes `streamMock` par `runTurnMock`. Ajouter au test de succès :

```ts
expect(messagesDb.insert).toHaveBeenCalledWith(expect.objectContaining({
  role: "assistant",
  first_token_ms: 25,
  input_tokens: 40,
  output_tokens: 10,
  usage_source: "provider",
  cost_microusd: 12,
}))
```

Ajouter le test complet sans `usage` :

```ts
it("estime les métriques quand le fournisseur ne fournit pas usage", async () => {
  runTurnMock.mockResolvedValueOnce({
    text: "Réponse sans usage",
    toolCalls: [],
    firstTokenMs: 25,
    totalMs: 100,
  })
  const { result } = renderHook(() => useChat(modelSelection))

  await act(async () => expect(await result.current.send("conv-1", "Salut")).toBe(true))

  expect(estimateTurnMetricsMock).toHaveBeenCalled()
  expect(messagesDb.insert).toHaveBeenCalledWith(expect.objectContaining({
    usage_source: "estimated",
    input_tokens: 7,
    output_tokens: 3,
    cost_microusd: null,
  }))
})
```

Supprimer les deux tests qui appellent manuellement les anciens callbacks `onDone` et `onError`. Les remplacer par ces contrats au niveau du runner :

```ts
it("attend l'insert assistant avant de libérer busy", async () => {
  let finishInsert: (() => void) | undefined
  vi.mocked(messagesDb.insert)
    .mockResolvedValueOnce("user-1")
    .mockImplementationOnce(() => new Promise<string>((resolve) => {
      finishInsert = () => resolve("assistant-1")
    }))
  const { result } = renderHook(() => useChat(modelSelection))

  let sendPromise: Promise<boolean>
  act(() => {
    sendPromise = result.current.send("conv-1", "Salut")
  })
  await vi.waitFor(() => expect(finishInsert).toBeDefined())
  expect(result.current.busy).toBe(true)

  finishInsert?.()
  await act(async () => expect(await sendPromise!).toBe(true))
  expect(result.current.busy).toBe(false)
})

it("persiste une erreur rejetée par runTurn après l'insert user", async () => {
  runTurnMock.mockRejectedValueOnce({ kind: "network", message: "fail" })
  const { result } = renderHook(() => useChat(modelSelection))
  await act(async () => expect(await result.current.send("conv-1", "Salut")).toBe(true))
  expect(messagesDb.insert).toHaveBeenCalledWith(expect.objectContaining({
    role: "assistant",
    error: JSON.stringify({ kind: "network", message: "fail" }),
  }))
})
```

- [ ] **Step 2: Vérifier l'échec avant intégration**

Run:

```bash
npx vitest run src/hooks/useChat.test.tsx
```

Expected: FAIL car `useChat` appelle encore `stream()` et ne persiste pas les métriques.

- [ ] **Step 3: Importer les nouvelles unités**

Ajouter en tête de `useChat.ts` :

```ts
import { buildChatMessages } from "@/lib/chat/contextBuilder"
import { runAssistantTurn, type AssistantTurnResult } from "@/lib/chat/turnRunner"
import { estimateTurnMetrics, metricsFromProviderUsage, resolvePricingProvider } from "@/lib/token"
```

Retirer l'import direct de `runWebAgent`.

- [ ] **Step 4: Remplacer la construction manuelle de `apiMessages`**

Après le chargement de `history`, remplacer la construction et la mutation du dernier message par :

```ts
const apiMessages = buildChatMessages({
  system,
  history: history.map((message) => ({
    role: message.role,
    content: message.content,
  })),
  currentImages: apiImages,
})
```

- [ ] **Step 5: Étendre `persistDone` avec les métriques**

Remplacer la fonction complète par :

```ts
const persistDone = (
  result: AssistantTurnResult,
  metrics: TurnMetrics | null,
) => {
  const finalContent = result.text || accRef.current
  return (async () => {
    const id = await messagesDb.insert({
      conversation_id: conversationId,
      role: "assistant",
      content: finalContent,
      attachments: "[]",
      model_label: label,
      latency_ms: normalizeDuration(result.totalMs),
      error: null,
      sources: JSON.stringify(result.sources),
      first_token_ms: normalizeDuration(result.firstTokenMs),
      input_tokens: metrics?.inputTokens ?? null,
      output_tokens: metrics?.outputTokens ?? null,
      usage_source: metrics?.usageSource ?? null,
      cost_microusd: metrics?.costMicrousd ?? null,
    })
    upsertLast({
      id,
      content: finalContent,
      latencyMs: normalizeDuration(result.totalMs) ?? undefined,
      firstTokenMs: normalizeDuration(result.firstTokenMs) ?? undefined,
      inputTokens: metrics?.inputTokens,
      outputTokens: metrics?.outputTokens,
      usageSource: metrics?.usageSource,
      costMicrousd: metrics?.costMicrousd ?? undefined,
      sources: result.sources,
      webWarning: result.warning,
      webStatus: undefined,
    })
  })()
}
```

`persistDone` ne doit jamais absorber un échec d'insert. Son appelant utilise une
branche dédiée qui journalise la cause reconstruite et redacted, puis transmet à
`persistError` uniquement le message public générique de persistance.

- [ ] **Step 6: Unifier l'exécution directe et Web**

Remplacer les deux branches d'exécution par :

```ts
try {
  const web = webAccess.enabled && webAccess.configured
    ? {
        webClient: {
          call: async (requestId: string, request: Parameters<typeof tinyfish.call>[1]) => {
            mcpRequestRef.current = requestId
            try {
              return await tinyfish.call(requestId, request)
            } finally {
              if (mcpRequestRef.current === requestId) mcpRequestRef.current = null
            }
          },
        },
        toolChoice: resolveWebChoice(fullContent, options.forceWeb ?? false),
        requestId: assistantId,
        compatibilityKey: `${provider.id}/${modelId}`,
        unsupportedTools: unsupportedToolsRef.current,
        onStatus: (webStatus: WebStatus | undefined) => upsertLast({ webStatus }),
      }
    : undefined

  const result = await runAssistantTurn({
    provider: apiProvider,
    request: { messages: apiMessages },
    apiKey,
    modelId,
    callbacks: turnCallbacks,
    signal: controller.signal,
    ...(web ? { web } : {}),
  })
  if (controller.signal.aborted) throw controller.signal.reason
  accRef.current = result.text
  setWebToolsUnsupported(
    unsupportedToolsRef.current.has(`${provider.id}/${modelId}`),
  )
  let metrics: TurnMetrics | null = null
  try {
    const pricingProvider = resolvePricingProvider(provider.baseUrl) ?? ""
    const providerMetrics = result.usage
      ? metricsFromProviderUsage(result.usage, pricingProvider, modelId)
      : null
    metrics = providerMetrics ?? (web
      ? null
      : estimateTurnMetrics(apiMessages, result.text, pricingProvider, modelId))
  } catch (metricsError) {
    logger.error({ kind: "chat_metrics", message: safeTurnErrorMessage(metricsError) })
  }
  try {
    await persistDone(result, metrics)
  } catch (persistenceError) {
    logger.error({
      kind: "assistant_response_persistence",
      message: safeTurnErrorMessage(persistenceError),
    })
    await persistError({ kind: "persistence", message: PERSISTENCE_ERROR_MESSAGE })
  }
} catch (error) {
  await persistError(error)
}
```

Politique de métriques corrigée : un tour direct sans usage valide peut être
estimé localement. Un tour Web multi-tour sans usage complet et valide ne doit
jamais être estimé depuis le seul prompt initial et le texte final ; ses cinq
colonnes de métriques restent à `NULL`.

Le coût utilise exclusivement l'identité conservatrice dérivée de l'endpoint par
`resolvePricingProvider(provider.baseUrl)`, jamais `provider.name`. L'identité OpenAI
n'est reconnue que pour une origine stricte : protocole `https:`, hostname exact
`api.openai.com`, aucun port non standard et aucune information d'authentification dans
l'URL. Une identité vide autorise toujours le comptage via le tokenizer résolu par
`modelId`, mais impose un coût `null` tant que l'endpoint officiel n'est pas prouvé.
Même avec cette identité, le coût fournisseur reste `null` sans compteur
`cachedInputTokens` valide et sans tarif `cachedInput` officiellement vérifié. Une
estimation locale conserve toujours un coût `null`, car elle ne connaît jamais la part
réellement servie depuis le cache.

Après l'insert user, créer immédiatement le placeholder assistant, `upsertLast`
et `persistError`, avant le prompt, les connaissances, l'historique, le provider
et le secret. Toute erreur post-insert est ainsi visible et persistée, tandis que
l'outer catch reste le filet du chemin pré-insert. Les messages et détails API
sont passés par `redactSensitiveDetail` avant la VM, SQLite ou les logs. Pour les
payloads historiques avec `kind`, `mapRow` conserve uniquement un kind validé par
`normalizeApiErrorKind`, force `message: ""` et supprime `detail`, car une clé
fournisseur legacy arbitraire ne peut pas être reconnue sans sa valeur exacte. Les
kinds runtime sont validés par le même helper avant la VM et la persistance ; toute
valeur inconnue devient `unknown`. La migration V7 nettoie ponctuellement `messages.error`
en supprimant tous les anciens diagnostics, au prix assumé de leur perte. Elle conserve
le payload d'interruption canonique `{"interrupted":true}` et remplace toute autre valeur
non nulle par `{"kind":"unknown","message":""}` pour préserver un état d'échec visible.

Après lecture du Credential Manager, la clé du tour est conservée uniquement dans
`activeApiKey` et fournie à `redactSensitiveDetail(value, [activeApiKey])` pour masquer
sa valeur exacte dans le message, le détail, les erreurs de persistance et les logs
reconstruits. Avant cette lecture, les motifs génériques restent le seul filet ; la clé
elle-même n'est jamais persistée ni journalisée.

L'adaptateur sanitise toutes les erreurs réseau à sa frontière avec la clé active :
`runTurn`, `complete`, `testConnection` et `listRemoteModels` reconstruisent les erreurs
et ne transportent jamais une stack brute fournisseur. Un `AbortError` est lui aussi
reconstruit : seul son nom et son message redacted sont conservés, jamais son identité,
sa stack source ou ses propriétés custom. Pour les erreurs HTTP, le body brut sert uniquement à classifier le kind,
tandis que le détail exposé est redacted avant toute troncature. Le body `/models` de
`testConnection` est lui aussi redacted avant le `slice` du log. `SettingsDialog` ne
journalise jamais l'objet de résultat ou l'exception brute : les erreurs reconnues
utilisent le libellé i18n de leur `kind`, les erreurs inconnues restent génériques dans
l'UI, et les logs reconstruits sont redacted avec la clé active pour les chemins de
test et de récupération des modèles.

Si l'insert d'erreur échoue à son tour, conserver une erreur explicite et non
sensible dans la VM, journaliser uniquement un objet reconstruit et redacted,
puis terminer `send()` avec `true` sans nouvelle tentative de persistance.

Complément issu de la revue globale :

- `send()` utilise un verrou synchrone `inFlightRef`, acquis avant `setBusy` et
  libéré dans `finally`. Le state `busy` reste exclusivement un état d'UI et ne
  protège plus l'exclusion mutuelle entre deux appels effectués avant un rendu.
- Le calcul optionnel des métriques est isolé dans son propre `try/catch`. Une
  exception de comptage ou de tarification est journalisée sous forme reconstruite
  et redacted, puis la réponse est persistée avec ses métriques de tokens, source
  et coût à `NULL`, sans créer d'erreur fournisseur.
- `first_token_ms` et `latency_ms` sont validés indépendamment : seuls les nombres
  finis et positifs ou nuls sont arrondis et exposés dans SQLite/VM. Le TTFT ne
  dépend jamais de la présence de métriques de tokens. Cette validation s'applique
  aussi au mapping des lignes historiques.
- Un rejet de `persistDone` suit une branche dédiée : la cause SQLite est réservée
  au log redacted et `persistError` reçoit uniquement le payload public générique
  `{ kind: "persistence", message: PERSISTENCE_ERROR_MESSAGE }`. Le mécanisme
  `persistenceFailed` conserve ce même message si la seconde insertion échoue.
- Le TTFT Web est mesuré depuis le début de `runWebAgent` jusqu'au premier token
  du tour qui produit réellement la réponse finale. Chaque appel `runTurn` capture
  son instant de départ ; les tours d'outils intermédiaires ne fournissent jamais
  le TTFT final. La règle couvre la réponse directe, la réponse après recherche,
  le dernier tour forcé et le repli sans outils.

Enfin, `load()` réapplique uniquement les warnings Web en mémoire dont l'id
persistant correspond exactement à une row rechargée ; aucun warning n'est
transféré vers un autre message. Le schéma final V8 ajoute après le nettoyage V7
la réparation idempotente des assistants vides sans erreur décrite ci-dessus.

Une bulle dont l'insert final puis l'insert d'erreur ont tous deux échoué reste
marquée `persistenceFailed` avec son `conversationId` pendant la session. Au
reload, `load()` place d'abord les rows persistées, puis ajoute uniquement les
transients de la conversation demandée dont l'id n'existe pas déjà en base. Un
transient n'est donc ni perdu au reload immédiat, ni transféré vers une autre
conversation, ni dupliqué si sa ligne existe finalement.

- [ ] **Step 7: Étendre le VM et son mapping**

Ajouter à `ChatMessageVM` :

```ts
firstTokenMs?: number
inputTokens?: number
outputTokens?: number
usageSource?: "provider" | "estimated"
costMicrousd?: number
```

Dans `mapRow`, ajouter :

```ts
firstTokenMs: r.first_token_ms ?? undefined,
inputTokens: r.input_tokens ?? undefined,
outputTokens: r.output_tokens ?? undefined,
usageSource: r.usage_source ?? undefined,
costMicrousd: r.cost_microusd ?? undefined,
```

Mettre à jour tous les fixtures `MessageRow` du test avec les cinq colonnes V6 à `null`, ou fournir un helper commun local au test.

- [ ] **Step 8: Relancer les tests du hook et des unités extraites**

Run:

```bash
npx vitest run src/hooks/useChat.test.tsx src/lib/chat/contextBuilder.test.ts src/lib/chat/turnRunner.test.ts
```

Expected: PASS. Les tests anti-perte, Web, interruption et persistance doivent rester verts.

- [ ] **Step 9: Vérifier le typecheck avant commit**

Run:

```bash
npx tsc --noEmit
```

Expected: PASS.

- [ ] **Step 10: Committer l'intégration du runner**

```bash
git add src/hooks/useChat.ts src/hooks/useChat.test.tsx
git commit -m "refactor: delegue les tours au moteur de chat"
```

---

### Task 9: Afficher les métriques propres à chaque réponse

**Files:**
- Modify: `src/components/chat/ChatView.tsx:1-367`
- Modify: `src/components/chat/ChatView.test.tsx:15-342`
- Modify: `src/App.tsx:1-300`
- Modify: `src/App.test.tsx`
- Modify: `src/i18n/fr.ts:20-47`
- Modify: `src/lib/token/index.ts`
- Delete: `src/lib/token/useTokenCount.ts`
- Delete: `src/lib/token/useTokenCount.test.tsx` (test legacy ajouté temporairement en Task 5)

- [ ] **Step 1: Écrire les tests rouges des métriques par message**

Dans `ChatView.test.tsx`, remplacer le test qui active `activeModel` par les trois tests suivants :

```ts
it("affiche uniquement les métriques du message assistant concerné", () => {
  render(<ChatView {...base} vm={[
    msg({
      role: "assistant",
      content: "réponse A",
      inputTokens: 1_000,
      outputTokens: 200,
      usageSource: "provider",
      costMicrousd: 450,
    }),
    msg({ role: "assistant", content: "réponse B" }),
  ]} />)
  expect(screen.getByText("1.2k tokens")).toBeTruthy()
  expect(screen.getByText("$0.0005")).toBeTruthy()
  expect(screen.getAllByText(/tokens/)).toHaveLength(1)
})

it("marque visuellement une estimation", () => {
  render(<ChatView {...base} vm={[msg({
    role: "assistant",
    content: "réponse",
    inputTokens: 100,
    outputTokens: 20,
    usageSource: "estimated",
  })]} />)
  expect(screen.getByText("≈ 120 tokens")).toBeTruthy()
  expect(screen.getByTitle("Estimation locale des tokens")).toBeTruthy()
})

it("n'affiche aucun faux coût quand il est inconnu", () => {
  render(<ChatView {...base} vm={[msg({
    role: "assistant",
    content: "réponse",
    inputTokens: 100,
    outputTokens: 20,
    usageSource: "estimated",
  })]} />)
  expect(screen.queryByText(/\$/)).toBeNull()
})
```

Retirer `systemPrompt`, `activeModel` et `conversationId` de l'objet `base` si ces props ne servent plus après le refactor.
Ajouter aussi les régressions TTFT/i18n et cardinalité des boutons copier : un
bouton par assistant non vide, aucun pour un assistant vide, et conservation du
bouton utilisateur.

- [ ] **Step 2: Confirmer l'échec de l'ancien compteur cumulatif**

Run:

```bash
npx vitest run src/components/chat/ChatView.test.tsx
```

Expected: FAIL car `ChatView` ignore encore les métriques du VM et compte toute la conversation.

- [ ] **Step 3: Retirer le comptage global de `ChatView`**

Supprimer les imports suivants de `ChatView.tsx` :

```ts
useTokenCount
knowledgeDb
conversationKnowledge
```

Importer à la place :

```ts
import { formatCostMicrousd, formatTokens } from "@/lib/token"
```

Retirer des props `activeModel`, `systemPrompt` et `conversationId`, puis supprimer l'état `knowledgeContent` et l'appel `useTokenCount`.

- [ ] **Step 4: Calculer la ligne locale à la bulle**

Dans `MessageBubble`, calculer :

```ts
const totalTokens = m.inputTokens !== undefined && m.outputTokens !== undefined
  ? m.inputTokens + m.outputTokens
  : undefined
const tokenLabel = totalTokens === undefined
  ? undefined
  : `${m.usageSource === "estimated" ? "≈ " : ""}${formatTokens(totalTokens)} ${t.chat.tokens}`
```

Remplacer la rangée cumulative par :

```tsx
{!isUser && m.content && (
  <div className="mt-1 flex items-center gap-2 text-xs text-muted-foreground">
    {m.modelLabel && <span>{m.modelLabel}</span>}
    {m.firstTokenMs !== undefined && <span>{formatLatency(m.firstTokenMs)} {t.chat.firstToken}</span>}
    {m.latencyMs !== undefined && <span>{formatLatency(m.latencyMs)}</span>}
    {tokenLabel && <span title={m.usageSource === "estimated" ? t.chat.estimatedUsage : undefined}>{tokenLabel}</span>}
    {m.costMicrousd !== undefined && <span>{formatCostMicrousd(m.costMicrousd)}</span>}
    {m.inputTokens !== undefined && m.outputTokens !== undefined && (
      <span className="text-[10px] opacity-60">
        ({t.chat.inputShort}: {formatTokens(m.inputTokens)} / {t.chat.outputShort}: {formatTokens(m.outputTokens)})
      </span>
    )}
    <button
      type="button"
      onClick={onCopyMessage}
      aria-label={copied ? t.chat.messageCopied : t.chat.copyMessage}
      className="ml-auto rounded-md p-1 text-muted-foreground hover:text-foreground focus-visible:text-foreground"
    >
      {copied ? (
        <Check className="size-3.5 text-[var(--brand-to)]" aria-hidden="true" />
      ) : (
        <Copy className="size-3.5" aria-hidden="true" />
      )}
    </button>
  </div>
)}
```

Pour un assistant sans contenu, conserver l'absence de bouton. Limiter explicitement la rangée de copie autonome au rôle utilisateur :

```tsx
{m.content && isUser && (
  <div className="mt-1 flex justify-end">
    <button
      type="button"
      onClick={onCopyMessage}
      aria-label={copied ? t.chat.messageCopied : t.chat.copyMessage}
      className="rounded-md p-1 text-muted-foreground hover:text-foreground focus-visible:text-foreground"
    >
      {copied ? (
        <Check className="size-3.5 text-[var(--brand-to)]" aria-hidden="true" />
      ) : (
        <Copy className="size-3.5" aria-hidden="true" />
      )}
    </button>
  </div>
)}
```

Supprimer l'ancienne rangée modèle/latence afin de ne pas afficher les données deux fois.

- [ ] **Step 5: Ajouter la chaîne i18n**

Dans `src/i18n/fr.ts`, ajouter à `chat` :

```ts
estimatedUsage: "Estimation locale des tokens",
tokens: "tokens",
firstToken: "premier token",
inputShort: "in",
outputShort: "out",
```

- [ ] **Step 6: Simplifier `App` sans modifier son rendu**

Dans `App.tsx` :

- supprimer l'import `loadPromptSettings` ;
- supprimer l'état `systemPrompt` et son effet de chargement ;
- ne plus passer `activeModel`, `systemPrompt` et `conversationId` à `ChatView`.

Le prompt réellement envoyé reste chargé dans `useChat` à chaque envoi ; ce retrait supprime seulement une seconde lecture devenue inutile pour l'ancien compteur.

- [ ] **Step 7: Supprimer le hook cumulatif et son test legacy**

Supprimer `src/lib/token/useTokenCount.ts` ainsi que
`src/lib/token/useTokenCount.test.tsx`, ajouté temporairement en Task 5 pour
figer le comportement historique avant son retrait. Vérifier que
`src/lib/token/index.ts` n'exporte plus ce fichier et que `grep` ne trouve aucun import :

Run:

```bash
rg "useTokenCount|countTokens\(" src
```

Expected: aucune occurrence hors historique Git.

- [ ] **Step 8: Exécuter les tests composants et App**

Run:

```bash
npx vitest run src/components/chat/ChatView.test.tsx src/App.test.tsx
```

Expected: PASS. Le nombre de boutons Copier reste exactement celui attendu par les tests existants.

- [ ] **Step 9: Committer la correction d'affichage**

```bash
git add src/components/chat/ChatView.tsx src/components/chat/ChatView.test.tsx src/App.tsx src/App.test.tsx src/i18n/fr.ts src/lib/token/index.ts
git rm src/lib/token/useTokenCount.ts src/lib/token/useTokenCount.test.tsx
git add -f docs/superpowers/plans/2026-11-05-chat-engine-palier-1.md
git commit -m "fix: affiche les métriques propres a chaque réponse"
```

---

### Task 10: Vérifier le palier 1 et préparer la revue

**Files:**
- Verify: all files changed by Tasks 2-9
- Inspect: `src/console-log.guard.test.ts`
- Inspect: `src/brand-color.guard.test.ts`

- [ ] **Step 1: Exécuter les suites ciblées du palier**

Run:

```bash
npx vitest run src/lib/db/migrations.test.ts src/lib/db/messages.test.ts src/lib/ai/openai-compat.test.ts src/lib/mcp/webAgent.test.ts src/lib/token/pricing.test.ts src/lib/token/estimate.test.ts src/lib/token/format.test.ts src/lib/chat/contextBuilder.test.ts src/lib/chat/turnRunner.test.ts src/hooks/useChat.test.tsx src/components/chat/ChatView.test.tsx src/App.test.tsx
```

Expected: PASS.

- [ ] **Step 2: Exécuter tous les tests TypeScript**

Run:

```bash
npm run test
```

Expected: tous les tests passent, y compris i18n, `console.log`, couleurs et sécurité Markdown.

- [ ] **Step 3: Exécuter le build frontend complet sous WSL**

Run:

```bash
npm run build
```

Expected: `tsc`, Vitest et Vite passent sans avertissement bloquant.

- [ ] **Step 4: Vérifier les changements interdits**

Run:

```bash
git diff feat/m1-socle-chat...HEAD -- src-tauri src/assets src/index.css tailwind.config.js
```

Expected: aucun changement. Le palier 1 ne modifie ni Rust, ni assets, ni palette, ni CSS global.

- [ ] **Step 5: Vérifier qu'aucun binaire d'image ou secret n'a été ajouté**

Run:

```bash
git diff feat/m1-socle-chat...HEAD -- src | rg "BLOB|base64.*INSERT|Authorization|Bearer|console\.log"
```

Expected: aucune nouvelle persistance d'image, aucun secret journalisé et aucun `console.log`.

- [ ] **Step 6: Vérifier l'historique de commits du palier**

Run:

```bash
git log --oneline feat/m1-socle-chat..HEAD
```

Expected: le commit de spécification suivi de commits cohérents et indépendants pour migration, repository, usage, estimation, contexte, runner, hook et UI.

- [ ] **Step 7: Effectuer la validation Windows sans lancer d'installation depuis WSL**

Depuis PowerShell Windows dans `C:\dev\LogAssist` :

```powershell
Set-Location C:\dev\LogAssist
npm run build
npm run tauri dev
```

Vérifications manuelles :

1. envoyer un message texte sans Web ;
2. envoyer un message avec Web activé ;
3. interrompre un flux ;
4. changer rapidement de conversation ;
5. confirmer qu'une ancienne conversation V5 s'ouvre ;
6. vérifier qu'une réponse affiche uniquement ses propres tokens ;
7. vérifier qu'un modèle inconnu n'affiche aucun faux coût ;
8. fermer et rouvrir LogAssist pour confirmer le comportement image inchangé.

- [ ] **Step 8: Traiter toute anomalie finale comme une tâche TDD distincte**

Si la validation révèle une anomalie, ne pas produire de commit générique. Ajouter au présent plan une sous-tâche nommée avec les chemins exacts, le test rouge, la commande d'échec, le correctif minimal, la commande de réussite et le commit associé. Ne pas commencer le palier 2 tant que cette sous-tâche et toutes les gates ne sont pas validées.

### Complément de revue finale — erreurs V7 et coûts cache-aware

- V7 conserve l'interruption canonique et remplace chaque autre erreur non nulle par le
  marqueur générique non sensible `{"kind":"unknown","message":""}`. Un assistant vide
  rechargé reste ainsi en erreur et ne réaffiche pas le spinner de réflexion.
- Le schéma final vaut `8`. V8 répare idempotemment les assistants vides sans erreur
  d'une éventuelle base de développement passée par l'ancienne V7. V7 corrigée n'ayant
  pas été distribuée, V8 ne prétend pas restaurer des erreurs partielles effacées ; elle
  traite uniquement le cas critique du spinner permanent.
- `TokenUsage.cachedInputTokens` lit opportunément
  `usage.prompt_tokens_details.cached_tokens`. Le champ n'est conservé que s'il s'agit
  d'un entier sûr compris entre zéro et `prompt_tokens` ; un champ absent ou invalide
  n'invalide pas les compteurs d'entrée et de sortie.
- L'adaptateur demande le chunk final d'usage avec
  `stream_options: { include_usage: true }` uniquement pour une requête streamée vers
  l'origine officielle stricte `https://api.openai.com`. Le helper d'identité URL est
  partagé avec `resolvePricingProvider` afin d'éviter deux politiques divergentes.
- L'agent Web additionne les tokens cachés uniquement si tous les tours disposant d'un
  usage fournissent un compteur caché valide. Sinon l'usage agrégé conserve seulement
  les compteurs d'entrée et de sortie, ce qui rend volontairement le coût inconnu.
- Tarifs OpenAI vérifiés le **2026-11-06** dans les documentations officielles :
  - GPT-4o : entrée `$2.50`, entrée cachée `$1.25`, sortie `$10.00` par million —
    <https://developers.openai.com/api/docs/models/gpt-4o> ;
  - GPT-4o mini : entrée `$0.15`, entrée cachée `$0.075`, sortie `$0.60` par million —
    <https://developers.openai.com/api/docs/models/gpt-4o-mini>.
- Seuls `gpt-4o-2024-11-20`, `gpt-4o-2024-08-06` et
  `gpt-4o-mini-2024-07-18` sont normalisés par une table explicite pour le pricing et
  le tokenizer. Toute autre date reste inconnue ; `gpt-4o-2024-05-13` est exclu car la
  documentation officielle le marque comme arrêté (`Shut down`).
- Le coût en microdollars vaut
  `(input - cached) × inputPrice + cached × cachedPrice + output × outputPrice`.
  Il reste `null` si l'identité fournisseur, le modèle, le compteur caché ou son tarif
  manque. Les estimations locales n'affichent jamais de coût.

### Durcissements mineurs de revue finale

- Les échecs de persistance d'une réponse utilisent le kind public dédié `persistence`,
  traduit par « Réponse non enregistrée localement ». Ce kind est conservé dans la
  seconde tentative SQLite, dans la VM après double échec et au rechargement. Les erreurs
  fournisseur non reconnues restent `unknown` et la migration V7 legacy ne change pas.
- `ProviderForm` n'affiche plus le message brut d'une exception d'enregistrement. L'UI
  utilise uniquement `settings.saveFailed` et le logger reçoit un objet reconstruit
  `ProviderForm.save`, dont le message est redacted avec la clé saisie et les motifs
  génériques, sans objet erreur brut ni stack.

---

## Définition de terminé du palier 1

- `useChat` ne choisit plus directement entre `provider.stream` et `runWebAgent`.
- La construction du contexte actuel vit dans une fonction pure, sans encore le tronquer.
- Chaque réponse assistant peut persister TTFT, durée, tokens, provenance et coût optionnel.
- Un fournisseur qui rapporte l'usage est prioritaire ; sinon l'estimation locale est marquée comme telle.
- Seul un usage fournisseur cache-aware et entièrement tarifé peut produire un coût ; une estimation locale n'en produit jamais.
- Un modèle ou tarif inconnu n'affiche aucun faux coût.
- Le schéma SQLite final est V8 et l'option `include_usage` ne sort jamais de l'origine OpenAI officielle.
- `ChatView` ne charge plus les connaissances et ne recompte plus toute la conversation sous chaque bulle.
- Le contrat anti-perte, l'interruption, le Web MCP, les sources et les images éphémères restent inchangés.
- Aucun changement de palette, de shell ou d'identité visuelle n'est inclus.
- Toutes les gates WSL et la validation Windows passent.
