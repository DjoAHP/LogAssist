# Connecteurs (GitHub) — Plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ajouter la notion de Connecteur à LogAssist, avec GitHub (lecture seule, un dépôt par conversation, moteur Rust natif) comme premier connecteur.

**Architecture:** Le réseau GitHub est 100 % Rust (`src-tauri/src/connectors/`, jeton dans le Credential Manager, validations strictes). React fournit l'UI (panneau de connecteurs, modal de configuration, sélecteur de dépôt, barre de saisie), une liaison SQLite `conversation_connectors` (migration V12) et trois outils bornés injectés dans le runtime MCP existant (routage composite vers la commande Rust).

**Tech Stack:** Tauri v2 / Rust (reqwest 0.13.5 rustls sans `json`, `url 2`, axum dev-dep) · React 19 + TS strict · SQLite via `tauri-plugin-sql` · Credential Manager · vitest/jsdom · TDD strict.

**Spécification :** `docs/superpowers/specs/2026-11-14-connecteurs-github-design.md`

**Règles transverses :**
- WSL : édition, `git`, `npx vitest run` (tests ciblés). PowerShell `C:\dev\LogAssist` : `npm install`, `npm run build`, `cargo test`, `cargo clippy`. **Jamais `npm install` sous WSL.**
- Chaînes UI : tout dans `src/i18n/fr.ts` (structure imbriquée). Aucun `console.log` hors `logger.ts`. Pas d'orange ; `bg-brand-from` ⇒ `text-brand-foreground`.
- Chaque phase se termine par un STOP, un résumé, la procédure de test manuel et un « ok » explicite de l'utilisateur avant la phase suivante.
- Icône : l'utilisateur fournit `src/icons/svg/github-connecteur.svg`. **Si absent au moment de la phase 1 : demander, ne pas inventer.**

---

## Structure des fichiers

```
src/
├── icons/index.tsx                                   [MOD] + GithubConnecteurIcon
├── icons/svg/github-connecteur.svg                   [NOUVEAU - fourni par l'utilisateur]
├── i18n/fr.ts                                        [MOD] domaines connectors.* + chat.*
├── components/settings/GeneralSettingsDialog.tsx     [MOD] catégorie "connectors"
├── components/settings/ConnectorsPanel.tsx           [NOUVEAU] galerie de tuiles
├── components/settings/GithubConnectorDialog.tsx     [NOUVEAU] modal jeton (phase 3)
├── components/chat/InputBar.tsx                      [MOD] bouton GitHub (phase 7)
├── components/chat/GithubRepoPickerDialog.tsx        [NOUVEAU] sélecteur de dépôt
├── components/chat/GithubChip.tsx                    [NOUVEAU] puce owner/repo@ref
├── lib/connectors/catalog.ts                         [NOUVEAU] manifeste
├── lib/connectors/client.ts                          [NOUVEAU] pont invoke (phase 3)
├── lib/connectors/errors.ts                          [NOUVEAU] ConnectorErrorKind
├── lib/connectors/errors.i18n.test.ts                [NOUVEAU] exhaustivité i18n
├── lib/connectors/tools.ts                           [NOUVEAU] McpAgentTool connecteur (phase 8)
├── lib/db/conversationConnectors.ts                  [NOUVEAU] repository (phase 6)
├── lib/db/migrations.ts                              [MOD] V12 (phase 6)
├── hooks/useConversationConnectors.ts                [NOUVEAU] hook liaison (phase 6)
├── hooks/useChat.ts                                  [MOD] 2 sites + limites (phase 8)
├── lib/mcp/types.ts                                  [MOD] kind "connector" (phase 8)
├── lib/mcp/runtime.ts                                [MOD] injection outils connecteur
├── lib/mcp/toolAgent.ts                              [MOD] limites paramétrables
├── lib/prompts/compose.ts                            [MOD] section dépôt (phase 8)
src-tauri/src/
├── connectors/mod.rs                                 [NOUVEAU] (phase 2)
├── connectors/error.rs                               [NOUVEAU] ConnectorError
├── connectors/validation.rs                          [NOUVEAU] owner/name/ref/path/query
├── connectors/github.rs                              [NOUVEAU] client HTTP (phase 2, 4, 5)
├── connectors/service.rs                             [NOUVEAU] état + annulation par turn
├── commands/connectors.rs                            [NOUVEAU] 6 commandes Tauri
├── lib.rs                                            [MOD] manage + invoke_handler
```

