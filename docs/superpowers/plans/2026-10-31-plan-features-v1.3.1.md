# Plan d'implémentation — Vagues de fonctionnalités v1.3.1 (6 features)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implémenter les 6 fonctionnalités validées : fichiers texte en pièce jointe, récupération auto des modèles, épingler les conversations, export .md, réordonner les connaissances, connaissances par conversation (sémantique « remplace le global »).

**Architecture:** Une migration SQL V4 unique (pinned, sort_order, table conversation_knowledge). Repos TDD comme existant (mocks database.jsdom). Paramètre adaptateur pour les modèles distants (`listRemoteModels` sur `IProvider`). Export via plugins Tauri dialog+fs. UI calquée sur les patterns existants (overlay, chips, footer).

**Tech Stack:** Tauri v2 + React 19 + TS strict + vitest + @tauri-apps/plugin-dialog, @tauri-apps/plugin-fs (nouveaux).

**Spec:** conversation en cours (validation utilisateur, 31/10/2026) : features 3/5/6/7/8/12 ; sémantique feature 8 = les overrides de conversation **remplacent** le global ; formats texte = **.md + .txt seulement** (PDF rejeté pour l'instant) ; température abandonnée et remplacée par l'export .md.

## Global Constraints

- SQL 100 % paramétré (`?` binds). Migrations : `SCHEMA_VERSION` incrémenté + nouveau tableau `SCHEMA_V*_STATEMENTS` + wiring dans `executeSchema` (database.ts).
- Zéro `console.log` hors `src/lib/logger.ts` (garde-fou `console-log.guard.test.ts`). `console.error` existant toléré, pas de nouveau.
- Toute chaîne UI via `t` (`src/i18n/fr.ts`), aucune chaîne en dur dans les composants — nouvelles clés sous `assistant`, `chat`, `sidebar`, `settings`, `export`.
- Clé API : jamais en SQLite/localStorage/log ; lecture uniquement via `secrets.get(secretRefFor(id))`.
- Tests d'abord (RED vu, puis GREEN) ; `npx vitest run` complet vert avant chaque commit ; commits conventionnels `feat:`/`fix:`.
- `npm install` de dépendances runtime Tauri → côté **PowerShell Windows** (règle AGENTS.md). Édits Rust dans `src-tauri/`, builds Windows.
- Couleurs de marque via classes `brand-from/brand-to` (mapping tailwind.config.js).

## Review Focus

1. **Fichier texte > 512 Mo ou binaire renommé .md** : rejet silencieux (même convention que les images), message jamais sauvegardé sans accord du test du cap (Task 2, `fileToText`).
2. **Connaissance supprimée pendant qu'une conversation l'active** : FK ON DELETE CASCADE sur conversation_knowledge → l'override disparaît, pas de dangling ref (Task 1, test migration).
3. **Export d'une conversation vide** : bouton désactivé tant que la conversation n'a pas de messages ou n'existe pas (Task 5, App.tsx `disabled`).
4. **Récupération modèles sans clé API** : message `t.settings.noKey`, aucun appel réseau (Task 3).
5. **Toggle panel « connaissances » d'une conversation sans override** : premier décochage calcule le set de départ = ids globalement activés, puis bascule (Task 7, KnowledgePanel).

---

### Task 1: Migration V4 — pinned, sort_order, conversation_knowledge

**Files:**
- Modify: `src/lib/db/migrations.ts` (SCHEMA_VERSION=4 + `SCHEMA_V4_STATEMENTS`)
- Modify: `src/lib/db/database.ts` (bloc `fromVersion < 4`)
- Test: `src/lib/db/migrations.test.ts`

**Interfaces:**
- Produces: tables alterées `conversations.pinned INTEGER NOT NULL DEFAULT 0`, `knowledge.sort_order INTEGER NOT NULL DEFAULT 0`, table `conversation_knowledge (conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE, knowledge_id TEXT NOT NULL REFERENCES knowledge(id) ON DELETE CASCADE, PRIMARY KEY (conversation_id, knowledge_id))`.

- [ ] **Step 1: Écrire le test (RED)**

Ajouter à `migrations.test.ts` :
- `SCHEMA_VERSION` attendu = 4
- `describe("SCHEMA_V4_STATEMENTS")` : `SCHEMA_V4_STATEMENTS` contient un `ALTER TABLE conversations ADD COLUMN pinned` avec `DEFAULT 0`, un `ALTER TABLE knowledge ADD COLUMN sort_order` avec `DEFAULT 0`, un `CREATE TABLE IF NOT EXISTS conversation_knowledge` avec les 2 FK `ON DELETE CASCADE` et `PRIMARY KEY (conversation_id, knowledge_id)`.

- [ ] **Step 2: Vérifier le RED** — Run `npx vitest run src/lib/db/migrations.test.ts` — Expected: FAIL

- [ ] **Step 3: Implémenter (GREEN)** — `SCHEMA_VERSION = 4`, `SCHEMA_V4_STATEMENTS` (3 statements : les 2 ALTER + le CREATE TABLE), bloc `if (fromVersion < 4)` dans `executeSchema`.

- [ ] **Step 4: Vérifier le GREEN** — Run `npx vitest run src/lib/db/migrations.test.ts` — Expected: PASS (5 + 1 test)

- [ ] **Step 5: Commit** — `git add src/lib/db/migrations.ts src/lib/db/migrations.test.ts src/lib/db/database.ts && git commit -m "feat: migration V4 (pin, tri connaissances, overrides par conversation)"`

### Task 2: Feature 3 — Pièces jointes texte (.md/.txt)

**Files:**
- Modify: `src/components/chat/InputBar.tsx` (2e input fichier, type Attachment partagé)
- Modify: `src/hooks/useChat.ts` (attachement `kind`, injection dans le contenu user)
- Modify: `src/components/chat/ChatView.tsx` (bulle : image vs chip fichier)
- Modify: `src/i18n/fr.ts` (clé `chat.addFile`)
- Test: `src/components/chat/InputBar.test.tsx`, `src/hooks/useChat.test.tsx`

**Interfaces:**
- Produces: `export interface Attachment { id: string; kind: "image" | "text"; base64: string; mimeType: string; name: string; text?: string }` (défini dans `useChat.ts`, importé par InputBar — même contrat déjà exporté, on y ajoute `kind`/`text`). Images : `kind:"image"` (immuté). Texte : `kind:"text"`, `base64:""`, `mimeType` détecté (`text/markdown` ou `text/plain`), `text` = contenu lu.
- Injection : chaque pièce jointe texte ajoute au contenu user envoyé/persisté : `\n\n[Fichier joint : ${name}]\n\`\`\`\n${text}\n\`\`\``. Un seul bloc par fichier, dans l'ordre.

- [ ] **Step 1: RED useChat** — test : `send("conv-1", "Aide-moi", [ { id:"t1", kind:"text", base64:"", mimeType:"text/markdown", name:"HISE.md", text:"## Mode d'emploi" } ])` → l'insert user contient `content` contenant `"Aide-moi"` puis `"## Mode d'emploi"` entre triple backticks ; `streamMock` reçoit le même contenu. Une image (`kind:"image"`) continue de partir en `images` du ChatMessage, sans double bloc texte.

- [ ] **Step 2: Vérifier RED** (`npx vitest run src/hooks/useChat.test.tsx` → FAIL sur content)

- [ ] **Step 3: GREEN useChat** — dans `send` : composer `const textBlocks = attachments.filter(a => a.kind === "text").map(a => `\n\n[Fichier joint : ${a.name}]\n\`\`\`\n${a.text ?? ""}\n\`\`\``).join("")`, `const fullContent = content + textBlocks` ; utiliser `fullContent` pour l'API **et** l'insert. `apiImages` filtré sur `kind === "image"`. Persist des attachments : inclure `kind` dans le JSON (objets `{id, name, mimeType, kind}`).

- [ ] **Step 4: RED InputBar** — test jsdom : clic sur le label "Fichier texte" (`aria-label` = `t.chat.addFile`), simulation `change` du 2e input avec `new File(["## md"], "HISE.md", {type:"text/markdown"})` + mock `File.text` → l'attachment apparaît avec `kind:"text"` et son `text` ; un fichier > 512 Ko (`Object.defineProperty(file,"size",...)`) est rejeté silencieusement ; un `Image.png` sur le 1er input continue de produire `kind:"image"` avec base64.

- [ ] **Step 5: Vérifier RED**

- [ ] **Step 6: GREEN InputBar** — renommer `fileToBase64` éléments : `fileToText(file): Promise<Attachment>` (accept `.md`/`.txt`, cap `MAX_TEXT_SIZE = 512 * 1024` en octets, `await file.text()`), 2e `<input id="text-file-upload">` + `<label>` avec icône `FileText`, chip rendu pareil (nom) — pas de `img` pour kind text (chatView). `ALLOWED_TEXT_TYPES`: texte, fallback : si `file.type` vide, accepter si extension `.md/.txt` (Windows parfois renvoie "").

- [ ] **Step 7: RED ChatView** — la bulle affiche un chip fichier (icône `FileText` + nom), pas un `<img>` cassé, quand `kind` du payload historisé est `"text"` (les historisés viennent de `mapRow` : parser `kind` du JSON des attachments ; base64 `""` images : bug existant non traité ici).

- [ ] **Step 8: Vérifier RED puis GREEN ChatView** (`npx vitest run src/components/chat`)

- [ ] **Step 9: Suite verte complète** — `npx tsc --noEmit && npx vitest run` — PASS

- [ ] **Step 10: Commit** — `git commit -m "feat: pièces jointes texte .md/.txt injectées comme contexte"`

### Task 3: Feature 12 — Récupération automatique des modèles

**Files:**
- Modify: `src/lib/ai/types.ts` (`StreamCallbacks`… interface provider ; ajouter `listRemoteModels(apiKey: string): Promise<string[]>` à `IProvider`)
- Modify: `src/lib/ai/openai-compat.ts` (implémentation GET `${base}/models`)
- Modify: `src/components/settings/SettingsDialog.tsx` (bouton par provider + statut)
- Modify: `src/i18n/fr.ts` (`settings.fetchModels`, `settings.fetchingModels`, `settings.fetchOk` — pluriel géré par squelette ? Non : message `"${n} modèle(s) ajoutés"` via clé `fetchOkCount`)
- Test: `src/lib/ai/openai-compat.test.ts`, `src/components/settings/SettingsDialog.test.tsx` (le fichier n'existe pas encore → le créer)

**Interfaces:**
- Produces: `IProvider.listRemoteModels(apiKey: string): Promise<string[]>` — renvoie les ids `data[].id` du `GET ${base}/models` (Bearer). Erreurs : `normalizeHttpStatus` (avec `retryAfterMs`) / `normalizeNetworkError` — même contrat que `complete`.
- `mockListRemoteModels` = vi.hoisted dans SettingsDialog.test, mock de `@/lib/ai/factory` : `createProvider` retourne `{ testConnection, listRemoteModels: mockListRemoteModels }`.

- [ ] **Step 1: RED compat** — test : stub `globalThis.fetch` renvoie `{ ok:true, json: async () => ({ data: [{ id: "m/a" }, { id: "m/b" }, {}] }) }` → résout `["m/a","m/b"]` (les sans-id filtrés) ; stub `{ ok:false, status:401 }` → rejette `ApiError` (`auth`).

- [ ] **Step 2: Vérifier RED**

- [ ] **Step 3: GREEN compat** — `listRemoteModels` comme `complete` (même try/catch). 

- [ ] **Step 4: RED SettingsDialog** — test : Dialog ouvert avec un provider avec clé (`secrets.get` → `"sk-x"`), cliquer le bouton `t.settings.fetchModels` → le mock renvoie `["m1","m1","m2"]` ; `providers.addModel` appelé 2 fois exactement (`m1` et `m2`, pas de doublon vs `listModels` existant `[m1]`) ; sans clé (`secrets.get → null`) : aucun `fetch`, statut fail avec `t.settings.noKey` ; erreur rejetée → statut fail avec `t.errors[KIND_TO_KEY[e.kind]]`.

- [ ] **Step 5: Vérifier RED — nouveau fichier test vierge : implémenter les mocks (providers, secrets, factory) comme AssistantDialog.test.tsx`

