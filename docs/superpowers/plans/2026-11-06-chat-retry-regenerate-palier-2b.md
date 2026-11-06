# Chat Recovery — Palier 2B Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Retenter la dernière réponse fournisseur en erreur et régénérer la dernière réponse réussie sans dupliquer le message utilisateur.

**Architecture:** Une politique pure valide la cible. `useChat` relance silencieusement le moteur existant, puis remplace la même ligne assistant uniquement après succès ; l’ancienne réponse ou erreur reste visible en cas d’échec.

**Tech Stack:** React 19, TypeScript strict, SQLite paramétré, Vitest, Testing Library, `TurnRunner`.

---

## Périmètre

Inclus : Retenter, Régénérer, modèle actif courant, même ligne assistant, interruption par Stop, Web automatique selon la question d’origine.

Exclus : Continuer, édition, branches, variantes, retry d’une erreur `persistence`, retry d’un transient non enregistré, images historiques.

## Fichiers

- Create: `src/lib/chat/recoveryPolicy.ts`
- Create: `src/lib/chat/recoveryPolicy.test.ts`
- Modify: `src/lib/db/messages.ts` et son test
- Modify: `src/hooks/useChat.ts` et son test
- Modify: `src/components/chat/ChatView.tsx` et son test
- Modify: `src/App.tsx`, `src/i18n/fr.ts`

---

### Task 1: Politique de récupération

**Files:**
- Create: `src/lib/chat/recoveryPolicy.ts`
- Create: `src/lib/chat/recoveryPolicy.test.ts`

- [ ] **Step 1: Tests rouges**

Tester un retry valide et un regenerate valide. Refuser : cible absente, user, assistant non final, ligne user située après la cible, retry sans erreur, erreur `persistence`, interruption, regenerate avec erreur/contenu vide, absence de user précédent.

Le résultat valide doit contenir :

```ts
{
  targetId: "assistant-1",
  triggerUserContent: "Question",
  history: rows.slice(0, targetIndex),
}
```

- [ ] **Step 2: Implémenter**

```ts
import type { MessageRow } from "@/lib/db/messages"

export type RecoveryMode = "retry" | "regenerate"

export interface RecoveryPlan {
  targetId: string
  triggerUserContent: string
  history: MessageRow[]
}

export function createRecoveryPlan(
  rows: MessageRow[],
  targetId: string,
  mode: RecoveryMode,
): RecoveryPlan | null {
  const targetIndex = rows.findIndex((row) => row.id === targetId)
  if (targetIndex < 0 || rows[targetIndex].role !== "assistant") return null
  if (targetIndex !== rows.length - 1) return null

  let lastAssistantIndex = -1
  for (let index = rows.length - 1; index >= 0; index--) {
    if (rows[index].role === "assistant") { lastAssistantIndex = index; break }
  }
  if (targetIndex !== lastAssistantIndex) return null

  const target = rows[targetIndex]
  let stored: { kind?: string; interrupted?: boolean } = {}
  try { stored = target.error ? JSON.parse(target.error) : {} } catch { stored = {} }

  if (mode === "retry") {
    if (!target.error || stored.interrupted || stored.kind === "persistence") return null
  } else if (target.error || target.content.trim() === "") return null

  let userIndex = -1
  for (let index = targetIndex - 1; index >= 0; index--) {
    if (rows[index].role === "user") { userIndex = index; break }
  }
  if (userIndex < 0) return null

  return {
    targetId,
    triggerUserContent: rows[userIndex].content,
    history: rows.slice(0, targetIndex),
  }
}
```

- [ ] **Step 3: Vérifier et committer**

```bash
npx vitest run src/lib/chat/recoveryPolicy.test.ts
npx tsc --noEmit
git add src/lib/chat/recoveryPolicy.ts src/lib/chat/recoveryPolicy.test.ts
git commit -m "feat: ajoute la politique de récupération chat"
```

---

### Task 2: Mise à jour atomique assistant

**Files:**
- Modify: `src/lib/db/messages.ts`
- Modify: `src/lib/db/messages.test.ts`

- [ ] **Step 1: Test rouge**

Appeler `messages.updateAssistant("assistant-1", row)` et attendre un unique SQL paramétré :

```sql
UPDATE messages SET content = ?, model_label = ?, latency_ms = ?, error = ?, sources = ?, first_token_ms = ?, input_tokens = ?, output_tokens = ?, usage_source = ?, cost_microusd = ? WHERE id = ? AND role = 'assistant'
```

Vérifier onze binds, l’id en dernier et toutes les métriques.

- [ ] **Step 2: Type et implémentation**

```ts
export type AssistantUpdate = Pick<
  MessageRow,
  | "content" | "model_label" | "latency_ms" | "error" | "sources"
  | "first_token_ms" | "input_tokens" | "output_tokens"
  | "usage_source" | "cost_microusd"
>
```

