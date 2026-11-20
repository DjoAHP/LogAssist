# LogAssist Portable — édition USB

Deux éditions partagent le même code source. L'édition bureau n'est **pas**
modifiée : le drapeau d'édition est figé à la compilation, donc le binaire
`LogAssist.exe` se comporte exactement comme avant.

| | Bureau | Portable |
|---|---|---|
| Build | `npm run tauri build` | `npm run tauri build -- --features portable --config src-tauri/tauri.portable.conf.json` |
| Sortie | installeurs MSI/NSIS | `src-tauri/target/release/LogAssistPortable.exe` |
| Identifiant | `fr.djodev.logassist` | `fr.djodev.logassist.portable` |
| Données | `%APPDATA%\fr.djodev.logassist` | `<dossier de l'exe>\app-data` |
| Secrets | Credential Manager, service `LogAssist` | Credential Manager, service `LogAssistPortable` (coffre chiffré au lot B) |
| Mises à jour | actives | désactivées (bannière et panneau absents, aucun appel réseau) |
| Modèles locaux | onglet présent | onglet masqué (fournisseurs API uniquement) |
| Galerie MCP | présent | remplacée par « Recherche Web » (TinyFish seul) |

## Comment ça fonctionne

- `VITE_EDITION=portable` (fichier `.env.portable`, chargé par `--mode portable`)
  alimente `src/lib/edition.ts`. Un seul booléen décide de l'UI : composants
  bureau intacts, panneau `TinyfishDialog` à la place de `McpDialog`.
- `appDirectoriesOverride: "./app-data"` est le mécanisme Tauri 2 prévu pour les
  applications portables : `app_config_dir`, `app_data_dir` et
  `app_local_data_dir` pointent dans `<dossier de l'exe>\app-data`, donc la base
  SQLite (`tauri-plugin-sql` résout `sqlite:logassist.db` via `app_config_dir`)
  et les données WebView2 suivent la clé USB.
- `bundle.active: false` : aucun installeur n'est produit, donc l'installation
  existante ne peut pas être écrasée par erreur.
- `mainBinaryName: "LogAssistPortable"` : le binaire portable porte un nom
  distinct du `logassist.exe` du bureau (pas de collision dans `target\release`).
- La feature Cargo `portable` change le service du Credential Manager, jamais le
  service `LogAssist` de l'installation bureau.

## Vérification après build

1. Copier `LogAssistPortable.exe` sur la clé USB (exFAT) et le lancer.
2. Constater la création de `app-data\logassist.db` à côté de l'exécutable.
3. Vérifier que `%APPDATA%\fr.djodev.logassist\logassist.db` n'a pas été modifié
   (comparer la date, ou l'empreinte SHA-256).
4. Lancer LogAssist (bureau) : conversations, fournisseurs et clés intactes.
5. `cmdkey /list | findstr LogAssist` : deux entrées distinctes (`LogAssist` et
   `LogAssistPortable`).
6. Dans la portable : bouton « Recherche Web » (pas « MCP »), aucun onglet
   « Modèles local », aucune catégorie « Mises à jour ».

## Limites connues du lot A

- **Clés API** : stockées dans le Credential Manager du PC hôte, sous un service
  séparé. Rien n'est écrit sur la clé USB : sur une nouvelle machine, il faut
  ressaisir les clés. Le coffre chiffré sur la clé est le lot B.
- **WebView2** : le runtime système est requis. L'embarquement du runtime fixe
  (~180 Mo) est le lot C.
- **SQLite sur USB** : réglages de robustesse (mode journal, `synchronous`)
  prévus au lot C.
- **Titre de fenêtre** : il reste « LogAssist vX.Y.Z » (défini dans la config
  commune). Cosmétique ; à traiter au lot C si nécessaire.
- **`dist/`** : `build:portable` reconstruit le dossier `dist/` avec le drapeau
  portable. Rebuilder le bureau (`npm run build`) avant tout build bureau.
- `app-data` doit être dans un dossier inscriptible : clé USB ou
  `target\release`, jamais `Program Files`.