- [ ] **Step 6: GREEN SettingsDialog** — état `fetchStatus` : `{ state:"fetching" } | { state:"ok"; added:number } | { state:"fail"; message:string }` (Record par provider, réutiliser le pattern `testStatus`). Handler `fetchModels(p)`: lire `secrets.get(secretRefFor(p.id))` → null → fail noKey ; sinon `createProvider(...).listRemoteModels(key)` ; `const existing = new Set((await providers.listModels(p.id)).map(m => m.model_id))` ; `for (const id of ids) if (!existing.has(id)) await providers.addModel(p.id, id)` ; aprèsChange().

> Vérifier le nombre exact d'ids extraits du mock avant d'écrire l'assertion (doublon retire = 3 ids uniques pour le test ci-dessus, ajuster).

- [ ] **Step 7: Vérifier GREEN + suite complète** — `npx tsc --noEmit && npx vitest run`

- [ ] **Step 8: Commit** — `git commit -m "feat: bouton récupérer les modèles depuis l'API du fournisseur"`

### Task 4: Feature 5 — Épingler des conversations

**Files:**
- Modify: `src/lib/db/conversations.ts` (`get`, `setPinned`, ordre SQL)
- Modify: `src/components/sidebar/Sidebar.tsx` (bouton pin, icône remplie si épinglée)
- Modify: `src/i18n/fr.ts` (`sidebar.pin`, `sidebar.unpin`)
- Test: `src/lib/db/conversations.test.ts`, `src/components/sidebar/Sidebar.test.tsx`