---

## Phase 1 — Socle UI (catégorie, panneau, manifeste, icône)

### Task 1 : icône GithubConnecteurIcon

**Files:** Create `src/icons/svg/github-connecteur.svg` (utilisateur), Modify `src/icons/index.tsx`

- [ ] **Étape 1 : vérifier la présence du SVG utilisateur.** `ls src/icons/svg/github-connecteur.svg`. Si absent → **STOP, demander le fichier à l'utilisateur** (interdit de l'inventer).
- [ ] **Étape 2 : test rouge.** Créer `src/icons/icons.test.tsx` (`// @vitest-environment jsdom`) :

```tsx
import { describe, expect, it } from "vitest"
import { GithubConnecteurIcon } from "./index"

describe("GithubConnecteurIcon", () => {
  it("expose un SVG 24x24 héritant la couleur courante", () => {
    expect(GithubConnecteurIcon).toBeDefined()
    const el = GithubConnecteurIcon({ className: "size-4" })
    expect(el.props.viewBox).toBe("0 0 24 24")
    expect(el.props.fill).toBe("currentColor")
    expect(el.props["aria-hidden"]).toBe(true)
  })
})
```

Exécuter `npx vitest run src/icons/icons.test.tsx` → FAIL (composant inexistant).
- [ ] **Étape 3 : implémentation.** Copier le tracé du SVG utilisateur dans un composant conforme au contrat de `McpIcon` (lignes 10-16 de `index.tsx`) : viewBox 24, `fill="currentColor"`, `aria-hidden="true"`, `className` propagé, **identifiants `id` retirés** (risque de collision DOM).
- [ ] **Étape 4 : test vert** puis commit `feat: icône connecteur GitHub`.

### Task 2 : manifeste des connecteurs

**Files:** Create `src/lib/connectors/catalog.ts` + test

- [ ] **Étape 1 : test rouge** `src/lib/connectors/catalog.test.ts` :

```ts
import { describe, expect, it } from "vitest"
import { CONNECTORS } from "./catalog"

describe("CONNECTORS", () => {
  it("déclare github comme connecteur natif avec sa référence secrète", () => {
    expect(CONNECTORS).toHaveLength(1)
    const gh = CONNECTORS[0]
    expect(gh.id).toBe("github")
    expect(gh.backend).toBe("native")
    expect(gh.secretRef).toBe("logassist/connectors/github")
    expect(gh.name).toBeTruthy()
  })
})
```

- [ ] **Étape 2 : implémentation.**

```ts
export type ConnectorBackend = "native" | "mcp_preset"

export interface ConnectorManifest {
  id: string
  name: string
  backend: ConnectorBackend
  secretRef: string
}

export const CONNECTORS: ConnectorManifest[] = [
  { id: "github", name: "GitHub", backend: "native", secretRef: "logassist/connectors/github" },
]
```

- [ ] **Étape 3 : vert, commit** `feat: manifeste des connecteurs`.

### Task 3 : catégorie « Connecteurs » + ConnectorsPanel

**Files:** Modify `src/i18n/fr.ts`, `src/components/settings/GeneralSettingsDialog.tsx` ; Create `src/components/settings/ConnectorsPanel.tsx` + test jsdom

- [ ] **Étape 1 : test rouge** `src/components/settings/ConnectorsPanel.test.tsx` (`// @vitest-environment jsdom`) : le panel rend une tuile `role="button"` nommée GitHub, badge « Non configuré » (texte `t.connectors.status.notConfigured`, classe `text-muted-foreground`) ; avec `status={{ configured: true, login: "octocat" }}` → badge « Connecté (@octocat) » en `text-green-600`.
- [ ] **Étape 2 : i18n.** Ajouter dans `src/i18n/fr.ts` un domaine `connectors` (imbriqué, comme `mcp`) : `title`, `panelTitle`, `status.notConfigured`, `status.connected` (avec `@{login}`), `configure`, `errors` (rempli en phase 3 — laisser les clés venir avec leur usage, le test i18n exhaustif arrive à la Task 9).
- [ ] **Étape 3 : implémentation.**
  - `GeneralSettingsDialog.tsx` : `type Category = "lock" | "connectors"`, entrée `{ id: "connectors", label: t.generalSettings.categories.connectors, icon: Plug }` (import `lucide-react`), et rendu conditionnel du panneau.
  - Ajouter `generalSettings.categories.connectors: "Connecteurs"` dans `fr.ts`.
  - `ConnectorsPanel.tsx` : grille de tuiles carrées `rounded-lg` (coins légèrement arrondis), icône connecteur centrée, nom dessous, badge d'état ; clic → `onSelect(connector)`.
