# LogAssist — Design d'application de bureau (V1)

**Date :** 2026-10-27 · **Statut :** validé en session de conception · **Version du design :** 1.0

---

## 1. Résumé du projet

LogAssist est une application de bureau **Windows**, **100 % locale**, dans laquelle l'utilisateur discute par écrit avec plusieurs modèles d'IA prévus par différents fournisseurs, leur envoie des **captures d'écran** de ses logiciels (HISE, DaVinci Resolve, Fusion 360, Illustrator, autres), et reçoit des conseils guidés **pas à pas** avec des instructions précises (noms exacts des menus, boutons, propriétés).

Le produit se distingue d'un simple chat IA par :

1. **Le contexte pédagogique** — instructions précises basées sur l'interface réelle (captures d'écran).
2. **La continuité par projet** — une conversation rattachée à un projet hérite d'un contexte durable (logiciel, objectif, préférences).
3. **Le multi-fournisseurs sans friction** — changer de modèle au milieu d'une conversation, erreurs diagnostiquées proprement, support images vérifié par modèle.
4. **La confidentialité** — pas de compte, pas de serveur ; tout repose en local, seules les requêtes volontaires partent vers les APIs des fournisseurs choisis.

## 2. Périmètre V1 (décisions validées)

| Inclus en V1 | Reporté (V1.1 / V2 / V3) |
|---|---|
| Chat multi-fournisseurs (OpenAI-compatible + Gemini) | Profils personnalisés (création/suppression de profils à la demande) → V1.1 |
| Images : collage Ctrl+V, import fichier, prévisualisation, multiple | Stats détaillées (tokens, coût) → V1.1 |
| Instructions générales + 5 profils intégrés éditables | Export conversation Markdown → V1.1 |
| Projets (fiche simple + contexte injecté) | Recherche plein-texte → V1.1 |
| Conversations : création, renommer, archiver, supprimer, recherche | Étapes confirmées + registre solutions → V2 |
| Stockage local SQLite + Credential Manager pour les clés | Capture fenêtre active / zone → V3 |
| Markdown, copie, régénérer, interrompre, modèle affiché | RAG documentation, comparaison modèles, Ollama local → V3 |
| Sélecteur fournisseur/modèle dans le chat + défaut global | |

Décision notables : **pas de résumé automatique de conversation en V1** — si l'historique dépasse la limite du modèle, l'erreur est affichée clairement et l'utilisateur choisit (raccourcir, résumer manuellement). Pas de contrôle automatisé de souris/clavier : l'utilisateur reste maître des manipulations. Communication par écrit ; voix non prioritaire.

## 3. Architecture technique

### 3.1 Choix de framework : Tauri 2 (validé)

Options comparées :