**Interfaces:**
- Produces: `conversations.get(id: string): Promise<ConversationRow | null>` (utilisé par Task 5, export) ; `conversations.setPinned(id, pinned: boolean): Promise<void>` (UPDATE paramétré, pas de garde fantôme nécessaire — UPDATE no-op sûr).
- Ordre list : `ORDER BY pinned DESC, updated_at DESC` (inclureArchived aussi ; activeé par défaut).

- [ ] **Step 1: RED conversations** — 3 tests opérés : `list` / `list(true)` : SQL contient `pinned DESC, updated_at DESC` ; `setPinned("c1", true)` : bind `[1,"c1"]` ; `get` : renvoie la 1re ligne du mock select, `null` si vide.

- [ ] **Step 2: Vérifier RED**

- [ ] **Step 3: GREEN conversations**

- [ ] **Step 4: RED Sidebar** — test : une conversation `pinned: 1` → bouton pin avec aria-pressed="true" (icône remplie, `fill-current`), clic → `onPin(id, false)` ; non-épinglée → aria-pressed="false", clic → `onPin(id, true)` ; la toggle ne déclenche PAS `onSelect` (stopPropagation déjà établi dans les actions de la liste).

- [ ] **Step 5: Vérifier RED**

- [ ] **Step 6: GREEN Sidebar** — bouton icône `Pin` (lucide) dans le groupe d'actions (avant modifier), `className` : épinglée passe sens + `fill-current text-brand-from`, pas de fill sinon ; App fil : `onPin={(id, pinned) => void conversations.setPinned(id, pinned).then(refresh)}.