- [ ] **Étape 4 : vert + gardes-fous** (`npx vitest run src/components/settings src/brand-color.guard.test.ts src/console-log.guard.test.ts`), commit `feat: catégorie Connecteurs et panneau de tuiles`.

**STOP Phase 1** (résumé, test manuel PowerShell : `npm run tauri dev`, ouvrir Paramètres généraux › Connecteurs, voir la tuile GitHub « Non configuré » ; effort phase 2/1 à estimer).

---

## Phase 2 — Rust : jeton (configure / status / delete)

### Task 4 : module connecteurs + erreur + validation

**Files:** Create `src-tauri/src/connectors/{mod,error,validation}.rs` + tests unitaires dans `validation.rs`

- [ ] **Étape 1 : test rouge** — dans `validation.rs`, `#[cfg(test)]` couvrant :

```rust
// owner : valide "DjoAHP", refuse "", "-abc" (début non alphanumérique), "a".b" (point interdit), 40+ car.
// name  : valide "LogAssist", "repo.name-1"; refuse "", "..", "a b", 101 car.
// ref   : valide "main", "feature/x-1"; refuse "..", contrôle, "a/b/../c", "/lead", "trail/", 256 car.
// path  : refuse "a/../b", "a\\b", "a\u{0}b", "a".repeat(513), absolu "/etc/passwd", "%2e%2e" normalisé encodé -> segments safe
// query : refuse "", 257 car., "language:go" (aucun terme hors qualificateur)
```

Chaque cas : `assert!(validate_owner(...).is_err())` etc. Exécuter `cargo test` (PowerShell) → FAIL (fichiers absents → compile).
- [ ] **Étape 2 : implémentation.**

```rust
// error.rs — payload public, jamais de corps HTTP / URL / jeton
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "snake_case")]
pub struct ConnectorErrorPayload { pub kind: ConnectorErrorKind, pub message: String }

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum ConnectorErrorKind {
    NotConfigured, Auth, Forbidden, RateLimit, NotFound, TooLarge,
    Binary, DeniedPath, Offline, Timeout, InvalidArguments, Unknown,
}
```

```rust
// validation.rs — regex once_cell : owner ^[A-Za-z0-9][A-Za-z0-9-]{0,38}$ ; name ^[A-Za-z0-9._-]{1,100}$
// ref : !is_empty && len<=255 && !contains("..") && aucun char de contrôle && !starts_with('/') && !ends_with('/')
// path : relatif, sans "..", sans '\\', sans NUL, <=512 car. ; chaque segment URL-encodé via url::Url::parse (base factice) ou percent-encoding
// query : <=256 car. et au moins un terme hors motif "mot:" (qualificateur)
```

- [ ] **Étape 3 : vert (`cargo test`), commit** `feat: validations connecteur GitHub`.

### Task 5 : client HTTP GitHub (hôte injectable)

**Files:** Create `src-tauri/src/connectors/github.rs` + test d'intégration avec faux serveur axum

- [ ] **Étape 1 : test rouge** — `src-tauri/src/connectors/github_test.rs` (`#[cfg(test)]` dans mod.rs) : faux serveur axum (pattern dev-dep, comme les tests MCP) sur `127.0.0.1:0` ; routes `GET /user` (200 `{"login":"octocat"}`, 401, timeout, réponse 10 Mo), `GET /user/repos`. Tests : header `Authorization: Bearer tok` présent ; `User-Agent` commence par `LogAssist/` ; `X-GitHub-Api-Version: 2022-11-28` ; 401 → `kind=Auth` ; timeout → `Timeout` ; corps > borne → `TooLarge` ; **redirection 302 vers autre hôte → `Offline` (non suivie)** ; zéro occurrence du jeton dans le message d'erreur.
- [ ] **Étape 2 : implémentation.**