- **Tauri 2 (retenu)** — Frontend React/TS/Vite/Tailwind/shadcn/ui/Lucide ; coquille native Rust minimale avec plugins officiels. Léger (exécutable ~10-15 Mo, RAM 80-150 Mo), WebView2 natif Windows, clés API sécurisées via le crate `keyring` (Windows Credential Manager / DPAPI). Compromis : un peu de Rust si une fonction native sur-mesure est nécessaire — quasi aucun en V1 (les appels API et l'UI sont en TypeScript).
- **Electron (écarté)** — Tout en Node/TS, `safeStorage` correct, mais exécutable 150-250 Mo et RAM 200-400 Mo. Inutilement lourd pour ce besoin.
- **Web app locale (écarté)** — Pas de vraie coquille de bureau, gestion de clés moins propre, expérience moins intégrée.

### 3.2 Couches

```
┌─────────────────────────────────────────────────────┐
│  FRONTEND (React + TypeScript + Vite + Tailwind)    │
│  UI chat / sidebar / paramètres / projets           │
│  Adaptateurs API (fetch + SSE, src/lib/ai/)         │
├─────────────────────────────────────────────────────┤
│  PONT TAURI (commands IPC)                          │
│  get_secret / set_secret / delete_secret            │
│  Dialogue fichier/repertoire (export/import)        │
├─────────────────────────────────────────────────────┤
│  NATIF (Rust — plugins uniquement)                  │
│  SQLite (tauri-plugin-sql) · Keyring (Credential    │
│  Manager) · dialog/fs · clipboard                   │
└─────────────────────────────────────────────────────┘
```

Règles :

1. **La logique métier et les adaptateurs restent en TypeScript** (dossier `src/lib/ai/`, testables sans fenêtre). Le streaming des réponses (SSE) se fait en `fetch` + `ReadableStream`.
2. **Les clés API ne sont jamais stockées en clair** : créées dans SQLite seulement comme référence ; la clé vit dans le Credential Manager Windows. Le frontend demande `get_secret(provider_id)` au bridge au moment de l'appel. Jamais loguée, jamais en clair dans un fichier.
3. **Un seul stockage SQLite** (`logassist.db`) ; images en fichiers disque référencés.

## 4. Organisation des écrans (validée)

### 4.1 Écran principal — Chat (une fenêtre, 3 panneaux)

- **Sidebar gauche** (repliable) : bouton « Nouvelle conversation », recherche, historique groupé par projet (« générales » si aucun), menu contextuel : renommer / déplacer vers projet / archiver / supprimer.
- **Zone centrale** : messages Markdown (blocs de code stylés, images en vignettes cliquables), boutons au survol d'une réponse IA : copier / régénérer ; bouton Stop dans l'input pendant la génération ; badge discret sous chaque réponse : fournisseur › modèle + temps de réponse.
- **Barre d'input** : textarea auto-extensible ; Entrée = envoyer, Shift+Entrée = nouvelle ligne ; bouton d'ajout de fichier image ; **Ctrl+V colle une image depuis le presse-papiers** avec vignettes de prévisualisation (retirable) avant envoi ; sélecteur `Fournisseur › Modèle` au-dessus de l'input, avec mention visible quand le modèle ne supporte pas les images.

### 4.2 Paramètres (onglets latéraux)

- **Fournisseurs** : liste CRUD ; formulaire : nom personnalisé, famille d'API (`openai-compatible` / `gemini`), URL de base, clé API, modèles, modèle par défaut ; bouton « Tester la connexion » avec diagnostic lisible.
- **Instructions** : zone « instructions générales » ; 5 profils intégrés (Apprentissage, Pas-à-pas, Expert, Débogage, Création) éditables, profil actif par conversation.
- **Apparence & données** : taille de police ; export/import des données (base complète ZIP, conversation seule en Markdown) ; nettoyage des images orphelines.

### 4.3 Page Projet

Nom, logiciel concerné, version, objectif, **contexte libre (injecté)**, conversations rattachées. Le schéma prévoit l'évolution vers « étapes confirmées » en V2 sans migration douloureuse.

## 5. Modèle de données

SQLite `%APPDATA%/LogAssist/logassist.db`, **numéro de version de schéma en base dès la V1**.

```
providers     id, name, api_family ('openai'|'gemini'), base_url, created_at
models        id, provider_id, model_id, supports_images (bool, éditable), is_default
conversations id, project_id (null = générale), title, archived, created_at, updated_at
messages      id, conversation_id, role, content, attachments (json),
              model_label, latency_ms, error (json|null)
images        id, filename, created_at
projects      id, name, software, software_version, goal, context_md, created_at
profiles      id, name, instructions_md, is_builtin
settings      key, value (instructions générales, profil actif, modèle défaut global, apparence)
```

- **Images** : `%APPDATA%/LogAssist/images/<id>.png`, référencées par chemin (pas de doublon en base).
- **Entrée des clés** : champ dans les paramètres → écrit dans Credential Manager ; la base ne contient que l'identifiant.
- **Confidentialité** : tout est local sauf les requêtes volontaires vers les fournisseurs (texte + images attachées). Aucune donnée de conversation n'est collectée ou transmise ailleurs par LogAssist.

**Backup/export** : archive `.zip` (`logassist.db` + `images/`) ; export conversation seule en Markdown avec références images ; import inverse pour restaurer.

## 6. Adaptateurs fournisseurs

```typescript
interface IAProvider {
  complete(req: ChatRequest, signal: AbortSignal): Promise<ChatResponse>
  stream(req: ChatRequest, cb: StreamCallbacks, signal: AbortSignal): Promise<void>
  listModels(): Promise<ModelInfo[]>
  testConnection(): Promise<ConnectionTest>
}
```

- **`OpenAICompatibleProvider`** — URL + clé configurables ; couvre OpenRouter, NVIDIA, Ollama Cloud, et (à vérifier à l'implémentation) OpenCode Zen et Grok, quasi sûrement compatibles. Images : `content: [{type: "image_url"}]` ; streaming SSE standard.
- **`GeminiProvider`** — API Google dédiée (`generateContent`), images en `inline_data` (base64), SSE spécifique. Même interface.
- Tout fournisseur hors norme prendra un 3ᵉ adaptateur sans rien casser (c'est le point de l'interface unique).

**Taxonomie d'erreurs normalisée** (l'UI n'affiche jamais une erreur brute ; détail repliable pour le debug) :

| Condition | Diagnostic utilisateur |
|---|---|
| 401 / 403 | Clé API invalide ou expirée |
| 404 (modèle) | Modèle inexistant chez ce fournisseur |
| ECONNREFUSED / timeout | Fournisseur injoignable (URL ou réseau) |
| 429 (+ `retry-after`) | Limite de débit — réessayez dans X s |
| 429/402 quota | Quota ou crédit épuisé |
| 5xx / 503 | Service momentanément indisponible |
| 400 image | Images non supportées par ce modèle |
| Autre / JSON invalide | Structure brute + proposition de signaler |

**Support images** : champ `supports_images` par modèle — valeur heuristique proposée automatiquement pour les familles connues, **éditable manuellement** (les listes de modèles des fournisseurs ne sont pas fiables sur ce point). Avertissement non bloquant avant l'envoi d'image à un modèle sans support.

## 7. Composition des prompts

Un prompt système unique assemblé à l'envoi, dans cet ordre :

1. **Instructions générales** (paramètres, préremplues avec le texte pédagogique type de l'utilisateur).
2. **Instructions du profil** actif (5 intégrés, éditables).
3. **Contexte du projet** (fiche : logiciel, version, objectif, contexte libre) — si la conversation est rattachée.
4. Historique de la conversation + message courant (avec images).

- Le profil est associé à la conversation et reste modifiable en cours de session.
- Pas de résumé automatique en V1 : dépassement de limite = erreur claire + choix utilisateur.

## 8. Évolutions (priorisation validée)

- **V1.1** : export Markdown par conversation · recherche plein-texte (SQLite FTS5) · profils personnalisés · stats légères (temps de première réponse vs complétion, tokens si disponible, mesure honnête jamais présentée comme exacte).
- **V2** : étapes confirmées (proposée ≠ effectuée) · registre des solutions par projet · bibliothèque de prompts.
- **V3+** : import/RAG documentation locale · comparaison de modèles côte à côte · mode Ollama local (hors-ligne) · captures natives (fenêtre active, zone, raccourci global) · résumé automatique · évaluation de la qualité des réponses.

## 9. Risques techniques et parades

| Risque | Parade |
|---|---|
| OpenCode Zen / Ollama Cloud hors norme OpenAI | Vérification à l'implémentation ; interface unique permet un adaptateur dédié sans refactor |
| Listes de modèles incompatibles entre familles | Champ `supports_images` éditable manuellement |
| Dépassement de contexte (longues conversations) | Pas de magie : erreur explicite + raccourcir/résumer manuellement (V2 : résumé) |
| Perte de clés Credential Manager si profil Windows réinstallé | Bouton « sauvegarder mes fournisseurs sans clés » (config exportable JSON) + rappel de re-saisie |
| Qualité variable des APIs chez fournisseurs OpenAI-like | Table de mapping d'erreurs centralisée + test de connexion dès les paramètres |

## 10. Prochaines étapes

1. Plan d'implémentation progressif (via la compétence *writing-plans*).
2. Scaffolding Tauri 2 + React + Tailwind + shadcn/ui.
3. Développement de la V1 par étapes testables.

## 11. Stratégie de vérification

- **Unitaires (Vitest)** : adaptateurs IA (mocks d'API OpenAI/Gemini : succès, chaque type d'erreur du tableau §6, streaming interrompu par AbortSignal), composition des prompts, conversion Markdown.
- **Composants (Vitest + Testing Library)** : barre d'input (collage image, prévisualisation, retire-pièce-jointe, Entrée/Shift+Entrée), sélecteur de modèle avec avertissement images.
- **Manuel ciblé** : collage réel du presse-papiers Windows, Credential Manager (clé créée/lue/absente), test de connexion avec une mauvaise clé et une mauvaise URL, export/import ZIP.