- [ ] **Step 7: Vérifier GREEN + suite** — `npx tsc --noEmit && npx vitest run`

- [ ] **Step 8: Commit** — `git commit -m "feat: épingler les conversations en haut de la sidebar"`

### Task 5: Feature 6 — Export d'une conversation en .md

**Files:**
- Create: `src/lib/export/markdown.ts`
- Create: `src/lib/export/download.ts`
- Modify: `src/App.tsx` (bouton download dans le header, activé si conversation active)
- Modify: `src/i18n/fr.ts` (section `export`)
- Modify: `src-tauri/Cargo.toml`, `src-tauri/src/lib.rs` (plugins dialog + fs), `src-tauri/capabilities/default.json` (permissions)
- Test: `src/lib/export/markdown.test.ts`, `src/lib/export/download.test.ts` (mocks des modules plugin)
- Installer (PowerShell): `npm install @tauri-apps/plugin-dialog @tauri-apps/plugin-fs`

**Interfaces:**
- Produces: `conversationToMarkdown(conv: ConversationRow, msgs: MessageRow[], labels: { user: string; assistant: string }): string` — en-tête `# ${titre}` puis date ISO du jour ; un bloc par message : `**${labels[m.role]}**\n\n${content}\n\n---` (PAS de fence — ce n'est pas du code ; contenu passé tel quel, markdown brut, jamais d'innerHTML).
- Produces: `downloadMarkdown(filename, content): Promise<void>` — dynamic `await import("@tauri-apps/plugin-dialog")` → `save({ defaultPath: filename, filters: [{ name: "Markdown", extensions: ["md"] }] })` ; annule → return ; sinon `writeTextFile(path, content)` de plugin-fs. Nommage fichier : `${slug(conversation.title)}-${conv.id.slice(0,8)}.md`.