```rust
pub struct GithubClient { base_url: String, http: reqwest::Client }
// prod : GithubClient::production() -> base_url "https://api.github.com" FIGÉE (const, jamais paramétrable par DTO)
// client : Client::builder().no_proxy().redirect(Policy::none()).retry(never())
//          .connect_timeout(10s).timeout(30s)  (configure : 15s)
// lecture bornée : collecter octets avec plafond (512 Kio / 256 Kio / 8 Mio selon appel), couper et requalifier en TooLarge
// headers : User-Agent format!("LogAssist/{}", env!("CARGO_PKG_VERSION")),
//           Accept application/vnd.github+json, X-GitHub-Api-Version 2022-11-28, Authorization Bearer
// rate limit : si (403|429) && header x-ratelimit-remaining == "0" -> RateLimit
```

- [ ] **Étape 3 : vert, commit** `feat: client HTTP GitHub borné`.

### Task 6 : service + commandes configure/status/delete

**Files:** Create `src-tauri/src/connectors/service.rs`, `src-tauri/src/commands/connectors.rs` ; Modify `src-tauri/src/lib.rs`

- [ ] **Étape 1 : test rouge** — tests service : `configure` avec jeton invalide (401 du faux serveur) → `Auth` ET le secret existant inchangé (remplacement transactionnel : écrire un secret initial via `write_secret`, tenter un remplacement échoué, relire → identique) ; succès → secret écrit, login retourné ; `status` → `{configured, login}` sans jamais contenir `token` (sérialiser le payload et grep) ; `delete` idempotent (2ᵉ appel OK) ; le login est inscrit dans la table `settings` via le pont `tauri_plugin_sql::DbInstances` (pattern du pont transactionnel MCP, section 4.1 de la spec galerie).
- [ ] **Étape 2 : implémentation.**

```rust
// service.rs — ConnectorGithubService { credential: CredentialStore, github: GithubClient }
// secretRef const : "logassist/connectors/github", enveloppe {"version":1,"token":...}
// configure(token) : valider non vide + longueur (<= 255) -> GET /user -> si 200 : write_secret + login ; sinon erreur, rien d'écrit
// status()  : read_secret -> configured + login (settings) ; JAMAIS le jeton
// delete()  : remove_secret + purge login ; idempotent
```

```rust
// commands/connectors.rs — pattern commands/mcp.rs :
// #[tauri::command] connector_github_configure(service: State<'_, ConnectorGithubService>, token: String) -> Result<StatusDto, ConnectorErrorPayload>
// connector_github_status(...) / connector_github_delete(...)
// lib.rs : .manage(ConnectorGithubService::production(...)) + 3 commandes dans generate_handler!
```

- [ ] **Étape 3 : vert + clippy** (`cargo test`, `cargo clippy --all-targets -- -D warnings`), commit `feat: configuration du jeton GitHub côté Rust`.

---

## Phase 3 — Modal de configuration (React)

### Task 7 : pont TS + erreurs i18n

**Files:** Create `src/lib/connectors/errors.ts`, `client.ts`, `errors.i18n.test.ts` ; Modify `src/i18n/fr.ts`

- [ ] **Étape 1 : test rouge** `errors.i18n.test.ts` (copie du pattern `lib/mcp/errors.i18n.test.ts`) : pour **chaque** `CONNECTOR_ERROR_KINDS` (12 kinds, section 8 de la spec), `t.connectors.errors[kind]` existe et non vide.
- [ ] **Étape 2 : implémentation.**