```ts
async updateAssistant(id: string, row: AssistantUpdate): Promise<void> {
  await execute(
    "UPDATE messages SET content = ?, model_label = ?, latency_ms = ?, error = ?, sources = ?, first_token_ms = ?, input_tokens = ?, output_tokens = ?, usage_source = ?, cost_microusd = ? WHERE id = ? AND role = 'assistant'",
    [
      row.content, row.model_label, row.latency_ms, row.error, row.sources,
      row.first_token_ms, row.input_tokens, row.output_tokens,
      row.usage_source, row.cost_microusd, id,
    ],
  )
}
```

- [ ] **Step 3: Vérifier et committer**

```bash
npx vitest run src/lib/db/messages.test.ts
npx tsc --noEmit
git add src/lib/db/messages.ts src/lib/db/messages.test.ts
git commit -m "feat: permet de remplacer une réponse assistant"
```

---

### Task 3: Moteur de relance dans `useChat`

**Files:**
- Modify: `src/hooks/useChat.ts`
- Modify: `src/hooks/useChat.test.tsx`
- Use: `recoveryPolicy`, `messages.updateAssistant`, `TurnRunner`

- [ ] **Step 1: Étendre le VM**

```ts
recoveryMode?: "retry" | "regenerate"
recoveryFailed?: boolean
```

- [ ] **Step 2: Écrire les tests rouges**

Les tests doivent vérifier :

1. retry valide : aucun insert user, `updateAssistant` appelé, erreur supprimée, même id conservé ;
2. regenerate valide : ancienne réponse reste dans VM pendant le runner différé, remplacement seulement après succès ;
3. échec runner : ancienne réponse/erreur intacte, `recoveryFailed=true`, aucun UPDATE ;
4. updateAssistant rejeté : ancienne réponse intacte, `recoveryFailed=true` ;
5. cible invalide ou non finale : `false`, aucun provider ;
6. lock partagé : `send` et recovery ne s’exécutent jamais simultanément ;
7. Stop annule le recovery et conserve l’ancienne réponse ;
8. Web automatique utilise `triggerUserContent`, sources et métriques remplacées après succès.

- [ ] **Step 3: Factoriser la préparation du contexte**

Créer dans `useChat.ts` un helper local async réutilisé par `send` et recovery qui charge : prompt, connaissances, historique fourni, provider et secret. Il retourne :

```ts
{
  provider,
  modelId,
  label,
  apiProvider,
  apiKey,
  apiMessages,
}
```

Le helper reçoit explicitement les rows d’historique et les images courantes ; il ne persiste rien.

- [ ] **Step 4: Implémenter `recoverLast`**

Signature interne :

```ts
async function recoverLast(
  conversationId: string,
  targetId: string,
  mode: RecoveryMode,
): Promise<boolean>
```

Comportement obligatoire :

- acquérir `inFlightRef` avant le premier await ;
- charger rows et appeler `createRecoveryPlan` ;
- poser `recoveryMode` sur la cible sans effacer son contenu/erreur ;
- accumuler les deltas dans une variable locale, sans modifier la réponse visible ;
- exécuter `runAssistantTurn` direct/Web avec le modèle actif ;
- calculer métriques avec la même politique que `send` ;
- une panne des métriques ne doit pas faire échouer la relance ;
- appeler `messages.updateAssistant` seulement après succès complet ;
- après commit, remplacer VM : contenu, modèle, timings, métriques, sources ; retirer apiError/interrupted/recoveryMode/recoveryFailed ;
- en erreur/abort/update rejeté : conserver ancienne cible, retirer recoveryMode et poser recoveryFailed ;
- journaliser seulement une erreur reconstruite et redacted avec la clé active ; ne jamais persister le détail d’une relance échouée ;
- connecter `mcpRequestRef` et `onStatus` comme `send`, afin que Stop annule aussi TinyFish ;
- mettre à jour `unsupportedToolsRef` après un tour Web ;
- toujours libérer lock, busy, abortRef et mcpRequestRef.

Le Web utilise :

```ts
resolveWebChoice(plan.triggerUserContent, false)
```

- [ ] **Step 5: Exposer les commandes**

```ts
const retryLast = useCallback(
  (conversationId: string, targetId: string) => recoverLast(conversationId, targetId, "retry"),
  [recoverLast],
)

const regenerateLast = useCallback(
  (conversationId: string, targetId: string) => recoverLast(conversationId, targetId, "regenerate"),
  [recoverLast],
)
```

Retour du hook :

```ts
return {
  vm, busy, send, retryLast, regenerateLast,
  interrupt, load, webToolsUnsupported,
}
```

- [ ] **Step 6: Vérifier et committer**

```bash
npx vitest run src/hooks/useChat.test.tsx src/lib/chat/recoveryPolicy.test.ts src/lib/chat/turnRunner.test.ts
npx tsc --noEmit
git add src/hooks/useChat.ts src/hooks/useChat.test.tsx
git commit -m "feat: ajoute la relance des réponses assistant"
```

---

### Task 4: Actions Retenter et Régénérer

**Files:**
- Modify: `src/components/chat/ChatView.tsx`
- Modify: `src/components/chat/ChatView.test.tsx`
- Modify: `src/App.tsx`
- Modify: `src/i18n/fr.ts`

- [ ] **Step 1: Ajouter l’i18n**

```ts
retry: "Retenter",
retrying: "Nouvelle tentative…",
regenerating: "Régénération…",
recoveryFailed: "La relance a échoué ; la réponse précédente est conservée.",
```