- [ ] **Step 1: RED markdown util** — import pur : titre en en-tête H1, date ISO du jour en 2e ligne, intercalage `---` entre messages, labels respectés, aucune entité HTML échappée (le contenu passe tel quel : c'est du markdown, pas du HTML ; pas d'`innerHTML` de la part du projet).

- [ ] **Step 2: Vérifier RED — run ton fichier de test markdown**

- [ ] **Step 3: GREEN markdown util**

- [ ] **Step 4: RED download** — `vi.mock("@tauri-apps/plugin-dialog", () => ({ save: mockSave }))` + `vi.mock("@tauri-apps/plugin-fs", () => ({ writeTextFile: mockWrite }))` : `save → "C:\\out\\HISE.md"` → `writeTextFile` appelé avec `("C:\\out\\HISE.md", content)` ; `save → null` → write non appelé.

- [ ] **Step 5: Vérifier RED**

- [ ] **Step 6: GREEN download**

- [ ] **Step 7: RED App.tsx wiring** — test plus lourd ; garde visuel : bouton Download disabled tant que `activeId === null` (aria-disabled) + onClick appelle la lib. Piste de test léger : extraire le handler dans `src/lib/export/exportConversation.ts` (create/convos/messages/get + conversationToMarkdown + download) testé unitairement ; App branché dessus en 1 ligne (pas de test App.tsx — convention du projet).

- [ ] **Step 8: Tauri (côté Rust, à runner sous Windows pour build)** — `Cargo.toml` : `tauri-plugin-dialog = "2"`, `tauri-plugin-fs = "2"` (vérifier la version exacte via doc context7) ; `src-tauri/src/lib.rs` : `.plugin(tauri_plugin_dialog::init()) .plugin(tauri_plugin_fs::init())` après `tauri::Builder` ; `capabilities/default.json` : ajouter `"dialog:default"`, `"fs:allow-write-text-file"`. **Vérification : build Windows `npm run tauri dev` et tester l'export réel.**

- [ ] **Step 9: Suite verte (WSL)** — `npx tsc --noEmit && npx vitest run`

- [ ] **Step 10: Commit** — `git commit -m "feat: export d'une conversation en markdown"`

### Task 6: Feature 7 — Réordonner les connaissances (flèches)

**Files:**
- Modify: `src/lib/db/knowledge.ts` (`move`, ordre list, `add` → sort_order max+1)
- Modify: `src/components/settings/AssistantDialog.tsx` (ChevronUp/ChevronDown par item)
- Modify: `src/i18n/fr.ts` (`assistant.moveUp`, `assistant.moveDown`)
- Test: `src/lib/db/knowledge.test.ts`, `src/components/settings/AssistantDialog.test.tsx`

**Interfaces:**
- Produces: `knowledge.move(id: string, direction: -1 | 1): Promise<void>` — charge `list()` trié, trouve l'index, calcule le voisin, swape les `sort_order` (DEUX UPDATE paramétrés, transaction simple pas utile en M1), no-op aux bornes. `list()` : `ORDER BY sort_order ASC, created_at ASC`. `add()` : assigne `sort_order = max+1`.

- [ ] **Step 1: RED knowledge.move** — tests : move(2e, -1) swape avec le 1er (2 UPDATE, binds inversés) ; move(1er, -1) → aucun execute ; move(id fantôme) → aucun execute ; `add` installe `sort_order` suivant le max ; `list` SQL contient `sort_order ASC`.

- [ ] **Step 2: Vérifier RED**

- [ ] **Step 3: GREEN knowledge**

- [ ] **Step 4: RED AssistantDialog UI** — 2e élément : bouton `aria-label={t.assistant.moveUp}` appelle `knowledge.move("k2", -1)` ; 1er élément : moveUp désactivé (`disabled`) ; moveDown symétrique.

- [ ] **Step 5: Vérifier RED puis GREEN** — refresh après move (pattern `toggle` déjà présent).

