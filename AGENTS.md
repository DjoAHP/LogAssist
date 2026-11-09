# AGENTS.md — LogAssist

Instructions pour les agents IA (opencode, Claude, Cursor…) travaillant dans ce dépôt.
Répondre **en français**. Ne jamais supposer des connaissances implicites de la part de
l'utilisateur (débutant actif, ex no-code) : expliquer le *pourquoi*, pas seulement le *comment*.

---

## 1. Le projet en une minute

**LogAssist** est une application desktop de chatbot IA (Tauri v2) pour apprendre des
logiciels : conversations persistées (SQLite), fournisseurs LLM configurables (OpenAI
compatible, testé avec NVIDIA NIM), accès Web MCP TinyFish et clés API stockées dans le
Credential Manager Windows.

| Couche      | Techno                                     |
|-------------|--------------------------------------------|
| Shell       | Tauri v2 (Rust, `src-tauri/`)              |
| UI          | React 19 + TypeScript strict + Tailwind 3  |
| État/logique| Hooks React (`src/hooks/`)                 |
| Data        | SQLite via `tauri-plugin-sql` (`src/lib/db/`) |
| IA          | Adaptateurs `IProvider` (`src/lib/ai/`)    |
| Web / MCP   | TinyFish via `rmcp` côté Rust (`src-tauri/src/mcp/`) |
| Secrets     | Credential Manager Windows (commandes Rust `src-tauri/src/commands/secrets.rs`) |

### Invariants à ne JAMAIS casser

1. **La clé API ne vit jamais dans SQLite, en localStorage, ni dans les logs.**
   Seul stockage : Credential Manager, référencé par convention `secretRefFor()`.
2. **SQL 100 % paramétré** (`?` binds) — jamais de concaténation dans une requête.
3. **Aucun `innerHTML`/`dangerouslySetInnerHTML`** — contenu LLM rendu échappé par React.
4. **Migrations** : ajouter un statement `IF NOT EXISTS` dans `src/lib/db/migrations.ts`
   et incrémenter `SCHEMA_VERSION` (mécanisme `PRAGMA user_version`).
5. **Erreurs** : passer par `normalizeHttpStatus`/`normalizeNetworkError` (`src/lib/ai/errors.ts`).
   Toute nouvelle `ApiErrorKind` ⇒ nouvelle clé i18n (test `errors.i18n.test.ts` le garantit).
6. **Zéro `console.log`** hors `src/lib/logger.ts` et fichiers de test — le garde-fou
   `src/console-log.guard.test.ts` fait échouer le build sinon.
7. **Contrat anti-perte** : `useChat.send()` retourne `Promise<boolean>` et ne lève
   jamais ; `false` = échec AVANT persistence du message utilisateur ⇒ InputBar restaure
   le contenu. Ne pas renvoyer d'exception à la place.
8. **Version sync** : `npm run sync:version` maintient `package.json`, `Cargo.toml` et `tauri.conf.json` alignés.
9. **MCP fermé côté Rust** : endpoint TinyFish compilé en dur, seuls `search` et
   `fetch_content` sont exposés. React ne fournit jamais d'endpoint MCP.
10. **Données Web non fiables** : ne jamais persister le contenu brut TinyFish. Seules
    les sources finales validées (`url`, `title`, `origin`) vivent dans `messages.sources`.

---

## 2. Environnement : règle critique WSL ⇆ Windows

| Action | Où | Pourquoi |
|---|---|---|
| Éditer le code, git, opencode, tests `vitest` | **WSL Ubuntu** | tooling Node partagé |
| `npm install` (par défaut), `npm run tauri dev/build` | **PowerShell / Windows** | Tauri compile du Rust natif Windows ; binaires `node_modules/.bin` spécifiques plateforme |
| Base SQLite `logassist.db` | partagée (`C:\dev\LogAssist` = `/mnt/c/dev/LogAssist`) | un seul fichier physique |

**Interdit** : `npm install` depuis WSL quand un build Windows est prévu ensuite
(casse `tauri` — les binaires Linux écrasent les Windows). Les devDependencies JS
pures (`@testing-library/*`) peuvent s'installer exceptionnellement en WSL, avec
`npm install` re-passé sous PowerShell juste après.

### Commandes (sous PowerShell Windows, dans `C:\dev\LogAssist`)

```powershell
npm install          # première fois ou après installation WSL
npm run tauri dev    # dev : Rust + Vite + fenêtre Tauri
npm run build        # tsc && vitest run && vite build (+ tauri build lors des releases)
npm run test         # npx vitest run
```