La clé `regenerate` existante reste utilisée.

- [ ] **Step 2: Étendre les props**

```ts
onRetry?: (messageId: string) => Promise<boolean>
onRegenerate?: (messageId: string) => Promise<boolean>
```

Calculer l’id du dernier assistant une seule fois dans `ChatView`, puis passer à `MessageBubble` : `isLatestAssistant`, la prop existante `isGenerating`, et les callbacks.

Ajouter `recoveryMode` et `recoveryFailed` à `createRenderSignature` afin que l’état soit rendu même sans `ResizeObserver`.

- [ ] **Step 3: Tests rouges UI**

Vérifier :

- Retenter visible uniquement sur dernier assistant avec `apiError` non `persistence`, id persistant et `persistenceFailed !== true` ;
- Régénérer visible uniquement sur dernier assistant réussi, non interrompu, avec contenu et id ;
- aucun bouton sur anciens assistants ;
- boutons désactivés pendant `isGenerating` ;
- clic appelle le bon callback avec id ;
- pendant recoveryMode, libellé de statut visible et boutons désactivés ;
- recoveryFailed affiche la note i18n ;
- bouton Copier reste unique et fonctionnel.

Une erreur assistant peut avoir `content === ""` : la rangée d’actions doit donc être rendue si `m.content || canRetry || m.recoveryMode`. Le bouton Copier reste conditionné à `m.content` pour ne pas copier une chaîne vide.

- [ ] **Step 4: Ajouter les boutons**

Importer `RefreshCw` et `RotateCcw`. Dans la rangée assistant existante, avant Copier :

```tsx
{canRetry && (
  <button type="button" disabled={isGenerating} onClick={() => void onRetry?.(m.id!)}>
    <RefreshCw className="size-3.5" aria-hidden="true" />
    <span className="sr-only">{t.chat.retry}</span>
  </button>
)}
{canRegenerate && (
  <button type="button" disabled={isGenerating} onClick={() => void onRegenerate?.(m.id!)}>
    <RotateCcw className="size-3.5" aria-hidden="true" />
    <span className="sr-only">{t.chat.regenerate}</span>
  </button>
)}
```

Utiliser les classes existantes d’action discrète ; focus visible, `title` i18n, aucune nouvelle couleur.

Afficher sous le contenu :

```tsx
{m.recoveryMode && <span role="status">{m.recoveryMode === "retry" ? t.chat.retrying : t.chat.regenerating}</span>}
{m.recoveryFailed && <p role="note">{t.chat.recoveryFailed}</p>}
```

- [ ] **Step 5: Câbler App**

Extraire du hook `retryLast`, `regenerateLast`. Créer des callbacks qui vérifient `activeId`, puis passer :

```tsx
onRetry={onRetry}
onRegenerate={onRegenerate}
```

- [ ] **Step 6: Vérifier et committer**

```bash
npx vitest run src/components/chat/ChatView.test.tsx src/App.test.tsx src/hooks/useChat.test.tsx
npx tsc --noEmit
git add src/components/chat/ChatView.tsx src/components/chat/ChatView.test.tsx src/App.tsx src/i18n/fr.ts
git commit -m "feat: ajoute retenter et régénérer au chat"
```

---

### Task 5: Vérification palier 2B

- [ ] **Step 1: Suites ciblées**

```bash
npx vitest run src/lib/chat/recoveryPolicy.test.ts src/lib/db/messages.test.ts src/hooks/useChat.test.tsx src/components/chat/ChatView.test.tsx src/App.test.tsx src/lib/mcp/webAgent.test.ts src/lib/ai/openai-compat.test.ts src/console-log.guard.test.ts
```

- [ ] **Step 2: Build WSL et périmètre**

```bash
npm run build
git diff --check ae13808..HEAD
git diff ae13808..HEAD -- src-tauri src/index.css tailwind.config.js package.json package-lock.json
```

Expected: build vert ; aucun changement Rust/CSS global/dépendances.

- [ ] **Step 3: Build Windows**

```powershell
Set-Location "C:\dev\LogAssist\.worktrees\chat-engine-palier-1"
npm run build
```

- [ ] **Step 4: Validation manuelle**

Dans Tauri :

1. provoquer une erreur fournisseur, cliquer Retenter, vérifier aucun doublon user ;
2. régénérer la dernière réponse, vérifier ancienne réponse visible jusqu’au succès ;
3. provoquer un échec de relance, vérifier ancienne réponse conservée ;
4. interrompre une relance avec Stop, vérifier ancienne réponse conservée ;
5. vérifier Web, sources, métriques, copie et changement de conversation ;
6. vérifier absence d’action sur ancien assistant, interruption et erreur persistence.

---

## Définition de terminé

- Retenter et Régénérer n’ajoutent aucun message user.
- La même ligne assistant est mise à jour après succès.
- Aucune ancienne réponse n’est perdue sur échec ou interruption.
- Une seule relance peut être active.
- Boutons visibles uniquement sur la dernière cible admissible.
- Tests, builds WSL/Windows et validation manuelle passent.