- [ ] **Step 6: Suite verte + commit** — `npx vitest run && git commit -m "feat: réordonner les connaissances par flèches"`

### Task 7: Feature 8 — Connaissances par conversation (remplace le global)

**Files:**
- Create: `src/lib/db/conversationKnowledge.ts`
- Create: `src/components/chat/KnowledgePanel.tsx`
- Modify: `src/components/chat/ChatView.tsx` (bouton flottant top-right, props optionnelles)
- Modify: `src/App.tsx` (prop `knowledgePanel={{ conversationId: activeId }}` si actif)
- Modify: `src/hooks/useChat.ts` (résolution des connaissances pour la conversation)
- Modify: `src/i18n/fr.ts` (section `knowledgePanel`)
- Test: `src/lib/db/conversationKnowledge.test.ts`, `src/components/chat/KnowledgePanel.test.tsx`

**Interfaces:**
- Produces: `conversationKnowledge.listOn(conversationId): Promise<string[]>` (ids activés via overrides) ; `conversationKnowledge.setOn(conversationId, knowledgeId, on: boolean): Promise<void>` (INSERT vs DELETE, SQL paramétré).
- Produces (ChatView) : `props.knowledgePanel?: { conversationId: string }` — bouton flottant top-right (icône `Library`) au-survol du log ; le panel liste checkbox « nom » par connaissance.
- Produces (useChat) : dans `send`, remplacer `knowledgeDb.listEnabled()` :
  ```
  const overrideIds = await convKnowledge.listOn(conversationId)
  const knowledgeRows = overrideIds.length > 0
    ? (await knowledgeDb.list()).filter(k => overrideIds.includes(k.id))
    : await knowledgeDb.listEnabled()
  ```

- [ ] **Step 1: RED repo conversationKnowledge** — `listOn` : SELECT knowledge_id WHERE conversation_id = ? → bind string[] des rows ; `setOn(id, kid, true)` : INSERT INTO conversation_knowledge (conversation_id, knowledge_id) VALUES (?,?) ; false : DELETE FROM ... WHERE conversation_id = ? AND knowledge_id = ?.

- [ ] **Step 2: Vérifier RED**

- [ ] **Step 3: GREEN repo**

- [ ] **Step 4: RED KnowledgePanel** — jsdom, mocks `knowledge.list`, `knowledge.listEnabled`, `conversationKnowledge` ; pas d'override → checkbox reflète `enabled` global ; décocher un activé → `setOn(convId, kId, true→false)` avec le set de départ calculé (premier appel crée les overrides manquants) ; avec overrides `[k2]` → seul k2 checked, indépendamment du global ; clic bouton ouvre/replie le popover.

- [ ] **Step 5: Vérifier RED puis GREEN** — orchestration : au clic du toggle sans overrides → composer : `base = ids des rows enabled===1`, flip du ciblé, appliquer via `setOn` pour chaque id (bulk : INSERT/DELETE par éléments du diff).

- [ ] **Step 6: RED useChat sémantique** — mocks `@/lib/db/conversationKnowledge` (vi.hoisted) ; overrideIds `["k1"]` → `buildSystemPrompt` reçoit knowledge `[{name:"HISE", content:"..."}]` même si `listEnabled` mock renvoie autre chose ; overrideIds `[]` → comportement global inchangé.

- [ ] **Step 7: Vérifier RED puis GREEN useChat**

- [ ] **Step 8: Suite verte + commit** — `npx tsc --noEmit && npx vitest run && git commit -m "feat: connaissances activables par conversation (remplace le global)"`

---

## Ordre & dépendances

Task 1 (migration V4) AVANT 4 (pinned), 6 (sort_order), 7 (conversation_knowledge). Task 2, 3, 5 indépendantes de la migration. Task 7 dépend de 6 dans l'UI (ordre des fichiers listés), mais pas fonctionnellement.

## Notes d'exécution

- Chaque task : TDD strict (rouge vu) + suite complète avant commit.
- Task 5 (plugins Tauri) : versions exactes à pincer via doc context7 (`/tauri-apps/plugin-dialog` v2, `/tauri-apps/plugin-fs` v2) et valide le au build **Windows** (`npm run tauri dev`) la première fois.
- i18n : rédiger les clés AVANT l'implémentation UI de chaque task (le test en dépend).