`npm run build` est **gated par les tests** : un test rouge bloque le build.

Compte GitHub : **DjoAHP** (via `gh`). Git en WSL.

---

## 3. Structure du code

```
src/
├── components/        # UI (chat/, settings/, sidebar/) — pas de logique métier
├── hooks/             # useChat (streaming + persist), useConversations
├── lib/
│   ├── ai/            # IProvider, openai-compat, sse.ts, errors.ts, factory
│   ├── chat/          # contexte pur, TurnRunner, récupération et politique de scroll
│   ├── db/            # repos SQL (migrations.ts, providers, messages, conversations…)
│   ├── secrets/       # pont Credential Manager (invoke Rust)
│   ├── prompts/       # system prompt composé + defaults
│   ├── mcp/           # pont Tauri, intention Web et orchestrateur borné
│   ├── i18n/fr.ts     # TOUTE chaîne UI (aucun littéral en dur dans les composants)
│   └── logger.ts      # debug (no-op en prod) / error
└── *.test.ts(x)       # vitest : lib sans DOM, composants avec @vitest-environment jsdom
src-tauri/
├── src/commands/secrets.rs   # set/get/delete secret (keyring v4, backend Windows only)
├── src/commands/mcp.rs       # config, appel et annulation MCP génériques
├── src/mcp/                  # registre, validation, service et transport TinyFish
├── capabilities/default.json # permissions Tauri : sql, opener, http:default scope https://*
└── tauri.conf.json           # CSP dev/prod séparées
```

- Pattern **adaptateur** : tout consommateur depend de `IProvider` (`createProvider`),
  jamais d'un fournisseur concret. Nouveau backend (ex. Gemini V2) = un nouvel adaptateur.
- **Streaming SSE** : `parseSseStream` (`lib/ai/sse.ts`) gère multibyte UTF-8, CRLF et
  flush final — ne pas réimplémenter côté consommateur.
- **Abort** : un `AbortController` par stream ; l'interruption utilisateur persiste le
  contenu accumulé et marque `interrupted: true` (différent d'une erreur API).
- **Relances** : `Retenter` et `Régénérer` ciblent uniquement la dernière réponse
  admissible. Le message utilisateur n'est jamais dupliqué et l'ancienne réponse reste
  intacte tant que le remplacement SQLite n'a pas réussi.
- **Métriques** : elles appartiennent à chaque réponse. Un coût n'est affiché que si
  l'endpoint, le modèle, l'usage et les tokens cachés permettent un calcul fiable.
- **MCP TinyFish** : `runToolAgent` autorise deux tours d'outils et quatre appels MCP
  maximum. Le modèle reçoit les résultats dans un bloc externe non fiable. Le repli
  sans outils ne s'exécute qu'une fois et l'incompatibilité est mémorisée par session.
- **Sources** : la migration V5 ajoute `messages.sources`. Les URL sont validées côté
  Rust avant le retour vers React puis filtrées à nouveau avant rendu.
- **Schéma courant** : V8. V6 ajoute les métriques, V7 nettoie les anciennes erreurs
  potentiellement sensibles, V8 répare les assistants historiques vides.
- **Images** : le base64 n'est jamais persisté. Après rechargement, seule la puce de
  métadonnées reste visible ; ne pas introduire de cache binaire durable.

### Conventions

- Commentaires en français, qui tracent les *invariants* (gates, séquencement), pas le code.
- Couleurs de marque : **#9FBFD6** (bleu gris) et **#27C8D6** (cyan) — variables
  `--brand-from`/`--brand-to` dans `src/index.css`. À utiliser pour tout accent UI.
  Ne pas réintroduire d'orange dans les nouveaux éléments d'interface.
  Tout bouton `bg-brand-from` doit aussi utiliser `text-brand-foreground`
  (`#000000`) afin de garantir un texte noir sur cet accent clair.
- Les modales principales des outils du header utilisent obligatoirement
  `HEADER_TOOL_DIALOG_SIZE_CLASS` (`1100px × 75vh`, `max-width: 96vw`), défini
  dans `src/components/settings/headerToolDialog.ts` et documenté dans
  `DESIGN_SYSTEM.md`. Ne pas créer de dimension locale concurrente.
- Tests : nommer le comportement, pas l'implémentation ; TDD (test d'abord, vu rouge,
  puis code minimal). jsdom via commentaire `// @vitest-environment jsdom` par fichier.

---

## 4. Sécurité (threat model résumé)

