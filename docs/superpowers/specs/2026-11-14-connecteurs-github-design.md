# Connecteurs LogAssist — GitHub en premier

Date : 14 novembre 2026

Branche : `feat/connecteur-github` (depuis `feat/m1-socle-chat`)

Statut : conception validée (décisions du prompt + réponses utilisateur)

## 1. Contexte

LogAssist expose déjà des outils au modèle via MCP (TinyFish intégré, galerie de
serveurs distants, orchestrateur borné). Cette livraison introduit une notion
distincte : le **Connecteur**. Un connecteur rattache une ressource externe —
ici un dépôt GitHub — à une conversation, et fournit au modèle des outils
**natifs** exécutés par le backend Rust, sans passer par le protocole MCP.

Le premier connecteur est **GitHub, en lecture seule** : le modèle peut
explorer l'arbre du dépôt, lire des fichiers et rechercher du code dans le
dépôt attaché à la conversation. Ce n'est pas « tout le dépôt dans le
prompt » : le contexte reste borné par `ContextSession`, et le modèle reçoit
des outils bornés.

Ce chantier touche les secrets, le réseau, SQLite, le system prompt et le chat.
La conception maintient les 13 invariants d'`AGENTS.md` et les règles de
sécurité additionnelles listées en section 10.

## 2. Objectifs