```ts
// errors.ts
export const CONNECTOR_ERROR_KINDS = ["not_configured","auth","forbidden","rate_limit","not_found","too_large","binary","denied_path","offline","timeout","invalid_arguments","unknown"] as const
export type ConnectorErrorKind = (typeof CONNECTOR_ERROR_KINDS)[number]

// client.ts — pont invoke, jamais get_secret
import { invoke } from "@tauri-apps/api/core"

/** Liaison dépôt par conversation ; ref peut être null (= branche par défaut). */
export interface GithubBinding { owner: string; name: string; ref: string | null }
/** Résumé minimal renvoyé par connector_github_list_repos (DTO Rust camelCasé côté TS). */
export interface GithubRepoSummary {
  fullName: string
  isPrivate: boolean
  defaultBranch: string | null
  updatedAt: string | null
}
export interface GithubConnectorStatus { configured: boolean; login: string | null }
export const connectorGithub = {
  configure: (token: string) => invoke<GithubConnectorStatus>("connector_github_configure", { token }),
  status: () => invoke<GithubConnectorStatus>("connector_github_status", {}),
  delete: () => invoke<void>("connector_github_delete", {}),
  listRepos: (page: number) => invoke<GithubRepoSummary[]>("connector_github_list_repos", { page }),
  listBranches: (owner: string, name: string) => invoke<string[]>("connector_github_list_branches", { owner, name }),
  callTool: (binding: GithubBinding, tool: string, args: Record<string, unknown>, turnId: string) =>
    invoke<{ text: string }>("connector_github_call_tool", { binding, tool, args, turnId }),
  cancelTurn: (turnId: string) => invoke<void>("connector_github_cancel_turn", { turnId }),
}
```

```ts
// fr.ts — connectors.errors.* (12 clés), ex. :
// auth: "Authentification refusée — remplacez le jeton dans Paramètres généraux › Connecteurs"
// rate_limit: "Limite de débit GitHub atteinte — réessayez dans quelques instants"
// denied_path: "Fichier refusé pour raisons de sécurité (identifiants ou clé privée probable)"
```

- [ ] **Étape 3 : vert, commit** `feat: pont TS et erreurs i18n du connecteur GitHub`.

### Task 8 : GithubConnectorDialog

**Files:** Create `src/components/settings/GithubConnectorDialog.tsx` + test jsdom

- [ ] **Étape 1 : test rouge** (`GithubConnectorDialog.test.tsx`) : champ mot de passe **jamais prérempli** ; « Tester et enregistrer » appelle `configure` et affiche le résultat en `aria-live` ; échec → message i18n du kind, ancien état conservé ; connecté → « Connecté en tant que @login » + boutons « Remplacer » / « Déconnecter » ; déconnexion → `dialogConfirm` (`@tauri-apps/plugin-dialog`, import `confirm as dialogConfirm`) avant suppression ; avertissement jeton classique affiché ; lien de création du jeton via `TauriLink` ; Échap ferme la sous-modale d'abord ; focus initial sur le champ jeton.
- [ ] **Étape 2 : implémentation.** Sous-modale taille adaptée (ne PAS réutiliser `HEADER_TOOL_DIALOG_SIZE_CLASS`) ; consultation de `status()` au montage ; texte explicite « le contenu lu est envoyé au fournisseur LLM actif » (clé i18n `connectors.dialog.llmWarning`).
- [ ] **Étape 3 : vert + gardes-fous, commit** `feat: modal de configuration GitHub`.

**STOP Phase 3** (test manuel : créer un fine-grained token « Contents : lecture seule » sur github.com, le coller, vérifier « Connecté en tant que @… », tester un jeton invalide → message, Déconnecter → confirmation).

---

## Phase 4 — Rust : dépôts et branches

### Task 9 : list_repos / list_branches

**Files:** Modify `src-tauri/src/connectors/github.rs`, `service.rs`, `commands/connectors.rs`, `lib.rs`

- [ ] **Étape 1 : test rouge** (faux serveur) : `list_repos(1)` → `GET /user/repos?sort=pushed&direction=desc&per_page=50&page=1` (vérifier query du faux serveur) ; mapping minimal `{ full_name, private, default_branch, updated_at }` (ignorer le reste) ; `page > 50` → `InvalidArguments` ; `list_branches` → `per_page=100`, retour des `name` seulement, **100 max tronqués côté Rust** ; 404 → `NotFound` ; validation owner/name invalide → `InvalidArguments` **sans requête réseau**.
- [ ] **Étape 2 : implémentation + 2 commandes** (`connector_github_list_repos`, `connector_github_list_branches`) dans `lib.rs`.
- [ ] **Étape 3 : vert, commit** `feat: listage dépôts et branches GitHub`.

---

## Phase 5 — Rust : les 3 outils

### Task 10 : connector_github_call_tool + repo_map

**Files:** Modify `github.rs`, `service.rs`, `commands/connectors.rs`, `lib.rs`

