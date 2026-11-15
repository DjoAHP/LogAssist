# Updater Tauri — mise à jour automatique de LogAssist

Date : 16 novembre 2026

Branche : `feat/tauri-updater` (depuis `feat/m1-socle-chat`)

Statut : conception validée (approche A approuvée par l'utilisateur)

## 1. Contexte

LogAssist est distribué en installateur Windows (`.msi` + `.exe` NSIS) sans
aucun mécanisme de mise à jour : chaque nouvelle version demande à
l'utilisateur de retourner sur GitHub et de réinstaller manuellement. C'est le
frein principal à l'adoption d'une application desktop.

Tauri v2 fournit le plugin officiel **`tauri-plugin-updater`** : l'application
interroge un endpoint HTTPS (`latest.json`), compare les versions, télécharge
le paquet, **vérifie sa signature cryptographique minisign** contre la clé
publique embarquée, puis installe et relance. Gratuit, standard de
l'écosystème, aucune infrastructure à maintenir.

Le dépôt `DjoAHP/LogAssist` est **public** : les artefacts de Release sont
téléchargeables sans authentification, ce qui colle parfaitement au modèle
updater.

Distances prises dans cette conception :

- **Deux signatures existent, confondues souvent** : (a) la signature
  *updater* minisign (gratuite, intégrée Tauri — garantit que le paquet
  téléchargé n'est pas falsifié, c'est elle qui rend l'auto-update sûr) ;
  (b) la signature *Authenticode* Windows (certificat payant — réduit
  l'avertissement SmartScreen au premier lancement). Seule (a) est au
  périmètre ; (b) est explicitement reportée.
- La CI GitHub Actions existe déjà (`.github/workflows/ci.yml`, PR #5) : le
  workflow de release s'ajoute à côté, il ne la remplace pas.

## 2. Objectifs

- Vérification silencieuse des mises à jour **au démarrage** de l'application
  (avec délai de grâce, pour ne pas gêner le lancement) et **bouton « Vérifier
  les mises à jour »** dans les réglages généraux.
- Si une version plus récente existe : **bannière discrète dans le header**
  « v3.x.y disponible » avec un bouton d'installation en un clic.
- Téléchargement + installation + relance, **avec vérification de signature**
  avant installation (garantie du plugin, la clé publique vit dans
  `tauri.conf.json`).
- Publication **automatique** de la release signée par la CI : un simple
  `git tag v3.4.1 && git push --tags` déclenche build → signature →
  `latest.json` → Release GitHub.
- Aucune chaîne UI en dur : tout passe par `src/i18n/fr.ts`.

## 3. Hors périmètre (assumé)

- **Signature Authenticode / SmartScreen** (décision utilisateur : plus tard).
  L'updater fonctionne sans ; l'utilisateur verra l'avertissement SmartScreen
  standard à la première installation manuelle.
- Builds macOS/Linux : l'application est Windows-only (Credential Manager).
- Canal « beta » / pré-releases : une seule voie stable (`latest.json` de la
  Release non-prerelease la plus récente).
- Rollback vers une version antérieure via l'updater.
- Webhook de notification, télémétrie du check (le check est un simple GET
  anonyme).

## 4. Décisions structurantes

### 4.1 Approche choisie : plugin officiel + GitHub Releases

- Plugin Rust `tauri-plugin-updater` + binding JS `@tauri-apps/plugin-updater`
  (et `@tauri-apps/plugin-process` pour `relaunch()`).
- Endpoint : `https://github.com/DjoAHP/LogAssist/releases/latest/download/latest.json`.
  Ce lien stable pointe toujours vers l'asset `latest.json` de la dernière
  Release ; l'application ne connaît que lui, jamais une URL versionnée.
- Alternatives écartées : vérification « light » ouvrant le navigateur
  (pas d'installation en un clic, pas de garantie d'intégrité) ; serveur
  d'updates auto-hébergé (overkill).

### 4.2 Clés de signature minisign

- Génération : `npm run tauri signer generate -w ~/.tauri/logassist.key`
  (sous WSL, dossier **hors dépôt**), avec mot de passe.
- **Clé publique** : valeur embarquée dans `tauri.conf.json` (`plugins.updater.pubkey`).
  Elle est publique par nature — la committer est correct.
- **Clé privée** : **jamais dans le dépôt**. Deux emplacements :
  - `TAURI_SIGNING_PRIVATE_KEY` / `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` en
    **Secrets GitHub** (content du fichier + mot de passe) pour la CI ;
  - copie locale dans `C:\dev\secrets\` (hors dépôt) avec note de
    sauvegarde.
- ⚠️ **La perdre casse toutes les mises à jour futures** : les installations
  existantes embarquent la pubkey, une nouvelle paire serait refusée par
  l'updater. Rotation de clé = procédure d'urgence documentée dans le README
  technique, pas un réflexe.
- `.gitignore` : ajouter `secrets/` et `*.key` par sécurité.

### 4.3 Cycle de vérification et d'installation

1. Au démarrage : après un **délai de grâce de 15 s** (l'app est prête, le
   check ne retarde pas le lancement), `check()` interroge `latest.json`.
2. `latest.json` porte, par plateforme (`windows-x86_64`), l'URL du paquet,
   sa signature et son `pub_date`. Le plugin compare la version et refuse
   toute signature invalide avant installation.
3. Si mise à jour : état « disponible » → bannière header + toast discret.
4. Clic « Installer » : `downloadAndInstall()` (téléchargement, vérification
   signature, installation) avec progression affichée, puis l'application
   est relancée. **Spécifique Windows : `download_and_install` termine
   l'application après le lancement de l'installateur NSIS/MSI** — la
   relance explicite via `relaunch()` n'est requise que sur macOS/Linux ;
   le hook gère les deux cas sans état « fantôme ».
5. Erreurs (réseau, signature, version) : état « erreur » non bloquant,
   affiché dans la bannière et dans les réglages, sans interruption du chat.

### 4.4 Configuration Tauri

- `tauri.conf.json` :
  - `plugins.updater = { endpoints: [endpoint Releases], pubkey: "..." }` ;
  - `bundle.createUpdaterArtifacts: true` — les paquets NSIS/MSI sont signés
    directement au format v2 (`.sig` à côté de chaque artefact).
- `capabilities/default.json` : ajout de `updater:default` (inclut
  `allow-check`, `allow-download`, `allow-install`,
  `allow-download-and-install`) et `process:allow-restart`.
- `src-tauri/src/lib.rs` : registration
  `app.handle().plugin(tauri_plugin_updater::Builder::new().build())` dans
  le `setup`, sous `#[cfg(desktop)]`.
- `package.json` : dépendance `@tauri-apps/plugin-updater` ;
  `Cargo.toml` : `tauri-plugin-updater = 2` ; `@tauri-apps/plugin-process`
  pour la relance.

### 4.5 Côté React : hook `useUpdater`

Un seul point d'entrée, `src/hooks/useUpdater.ts` :

- États : `idle` / `available` / `downloading` / `readyToInstall` (macOS/Linux)
  / `error` / `upToDate`.
- Deux déclencheurs : check au démarrage (délai de grâce) et check manuel
  (bouton réglages) — le manuel affiche explicitement « À jour » quand
  aucune mise à jour n'existe, contrairement au silencieux.
- `install()` : orchestre download/install et remonte la progression
  (`onEvent` du plugin : contenu téléchargé / total).
- Désactivation automatique en dev (`import.meta.env.DEV`) : pas de check
  pendant `npm run tauri dev`, sinon le plugin lève « updater non configuré ».
- La bannière header et le bouton réglages **consomment le hook** ; la
  bannière est rendue uniquement quand une mise à jour est disponible ou en
  téléchargement, elle ne masque jamais les outils du header.

### 4.6 Workflow de release

`.github/workflows/release.yml`, déclenché sur tag `v*` :

1. Checkout + `npm ci` + cache Cargo.
2. `tauri-apps/tauri-action@v0` avec `tagName`, `releaseName`,
   `releaseBody`, `prerelease: false` — l'action build (Windows runner),
   signe via `TAURI_SIGNING_PRIVATE_KEY` (+ mot de passe), génère
   `latest.json` et publie la Release avec tous les artefacts.
3. La version du tag doit correspondre à la version de l'app :
   `npm run sync:version` garantit l'alignement `package.json` / `Cargo.toml`
   / `tauri.conf.json` avant le tag.
4. Permissions du workflow minimales (`contents: write` pour créer la
   Release).

Publication d'une version = deux commandes :

```bash
git tag v3.4.1 && git push origin v3.4.1
```

## 5. Sécurité

- L'endpoint est HTTPS (GitHub). Le paquet téléchargé est **refusé si la
  signature ne correspond pas** à la clé publique embarquée — un dépôt ou un
  transport compromis ne permet pas d'installer du code falsifié.
- La clé privée ne vit nulle part dans le dépôt ; le workflow ne l'expose
  que comme variable d'environnement au moment de la signature.
- CSP : aucune modification nécessaire — le check passe par le plugin Rust,
  pas par la webview (aucun `connect-src` additionnel). C'est cohérent avec
  la direction générale du projet (réseau hors webview, invariant n°9).
- Aucun secret ni donnée utilisateur ne transite dans la requête de check
  (simple GET, sans en-tête d'identification).
- Ne jamais persister ni logger le contenu de `latest.json` (données
  externes non fiables — la version affichée est celle renvoyée par le
  plugin après sa propre validation).

## 6. Tests

- **Hook** `useUpdater.test.ts` (vitest, plugin mocké) :
  - démarrage : pas de MAJ → reste `idle` sans message ;
  - démarrage : MAJ disponible → état `available` avec version ;
  - check manuel sans MAJ → état « À jour » affiché ;
  - erreur réseau → état `error`, bannière non fatale ;
  - `install()` → progression remontée, puis fin d'installation ;
  - désactivé en dev → aucun appel au plugin.
- **Bannière + bouton réglages** : tests composants suivant le pattern
  existant (`@vitest-environment jsdom`), i18n vérifiée.
- **Rust** : la registration du plugin est couverte par la compilation et la
  gate `cargo test` ; le comportement réseau/signature est celui du plugin
  officiel (non re-testé — pas notre surface).
- **Gates** : gate TS complète (tsc + vitest + vite), `cargo test --lib`
  (ou complet si l'app est fermée), `cargo clippy -- -D warnings`.
- **Validation end-to-end** (après merge, avec l'utilisateur) : générer les
  clés, configurer les Secrets GitHub, taguer une version de test
  (ex. `v3.4.1`), vérifier que la Release est publiée avec `latest.json` +
  `.sig`, puis vérifier que l'installée propose la mise à jour et s'installe.

## 7. Risques et points de vigilance

- **Clé privée perdue** ⇒ mises à jour mortes pour les installs existants.
  Mitigation : copie locale + secrets GitHub + note de sauvegarde.
- **Version désalignée** (tag `v3.4.1` mais app `3.4.0`) : la release serait
  publiée avec le mauvais numéro. Mitigation : `npm run sync:version` passé
  en `beforeBuildCommand` (déjà le cas) + vérification du tag dans le
  workflow avant la publication.
- **App en cours d'exécution pendant la gate locale** : `cargo test` complet
  échoue à lier `logassist.exe` (os error 5) — utiliser `cargo test --lib`.
- La première publication taguerait `v3.4.1` alors qu'aucune installation
  n'a encore l'updater : la bannière n'apparaît qu'à partir de la version
  **suivante** (la première version dotée de l'updater doit être installée
  manuellement une fois — c'est le coût d'amorçage de tout updater).

## 8. Plan d'implémentation (ordre)

1. Config Tauri : `plugins.updater` (pubkey placeholder à remplacer),
   `createUpdaterArtifacts`, capabilities, `lib.rs`, dépendances JS + Rust.
2. Hook `useUpdater` en TDD + tests i18n.
3. Bannière header + bouton « Vérifier les mises à jour » (réglages
   généraux), tests composants.
4. Workflow `release.yml` + `.gitignore` secrets.
5. Gates complètes, PR vers `feat/m1-socle-chat`, merge `--no-ff`.
6. Hors code : génération des clés, secrets GitHub, tag de validation avec
   l'utilisateur.