- La **base de données et le code frontend sont dans le périmètre de confiance webview** ;
  le Credential Manager est le seul stockage sensible. Ne pas contourner.
- La capability `http:default` autorise `https://*` pour les fournisseurs LLM
  configurables. Le trafic MCP TinyFish passe déjà entièrement côté Rust ; déplacer
  aussi le trafic LLM reste une amélioration ultérieure.
- Le secret TinyFish suit la convention `logassist/mcp/tinyfish`. Une clé candidate
  est vérifiée en mémoire avant de remplacer la clé existante.
- Ne jamais logger de secret, ne jamais persist `detail` d'erreur API contenant
  potentiellement un `Bearer` sans l'éduler (redaction) avant `messages.error`.
- Ne pas ajouter `dangerouslySetInnerHTML`, `eval`, ou de rendu markdown sans échappement.

---

## 5. Git

- Commits conventionnels légers : `feat:`, `fix:`, `chore:` (voir `git log`).
- `*.db`, `*.db-journal`, `node_modules`, `dist`, `src-tauri/target` sont ignorés —
  ne jamais committer la base SQLite.
- Un commit = un sujet cohérent ; les tests doivent passer avant le commit.
- Branche principale GitHub : `feat/m1-socle-chat`. Ne jamais forcer-push sur une branche partagée.

---

## 6. Chantiers connus (issus de l'audit d'oct. 2026 — à ne pas re-découvrir)

Priorisés dans l'ordre du rapport d'audit :
1. **Cluster robustesse** :
   ✅ Images d'historique `base64: ""` corrigé — garde `!a.base64` → chip texte, jamais `<img src="">` (ChatView.tsx).
   ✅ Clés React stables `m.id ?? local-${i}` (ChatView.tsx) — élargir la règle aux nouveaux `.map()`.
   ✅ Race `onDone`/refetch corrigée : les promesses de persistance sont attendues avant `busy=false`.
2. **Cluster sécurité** : HTTP MCP déplacé côté Rust avec allowlist et validation URL ;
   restent le HTTP LLM à déplacer, le format `secret_ref` générique à valider et la
   CSP `connect-src https:` à restreindre en prod.
3. **Cluster UI** : focus clavier invisible (`--ring` absent), palette de tokens
   incomplète.
   ✅ **Auto-scroll respectueux** (v3.0.0) — suivi au bas, lecture figée après remontée,
   bouton de retour et gestion des reflows/images tardives.
   ✅ **Dark mode toggle** implémenté (v2.1.2) — défaut dark, toggle header + persistance localStorage.
   ✅ **Fenêtre maximisée au lancement** (v2.1.2) — `maximized: true` dans `tauri.conf.json`.
   ✅ **Icônes unifiées** (v2.1.2) — régénérées depuis `logo3.png` (script `scripts/generate-icons.js`).
   ✅ **ModelPickerModal** — remplace `ModelDropdown` (modal recherche/ajout/clic-activer).
4. **Tooling** : ESLint/Prettier/CI absents ; tests hooks à élargir.

### Livraison v2.5.0

- Intégration MCP TinyFish (`search`, `fetch_content`) avec transport `rmcp` côté Rust.
- Configuration dédiée, test transactionnel de clé et stockage Credential Manager.
- Orchestrateur Web automatique/forcé, repli sans outils, annulation et limites bornées.
- Sources persistées et rendues comme liens React sûrs ; contenu Web brut non persisté.
- Gates validées : 217 tests TypeScript, 21 tests Rust, Clippy et build Windows.

### Livraison v3.0.0

- Moteur de tour extrait (`TurnRunner`) et construction du contexte isolée.
- Verrou synchrone contre les doubles envois et persistance assistant attendue.
- Métriques par réponse : TTFT, latence, tokens, usage exact/estimé et coût nullable.
- Tarification OpenAI officielle avec prise en compte des tokens cachés ; aucun faux
  coût pour OpenRouter, les endpoints personnalisés ou les modèles inconnus.
- Présentation hybride, largeur de lecture étendue et fond translucide des réponses.
- Auto-scroll intelligent avec bouton **Nouvelle réponse** et accessibilité clavier.
- Actions **Retenter** et **Régénérer** sans doublon utilisateur ni perte de réponse.
- Redaction renforcée des clés dans les erreurs, logs, réglages et données historiques.
- Migrations V6 à V8 ; comportement éphémère des captures conservé.
- 496 tests TypeScript validés dans le worktree de release ; build Vite Windows validé.