- [ ] **Étape 1 : test rouge** : alias inconnu → `InvalidArguments` ; `repo_map()` sans liaison → `InvalidArguments` (la commande exige `binding`) ; arbre filtré (`.git`, `node_modules`, `dist`, `build`, `target`, `vendor`, `.venv`, `__pycache__`) ; coupe à 400 entrées / 30 000 car. **avec mention de troncature** ; réponse `truncated: true` → repli `GET .../contents/{path}` (non récursif, borne 1 000 fichiers documentée) ; corps > 8 Mio → `TooLarge`.
- [ ] **Étape 2 : implémentation** — URL construite via `url::Url` (`format!` du chemin + query encodés, **jamais de concaténation brute**) ; `ref` encodé ; `depth` borné (1-10).
- [ ] **Étape 3 : vert, commit** `feat: outil repo_map`.

### Task 11 : read_file

- [ ] **Étape 1 : test rouge** : lignes numérotées `N|contenu` ; fenêtre `start_line`/`end_line` (bornes 1..=50 000, `end>=start`) ; coupe 400 lignes / 24 000 car. avec « total N lignes, continue avec start_line=… » ; NUL dans les 8 premiers Kio → `Binary` ; chemin refusé (`.env`, `.env.local`→refus, `.env.example`→OK, `server.pem`, `id_rsa`, `credentials.json`, `.npmrc`, `.pypirc`) → `DeniedPath` **sans réseau** ; `Content-Length > 512 Kio` → `TooLarge` avant lecture ; 404 → `NotFound`.
- [ ] **Étape 2 : implémentation** (média `Accept: application/vnd.github.raw+json` ; `ref` en query).
- [ ] **Étape 3 : vert, commit** `feat: outil read_file`.

### Task 12 : search_code

- [ ] **Étape 1 : test rouge** : `q = "{query}+repo:{owner}/{name}"` (qualificateur imposé par Rust, le modèle ne peut cibler un autre dépôt) ; 20 résultats max (`per_page=20`), champs `path` (+ fragment si dispo) ; ref ≠ `default_branch` → **préambule d'avertissement dans le résultat** (« recherche limitée à la branche par défaut X, liaison pointe Y ») ; 403/429 avec `x-ratelimit-remaining=0` → `RateLimit` ; 422 → message d'outil « requête invalide ou aucun terme ».
- [ ] **Étape 2 : implémentation.**
- [ ] **Étape 3 : vert + tests chemins malveillants de la Task 4 rejoués de bout en bout, commit** `feat: outil search_code`.

### Task 13 : annulation par tour

- [ ] **Étape 1 : test rouge** : `call_tool` long (faux serveur qui traîne) + `cancel_turn(turn_id)` → retour prompt `Offline`/annulé et la requête en cours abandonnée ; `cancel_turn` inconnu → idempotent.
- [ ] **Étape 2 : implémentation** — registre `Mutex<HashMap<String, Vec<CancellationToken>>>` dans le service ; `call_tool` enregistre sous `turn_id`, retire à la fin ; `connector_github_cancel_turn` annule tout.
- [ ] **Étape 3 : vert + clippy, commit** `feat: annulation des appels GitHub par tour`.