- Catégorie « Connecteurs » dans Paramètres généraux : galerie de tuiles
  carrées (coins légèrement arrondis, icône, nom dessous, badge d'état).
- Configuration d'un jeton d'accès personnel GitHub, stocké uniquement dans le
  Credential Manager Windows sous `logassist/connectors/github`.
- Attacher **un dépôt** du compte connecté à une conversation depuis la barre
  de saisie (icône GitHub, sélecteur de dépôt, choix de branche).
- Fournir au modèle trois outils Rust bornés : `repo_map`, `read_file`,
  `search_code` (aliases préfixés `connector_github__`).
- Garantir que le modèle ne peut lire **que** le dépôt attaché : la liaison
  owner/repo/ref est stockée côté application ; le modèle ne fournit jamais
  owner, repo ni ref.
- Abandonner les appels GitHub en vol lors de l'interruption du chat.

## 3. Hors périmètre (V1)

- Écriture sur GitHub (issues, PR, commits) — lecture seule.
- Plusieurs dépôts par conversation (décidé : un seul ; le schéma le permet).
- Sources GitHub cliquables sous les réponses (décidé : non en V1).
- Connecteurs via serveur MCP (`backend: "mcp_preset"` réservé au manifeste).
- OAuth GitHub ; seul le jeton collé est accepté.
- Webhooks, synchronisation continue, indexation locale du dépôt.
- Autres connecteurs (GitLab, Drive…) : le manifeste les prépare sans
  implémentation.

## 4. Décisions structurantes

### 4.1 Moteur natif Rust

GitHub est implémenté en **Rust natif** via l'API REST, pas via le serveur MCP
GitHub officiel : portée globale de la galerie MCP, coût de schémas et plafond
de 64 outils ne conviennent pas à un connecteur par conversation. Rust fait
tout le réseau ; React ne fournit jamais l'hôte (fixe `https://api.github.com`).

Le manifeste `src/lib/connectors/catalog.ts` porte
`backend: "native" | "mcp_preset"` pour de futurs connecteurs.

### 4.2 Authentification par jeton collé

- Recommandé : jeton fine-grained « Contents : lecture seule » (+ accès
  `metadata` implicite).
- **Accepté : jeton classique** (décision utilisateur), avec avertissement
  affiché dans le modal : périmètre potentiellement plus large, à révoquer
  depuis github.com/settings/tokens.
- Test transactionnel : le candidat est vérifié en mémoire (`GET /user`),
  stocké seulement si succès ; l'ancien jeton est conservé sinon.
- Le login GitHub obtenu (`@login`) est stocké **en clair** dans la table
  `settings` (clé `connectors.github.login`) : donnée publique, sert au badge.

### 4.3 Liaison par conversation

- **Un seul dépôt par conversation** (décision utilisateur).
- La liaison vitre dans SQLite (table `conversation_connectors`, migration
  V12) : `owner`, `name`, `ref`. Le **modèle ne fournit jamais**
  owner/repo/ref : les outils Rust les lisent depuis la commande.
- Outils en `approvalMode: "auto"` (lecture seule, bornés, allowlist Rust).

### 4.4 Outils et limites

| Alias | Argument | Endpoint GitHub | Limites |
|---|---|---|---|
| `connector_github__repo_map` | `path?`, `depth?` | `GET /repos/{o}/{r}/git/trees/{ref}?recursive=1` | 400 entrées / 30 000 car. ; filtres `.git`, `node_modules`, `dist`, `build`, `target`, `vendor`, `.venv`, `__pycache__` |
| `connector_github__read_file` | `path`, `start_line?`, `end_line?` | `GET /repos/{o}/{r}/contents/{path}?ref={ref}` (média `application/vnd.github.raw`) | 512 Kio, 400 lignes / 24 000 car. par injection |
| `connector_github__search_code` | `query` | `GET /search/code?q={query}+repo:{o}/{r}` | 256 car., 20 résultats |

Tout dépassement tronque **en le disant** (ex. « total N lignes, continue avec
start_line=… »). Si l'arbre récursif répond `truncated: true`, repli sur la
liste non récursive du répertoire demandé.

### 4.5 Recherche de code : contraintes GitHub (doc officielle)

- Débit **10 requêtes/minute** (authentifié) — plus strict que le 5 000/h
  primaire.
- **Branche par défaut uniquement** : si la liaison pointe une autre ref,
  l'outil le dit explicitement au modèle dans le résultat.
- Fichiers > 384 Ko non indexés ; requête ≤ 256 caractères ; au moins un terme
  de recherche obligatoire.
- `403`/`429` (débit) et `422` (validation) deviennent des messages d'outil.

## 5. Modèle de données — migration V12

`SCHEMA_VERSION` passe de 11 à **12** (`PRAGMA user_version`).

```sql
CREATE TABLE IF NOT EXISTS conversation_connectors (
  conversation_id INTEGER NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  connector_id TEXT NOT NULL,
  resource_owner TEXT NOT NULL,
  resource_name TEXT NOT NULL,
  resource_ref TEXT,
  created_at TEXT NOT NULL,
  PRIMARY KEY (conversation_id, connector_id)
);
```

- Pas de `CHECK` sur la liste des connecteurs (le manifeste TS fait foi).
- `connector_id = 'github'` en V1 ; un dépôt = une ligne.
- Repository : `src/lib/db/conversationConnectors.ts` (SQL 100 % paramétré,
  pattern `conversationKnowledge.ts` : `get(conversationId, connectorId)`,
  `set(conversationId, connectorId, binding)`, `remove(conversationId, connectorId)`).
- Hook : `src/hooks/useConversationConnectors.ts` (nouveau pattern, aucune
  équivalence existante — vérifié).

## 6. Authentification et secrets

- Référence Credential Manager : `logassist/connectors/github` (convention
  existante, jamais de secret en SQLite/localStorage/logs/erreurs).
- Enveloppe versionnée simple : `{"version":1,"token":"…"}` (l'hôte est figé,
  pas d'empreinte de configuration nécessaire).
- Commandes Tauri dédiées — React n'appelle **jamais** `get_secret` pour ce
  jeton :
  - `connector_github_configure(token)`: teste `GET /user` (15 s), stocke si
    succès, retourne `{ login }` ;
  - `connector_github_status()`: `{ configured: bool, login: string | null }`
    sans jamais retourner le jeton ;
  - `connector_github_delete()`: suppression idempotente + nettoyage du login.
- Le modal indique que le contenu lu (y compris des secrets committés par
  erreur) est envoyé au fournisseur LLM actif.

## 7. Sécurité réseau Rust

Client `reqwest` (0.13.5, `rustls`, sans feature `json` → `serde_json::from_slice`
sur octets bornés) :

- hôte fixe `https://api.github.com`, HTTPS uniquement, jamais fourni par
  React ;
- redirections `Policy::none()` (comme `mcp/transport.rs`) — aucun transfert
  d'en-tête d'authentification vers une autre origine ;
- `connect_timeout` 10 s, timeout total 30 s (config : 15 s) ;
- tailles de réponse bornées : 512 Kio (`read_file`), 8 Mio (arbre, max
  documenté GitHub = 7 Mio en récursif), 256 Kio pour les réponses JSON
  simples ;
- headers obligatoires : `User-Agent: LogAssist/<version>`,
  `Accept: application/vnd.github+json`, `X-GitHub-Api-Version: 2022-11-28`,
  `Authorization: Bearer <token>` ;
- débit : lecture des en-têtes `x-ratelimit-remaining` ; 403/429 avec
  `remaining = 0` → `rate_limit`.

### 7.1 Validation des entrées (côté Rust, jamais à React seul)

- `owner` : `^[A-Za-z0-9][A-Za-z0-9-]{0,38}$`
- `name` : `^[A-Za-z0-9._-]{1,100}$`
- `ref` : ≤ 255 car., sans `..`, sans caractère de contrôle, sans `/` en
  début/fin
- `path` (du modèle) : relatif, sans `..`, sans `\`, sans NUL, ≤ 512 car.,
  segments encodés via `url::Url` (aucune concaténation d'URL)
- `query` : ≤ 256 car., au moins un terme hors qualificateur

### 7.2 Fichiers refusés (`read_file`)

`.env`, `.env.*` (sauf `.example`/`.sample`), `*.pem`, `*.key`, `*.p12`,
`*.pfx`, `id_rsa*`, `id_ed25519*`, `.npmrc`, `.pypirc`, `credentials*`.
Message d'outil clair : « Fichier refusé pour raisons de sécurité ».

Binaire : NUL dans les 8 premiers Kio → refus.

## 8. Registre d'exécution Rust

Module `src-tauri/src/connectors/` :

- `github.rs` : client HTTP (hôte injectable en tests, figé en prod) ;
- `tools.rs` : validation, troncatures, messages d'outils ;
- `service.rs` : état Tauri `ConnectorGithubService` avec registre
  d'annulation par `turn_id` (esprit `mcp_cancel_turn`, solution la plus
  simple cohérente avec le registre MCP) ;
- commandes (`src-tauri/src/commands/connectors.rs` ou équivalent, enregistrées
  dans `lib.rs`) :
  - `connector_github_configure` / `connector_github_status` /
    `connector_github_delete` ;
  - `connector_github_list_repos(page)`: `GET /user/repos?sort=pushed&direction=desc&per_page=50&page=N`
    (tri activité récente confirmé doc ; pagination bornée, champs minimaux :
    `full_name`, `private`, `default_branch`, `updated_at`) ;
  - `connector_github_list_branches(owner, name)`: `GET /repos/{o}/{r}/branches?per_page=100`
    (100 max, confirmé doc) ;
  - `connector_github_call_tool(tool, args, turn_id)` : résout owner/repo/ref
    depuis la commande Tauri (le prompt appelle avec `binding` passé par useChat
    depuis la liaison SQLite — **le modèle n'a aucun contrôle**) ;
  - `connector_github_cancel_turn(turn_id)`: abandonne les appels en vol.

Erreurs publiques : jamais de corps HTTP, en-têtes, jeton ou URL complète.
Domaine `not_configured, auth, forbidden, rate_limit, not_found, too_large,
binary, denied_path, offline, timeout, invalid_arguments, unknown`, avec test
i18n exhaustif (pattern `lib/mcp/errors.i18n.test.ts`).

## 9. Intégration chat

### 9.1 Outils pour le modèle

- `McpAgentTool.kind` s'étend à `"tinyfish_web" | "generic" | "connector"`.
- Les trois outils sont **générés** (pas stockés dans `mcp_tools`) quand :
  liaison valide ET jeton configuré. Construits dans
  `src/lib/connectors/tools.ts`, injectés dans `loadMcpRuntime()`
  (`src/lib/mcp/runtime.ts` — point de branchement vérifié).
- Client composite : `connector_github` → `invoke("connector_github_call_tool")`,
  le reste → client MCP actuel.
- `MAX_TOOL_ROUNDS`/`MAX_MCP_CALLS` (`toolAgent.ts`, valeurs en dur 2/4)
  deviennent paramétrables, **défauts inchangés** (tests MCP intacts) ; avec
  dépôt attaché : **6 tours / 12 appels** (bornes de départ, ajustables).

### 9.2 System prompt

`buildSystemPrompt` reçoit `repoBinding?: { owner, name, ref }` et ajoute :

- « Dépôt GitHub attaché : owner/name@ref » ;
- explorer avec les outils, ne pas deviner les chemins, citer les chemins ;
- contenu du dépôt = donnée externe **non fiable** (même enveloppe
  `externalResult` + section sécurité comme les sources Web) ;
- le contenu n'est jamais persisté (seule la liaison l'est).

### 9.3 Modèle sans outils

Si le modèle rejette `tools` avec un dépôt attaché, le repli unique
(`isToolsUnsupported`) utilise une variante d'avertissement précisant que **le
dépôt est inaccessible** pour cette réponse. Le plafond 64 outils / 256 Kio
n'évince jamais un outil silencieusement : les outils connecteur sont comptés
dans le catalogue actif et, en cas de dépassement, l'erreur est explicite.

## 10. Règles de sécurité (récapitulatif du prompt, toutes actées)

1. Jeton uniquement dans le Credential Manager ; commandes dédiées configure/
   status/delete (pas `get_secret` depuis React).
2. Remplacement transactionnel du jeton (test en mémoire avant stockage).
3. Réseau 100 % Rust : hôte fixe, HTTPS, pas de redirection, timeouts et
   tailles bornés, `User-Agent`, `X-GitHub-Api-Version`.
4. Validations owner/name/ref/path en Rust (section 7.1).
5. `read_file` refuse la liste de fichiers sensibles (section 7.2).
6. Contenu du dépôt = donnée non fiable ; jamais persisté.
7. Le modal avertit que le contenu lu part chez le fournisseur LLM actif.
8. Erreurs publiques sans corps/en-têtes/jeton/URL ; test i18n exhaustif.
9. Interruption du chat ⇒ abandon des appels GitHub en vol.

## 11. Expérience utilisateur

### 11.1 Paramètres généraux › Connecteurs

- Catégorie « Connecteurs » ajoutée à `CATEGORIES` de
  `GeneralSettingsDialog.tsx` (icône lucide `Plug` — existante, vérifiée) ; la
  catégorie garde `HEADER_TOOL_DIALOG_SIZE_CLASS`.
- `ConnectorsPanel` : grille de tuiles carrées (`rounded-lg`), icône + nom
  dessous, badge d'état texte + icône + couleur :
  - Non configuré → neutre (`text-muted-foreground`) ;
  - Connecté (@login) → `text-green-600 dark:text-green-400`.
- Manifeste : `src/lib/connectors/catalog.ts` (`id`, `name`, `backend`,
  `secretRef`), une entrée `github`.
- Icône `GithubConnecteurIcon` : SVG fourni par l'utilisateur dans
  `src/icons/svg/github-connecteur.svg`, adapté au contrat `src/icons/index.tsx`
  (viewBox 24, `fill="currentColor"`, taille via `className`, ids retirés).
  **Le fichier SVG est ajouté par l'utilisateur — à demander s'il manque.**

### 11.2 Modal de configuration GitHub

Sous-modale à taille adaptée (pas le gabarit header) : explication + lien de
création du jeton (`TauriLink` vers github.com/settings/personal-access-tokens/new),
champ mot de passe jamais prérempli, bouton « Tester et enregistrer », état
« Connecté en tant que @login », « Remplacer », « Déconnecter » avec
`dialogConfirm`, avertissement jeton classique, `aria-live` sur les états
asynchrones, focus initial explicite, Échap ferme la sous-modale d'abord.

### 11.3 Barre de saisie

- Icône GitHub entre « fichier texte » et « Web », même gabarit (`h-[38px]`).
- États : indisponible/non configuré (désactivé, infobulle « Configurez GitHub
  dans Paramètres généraux › Connecteurs ») / prêt / attaché (accent
  `--brand-to` + puce « owner/name@ref » avec retrait).
- `GithubRepoPickerDialog` : recherche filtrante, badge « privé », « Charger
  plus », choix de branche (défaut présélectionnée), « Attacher ».
- Jeton supprimé ⇒ puce « indisponible », aucun outil proposé.
- `InputBar` reçoit des props (UI pure, pas de logique métier) ; le câblage
  passe par `App.tsx` (vérifié : `InputBar` n'a pas de `conversationId`).

## 12. Stratégie de tests (TDD, test rouge d'abord)

### TypeScript (WSL, vitest)

- Migration V12 depuis base V11 et base neuve ; cascade FK ; SQL paramétré.
- Repository `conversationConnectors` (get/set/remove) et hook.
- Manifeste, chaînes i18n, test exhaustif `errors.i18n.test.ts` connecteur.
- Modal de configuration : remplacement, statuts, avertissements, accessibilité.
- Picker : recherche, pagination, branches, attachement.
- Outils connecteur : construction des `McpAgentTool`, routage composite,
  limites 6/12, non-régression 2/4 MCP.
- System prompt avec section dépôt ; variante sans outils.
- Gardes-fous : zéro `console.log`, palette de marque (pas d'orange).

### Rust (PowerShell, `cargo test`)

- Faux serveur axum : valide, 401, réseau, timeout, remplacement
  transactionnel, zéro fuite de jeton.
- Validations chemins malveillants (`../`, `%2e%2e`, NUL, très longs).
- Troncatures repo_map/read_file/search ; `truncated` et repli non récursif.
- Redirection non suivie ; annulation par `turn_id` ; débit 403/429.
- Refus des fichiers sensibles et binaires.

### Gates finales (PowerShell)

`npm run build`, `cargo test`, `cargo clippy --all-targets -- -D warnings`.
Non-régression MCP/TinyFish/Web obligatoire.

## 13. Critères d'acceptation

- Jeton invisible hors Credential Manager (SQLite, localStorage, logs, erreurs).
- Accès limité au dépôt attaché malgré injection (owner/repo/ref jamais fournis
  par le modèle).
- Dépôts public et privé fonctionnent.
- Chaque cas d'erreur (jeton révoqué, réseau, débit, fichier gros/binaire/
  sensible) a un message clair et le chat répond quand même.
- Retirer le jeton ou le dépôt ne casse pas la conversation.
- Interruption = appels GitHub abandonnés.
- Tests TS/Rust, Clippy et build Windows verts.
- UI conforme au design system (tuiles, couleurs de marque, modales).

## 14. Références techniques (doc officielle GitHub, vérifiée les 14-15 nov. 2026)

- Débit : primaire 5 000 req/h authentifié ; en-têtes `x-ratelimit-*` ;
  403/429 à respecter avec `x-ratelimit-reset`.
- `GET /user/repos` : compatible fine-grained ; `sort=pushed`, `direction`,
  `per_page` max 100, `visibility`/`affiliation`.
- `GET /search/code` : 10 req/min authentifié ; **branche par défaut
  uniquement** ; fichiers < 384 Ko ; requête ≤ 256 car. ; au moins un terme.
- `GET /repos/{o}/{r}/branches` : `per_page` max 100 (`Short Branch`).
- `GET /repos/{o}/{r}/contents/{path}` : média `application/vnd.github.raw` ;
  1–100 Mo = raw uniquement ; > 100 Mo non supporté ; 1 000 fichiers max par
  dossier.
- `GET /repos/{o}/{r}/git/trees/{sha}?recursive=1` : 100 000 entrées / 7 Mo
  max ; drapeau `truncated` ; repli non récursif recommandé.
- Endpoints compatibles fine-grained (page dédiée) : `/user/repos`,
  `/search/code`, `contents/{path}`, `git/trees/{tree_sha}`, `branches` tous
  listés.
- `lucide-react` : icône `Plug` existe (catégories devices/connectivity).
- Spécifications internes : `DESIGN_SYSTEM.md`,
  `docs/superpowers/specs/2026-11-07-remote-mcp-gallery-design.md` (rigueur et
  enveloppes de référence).

## 15. Corrections au prompt d'origine (vérification code réel)

- `useChat.ts` : les deux sites sont aux lignes **610-624** (envoi) et
  **771-785** (retry/regenerate), pas 594-621/751-782.
- `McpAgentTool.kind` est binaire (`tinyfish_web | generic`) codé dans
  `mcpServers.ts:207` ; l'extension `"connector"` est requise.
- Aucun hook équivalent à `useConversationKnowledge` n'existe : le hook de
  liaison connecteur est un pattern nouveau.
- `registry.ts` des icônes appartient à la lib externe `djodev-icons` ; dans
  LogAssist, le contrat d'icône vit dans `src/icons/index.tsx` (SVG sources
  dans `src/icons/svg/`).
- `AssistantDialog.tsx` utilise `window.confirm` (incohérence existante, hors
  périmètre — ne pas propager).