**STOP Phase 5** (test manuel PowerShell : `cargo test`, puis appeler `connector_github_call_tool` via la console MCP ou un test d'intégration manuel ; effort phase 6/5 à estimer).

---

## Phase 6 — Liaison par conversation (migration V12)

### Task 14 : migration V12

**Files:** Modify `src/lib/db/migrations.ts`

- [ ] **Étape 1 : test rouge** — étendre le test migrations existant : depuis base **V11** (créer les tables jusqu'à V11, appliquer V12) → table `conversation_connectors` avec PK composite et FK `ON DELETE CASCADE` ; base **neuve** → `user_version = 12` ; `SCHEMA_VERSION === 12` ; cascade testée (supprimer une conversation ⇒ la liaison disparaît).
- [ ] **Étape 2 : implémentation.**

```ts
export const SCHEMA_VERSION = 12

export const SCHEMA_V12_STATEMENTS = [
  `CREATE TABLE IF NOT EXISTS conversation_connectors (
    conversation_id INTEGER NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
    connector_id TEXT NOT NULL,
    resource_owner TEXT NOT NULL,
    resource_name TEXT NOT NULL,
    resource_ref TEXT,
    created_at TEXT NOT NULL,
    PRIMARY KEY (conversation_id, connector_id)
  )`,
]
```

- [ ] **Étape 3 : vert, commit** `feat: migration V12 conversation_connectors`.

### Task 15 : repository + hook

**Files:** Create `src/lib/db/conversationConnectors.ts`, `src/hooks/useConversationConnectors.ts` + tests

- [ ] **Étape 1 : test rouge** (pattern `conversationKnowledge.ts`, SQL paramétré) : `get(conversationId, "github")` → liaison ou `null` ; `set` remplace (upsert `INSERT OR REPLACE`) avec `resource_ref` nullable ; `remove` ; validation des entrées TS côté dépôt (owner/name/ref regexes miroir de Rust, valeurs rejetées localement).
- [ ] **Étape 2 : implémentation.** Hook : `useConversationConnectors(conversationId)` → `{ binding, attach, detach }` avec état React ; aucune logique métier au-delà de la persistance (le `kind`/les outils restent en phase 8).
- [ ] **Étape 3 : vert, commit** `feat: repository et hook de liaison connecteur`.

---

## Phase 7 — Barre de saisie

### Task 16 : bouton GitHub + états + puce

**Files:** Modify `src/components/chat/InputBar.tsx`, `src/i18n/fr.ts` ; Create `src/components/chat/GithubChip.tsx`, `GithubRepoPickerDialog.tsx` + tests jsdom ; Modify `src/App.tsx`

- [x] **Étape 1 : test rouge** (`InputBar.test.tsx` étendu) : bouton GitHub (`aria-label` i18n) entre le bouton fichier texte et le bouton Web, gabarit `h-[38px]` ; états :
  - `githubAvailable=false` → `disabled` + `title="Configurez GitHub dans Paramètres généraux › Connecteurs"` ;
  - prêt → activable ;
  - attaché → accent `text-[var(--brand-to)]` + puce `GithubChip` « owner/name@ref » avec bouton de retrait (aria-label i18n) ;
  - clic prêt → ouvre le picker.
- [x] **Étape 2 : picker.** Recherche filtrante client (sur les dépôts déjà chargés), badge « privé » (i18n), « Charger plus » (`listRepos(page+1)`) tant que le serveur renvoie une page pleine, select de branche (défaut présélectionnée, `listBranches` au besoin, max 100), bouton « Attacher » → `onAttach({owner, name, ref})`.
- [x] **Étape 3 : câblage App.tsx.** Nouvelles props `InputBar` (UI pure) : `githubAvailable`, `githubAttached: GithubBinding | null`, `onOpenRepoPicker`, `onDetachRepo`. `App.tsx` fournit valeurs issues de `useConversationConnectors(activeId)` + statut connecteur (hook léger `useGithubConnectorStatus` ou état chargé au montage).
- [x] **Étape 4 : vert + gardes-fous, commit** `feat: bouton GitHub et sélecteur de dépôt dans la barre de saisie`.

**STOP Phase 7** (test manuel : attacher un dépôt public, un privé, changer de branche, détacher, puce visible/retirée).

---

## Phase 8 — Intégration chat + finitions

### Task 17 : kind "connector" + outils générés

**Files:** Modify `src/lib/mcp/types.ts`, `src/lib/mcp/runtime.ts` ; Create `src/lib/connectors/tools.ts` + tests

- [ ] **Étape 1 : test rouge** : `McpAgentTool.kind` accepte `"connector"` ; `buildConnectorTools(binding)` (binding + jeton configuré) produit **3** `McpAgentTool` : `serverId: "connector_github"`, `llmName: "connector_github__repo_map|read_file|search_code"`, `approvalMode: "auto"`, `kind: "connector"`, `inputSchema` bornés (propriétés `path`, `start_line`, `end_line` / `query` / `path`, `depth` — `additionalProperties: false`) ; sans liaison ou sans jeton → tableau vide ; plafond catalogue 64 outils / 256 Kio respecté (les 3 schémas ≪ limites).
- [ ] **Étape 2 : implémentation** — `loadMcpRuntime()` fusionne `listAgentTools()` + `buildConnectorTools(binding)` ; `runtime.ts` reçoit la liaison en paramètre (le hook la lui fournit) ; `useChat` consomme le runtime étendu sans connaître GitHub.
- [ ] **Étape 3 : vert (non-régression MCP incluse), commit** `feat: outils connecteur dans le runtime`.

### Task 18 : routage composite + limites paramétrables

**Files:** Modify `src/lib/mcp/toolAgent.ts`, `useChat.ts` (lignes 610-624 ET 771-785)

- [ ] **Étape 1 : test rouge** : client composite — appel `llmName` préfixé `connector_github__` → `connectorGithub.callTool(binding, nativeName, args, turnId)` ; tout autre → client MCP actuel ; défauts `MAX_TOOL_ROUNDS=2` / `MAX_MCP_CALLS=4` **inchangés sans dépôt** (tests MCP existants intacts) ; avec dépôt attaché → 6 tours / 12 appels ; les deux sites `useChat` passent les outils étendus et un `turnId` identique pour l'annulation.
- [ ] **Étape 2 : implémentation.** `toolAgent.ts` : `MAX_TOOL_ROUNDS`/`MAX_MCP_CALLS` deviennent options d'entrée (`input.limits?`), constantes 2/4 par défaut ; dépôt attaché ⇒ `{ toolRounds: 6, mcpCalls: 12 }`.
- [ ] **Étape 3 : vert, commit** `feat: routage connecteur et limites de tour paramétrables`.

### Task 19 : annulation + system prompt + modèle sans outils

**Files:** Modify `src/hooks/useChat.ts` (chemin d'interruption — rechercher l'appel `mcp_cancel_turn`/client MCP), `src/lib/prompts/compose.ts`, `src/lib/chat/prepareConversationContext.ts`, `src/i18n/fr.ts`

- [ ] **Étape 1 : test rouge** : interruption appelle `connectorGithub.cancelTurn(turnId)` en plus du cancel MCP ; `buildSystemPrompt({..., repoBinding})` ajoute la section « Dépôt GitHub attaché : owner/name@ref » + sécurité (contenu non fiable, citer les chemins, ne pas deviner) ; sans `repoBinding` → aucune section (test snapshot du prompt) ; repli sans outils avec dépôt attaché → variante d'avertissement « le dépôt est inaccessible » (clé i18n dédiée).
- [ ] **Étape 2 : implémentation.** `prepareConversationContext` transmet `repoBinding` depuis la liaison chargée ; le plafond 64 outils/256 Kio (`buildActiveToolCatalog`) couvre aussi les outils connecteur — en cas de dépassement, erreur explicite (jamais d'éviction silencieuse).
- [ ] **Étape 3 : vert, commit** `feat: intégration chat du dépôt attaché`.

### Task 20 : docs + version + gates

**Files:** Modify `README.md`, `AGENTS.md` (invariants, structure, schéma V12, livraison v3.4.0), `DESIGN_SYSTEM.md` (tuiles connecteurs + `GithubConnecteurIcon`), `package.json` (3.4.0)

- [ ] **Étape 1 :** `npm run sync:version` après passage de `package.json` à `3.4.0` ; vérifier Cargo.toml + tauri.conf.json alignés.
- [ ] **Étape 2 :** mettre à jour les 3 docs (sections : notion Connecteur, lecture seule, un dépôt par conversation, jeton Credential Manager, schéma V12, livraison).
- [ ] **Étape 3 :** gates PowerShell : `npm run build`, `cargo test`, `cargo clippy --all-targets -- -D warnings` → verts.
- [ ] **Étape 4 :** commit `chore: v3.4.0 connecteurs GitHub`, push, **PR vers `feat/m1-socle-chat` sans merger**.

**STOP Phase 8** — checklist de test manuel :
1. Créer un fine-grained token (Contents : lecture seule) et le configurer (badge @login).
2. Attacher un dépôt public, poser 3 questions de difficulté croissante (structure ? contenu d'un fichier précis ? recherche d'un symbole).
3. Attacher un dépôt privé, refaire une question.
4. Révoquer le jeton → message clair, puce « indisponible », le chat répond sans outils.
5. Couper le réseau → `offline` clair, réponse conservée.
6. Gros fichier (>512 Kio), binaire, `.env` → messages `too_large` / `binary` / `denied_path`.
7. Modèle sans outils → avertissement « dépôt inaccessible ».
8. Interruption pendant une lecture → appel abandonné, contenu partiel non persisté.
