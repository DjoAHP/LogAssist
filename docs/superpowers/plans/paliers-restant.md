# LogAssist — Paliers restants

**Dernière mise à jour :** 2026-11-06
**Document maître de reprise :** oui
**Branche de travail actuelle :** `feat/chat-engine-palier-1`
**HEAD au moment de cette mise à jour :** `b602e22384fdfca5dafa5aa1bbe178fbba9cea45`

## 1. Rôle de ce document

Ce fichier sert à :

1. connaître l’état réel de la modernisation du chat LogAssist ;
2. choisir le prochain palier sans relire les anciennes conversations ;
3. donner à une nouvelle session IA suffisamment de contexte pour travailler proprement ;
4. empêcher qu’un palier déjà livré soit redécouvert ou réimplémenté ;
5. conserver les critères d’acceptation et les dépendances entre paliers.

Ce document doit être mis à jour après chaque palier terminé.

## 2. Instructions obligatoires pour une nouvelle session IA

Avant toute modification :

1. lire `/mnt/c/dev/LogAssist/AGENTS.md` ou sa copie dans le worktree actif ;
2. lire ce fichier en entier ;
3. lire la conception directrice :
   `docs/superpowers/specs/2026-11-05-chat-engine-modernization-design.md` ;
4. lire uniquement le plan détaillé du palier choisi, s’il existe ;
5. exécuter `git status --short --branch` et `git log -10 --oneline` ;
6. vérifier le comportement existant avant d’écrire du code ;
7. appliquer le TDD : test rouge, implémentation minimale, test vert ;
8. ne jamais lancer `npm install` depuis WSL ;
9. ne jamais fusionner, supprimer le worktree ou changer de branche sans autorisation ;
10. mettre à jour ce document à la fin de la session.

Une session doit traiter **un seul palier ou sous-palier**.

## 3. État actuel

### Validation

- [x] Tests automatisés du palier 2B : **496 tests passants** avec un pool de quatre workers.
- [x] TypeScript valide.
- [x] Bundle Vite Windows valide.
- [x] Tests manuels Tauri du palier 2B validés par l’utilisateur.
- [x] Branche et worktree conservés pour la suite.
- [ ] Branche non fusionnée dans `feat/chat-engine-modernization`.

### Commandes de vérification fiables

Depuis PowerShell Windows :

```powershell
Set-Location "C:\dev\LogAssist\.worktrees\chat-engine-palier-1"
npx vitest run --maxWorkers=4
npx tsc --noEmit
npx vite build
```

Le lancement avec trop de workers peut produire des timeouts de démarrage. Un seul worker n’est pas fiable avec `isolate: false`, car certains mocks de fichiers historiques se contaminent. Le réglage actuel vérifié est `--maxWorkers=4`.

### Avertissements préexistants non bloquants

- imports `shared/buildVersion` sans extension avec le futur loader natif Vite ;
- bundle JavaScript supérieur à 500 kB ;
- bruit `Tauri invoke` dans certains tests `AssistantDialog` hors runtime Tauri ;
- log volontaire de l’erreur presse-papiers simulée dans `ChatView.test.tsx`.

## 4. Paliers terminés

### Palier 0 — Isolation et référence ✅

- branche dédiée ;
- worktree local ignoré par Git ;
- baseline de tests ;
- builds WSL et Windows.

### Palier 1 — Fondations du moteur ✅

- `TurnRunner` direct/Web ;
- constructeur pur de contexte ;
- verrou synchrone anti-double envoi ;
- métriques par réponse ;
- coûts exacts ou absents ;
- redaction des secrets ;
- migrations SQLite jusqu’en V8 ;
- erreurs de persistance dédiées ;
- robustesse Abort/MCP/persistance.

Plan livré : `docs/superpowers/plans/2026-11-05-chat-engine-palier-1.md`.

### Palier 2A — Lecture et interface visible ✅

- présentation hybride ;
- fond translucide des réponses ;
- largeur centrale à `90rem` ;
- filet cyan assistant ;
- auto-scroll respectueux ;
- bouton « Nouvelle réponse » ;
- gestion des reflows, images tardives et scroll programmatique ;
- focus et reduced-motion.

Plan livré : `docs/superpowers/plans/2026-11-06-chat-ui-palier-2a.md`.

### Palier 2B — Retenter et Régénérer ✅

- Retenter la dernière erreur fournisseur ;
- Régénérer la dernière réponse réussie ;
- aucun doublon du message utilisateur ;
- même ligne assistant mise à jour après succès ;
- ancienne réponse conservée sur échec ou interruption ;
- Web, sources et métriques remplacés après succès ;
- actions visibles uniquement sur la dernière cible admissible.

Plan livré : `docs/superpowers/plans/2026-11-06-chat-retry-regenerate-palier-2b.md`.

## 5. Vue d’ensemble des paliers restants

L’ordre ci-dessous tient compte des dépendances, de l’importance produit et du risque technique.

| Ordre | Identifiant | Palier | Importance | Complexité | Visibilité |
|---:|---|---|---|---|---|
| 1 | 2C | Continuer une réponse interrompue | Haute | Moyenne | Forte |
| 2 | 2D | Composeur et pièces jointes | Haute | Moyenne | Très forte |
| 3 | 2E | Sources et longues réponses | Moyenne | Faible à moyenne | Forte |
| 4 | 3A | Registre des capacités modèle | Très haute | Grande | Faible |
| 5 | 3B | Budget et fenêtre glissante | Critique | Grande | Moyenne |
| 6 | 3C | Résumé et mémoire de conversation | Critique | Très grande | Forte |
| 7 | 3D | Jauge et inspecteur de contexte | Haute | Moyenne | Très forte |
| 8 | 4 | Consolidation finale | Très haute | Grande | Faible |
| 9 | S1 | Sécurité réseau LLM côté Rust | Très haute | Très grande | Faible |

## 6. Règle de choix

- Pour une amélioration visible rapide : choisir **2C**, **2D** ou **2E**.
- Pour améliorer les longues conversations : commencer obligatoirement par **3A**, puis **3B**, **3C**, **3D**.
- Pour préparer une fusion/release stable : choisir **4** après les paliers fonctionnels voulus.
- Le chantier **S1** reste séparé du moteur de contexte.

## 7. Palier 2C — Continuer une réponse interrompue

**Importance :** haute
**Complexité :** moyenne
**Prérequis :** palier 2B terminé

### Objectif

Ajouter une action **Continuer** sur la dernière réponse interrompue afin de compléter la même réponse sans répéter le texte déjà reçu.

### Fonctionnement attendu

- visible uniquement sur la dernière réponse `interrupted` persistée ;
- conserver le contenu partiel pendant la continuation ;
- injecter le contenu partiel dans le contexte ;
- ajouter une instruction interne temporaire demandant de poursuivre sans répétition ;
- mettre à jour la même ligne assistant après succès ;
- conserver le contenu partiel si la continuation échoue ;
- utiliser le verrou, Stop, MCP et le modèle actif existants ;
- ne créer aucun message utilisateur en base.

### Critères d’acceptation

- aucune répétition importante du début de réponse ;
- aucune perte du contenu partiel ;
- aucune duplication du message utilisateur ;
- interruption d’une continuation sans perte ;
- comportement direct et Web testé ;
- bouton uniquement sur la dernière réponse admissible.

### Risques

- répétition par le modèle ;
- continuation incohérente si le modèle actif a changé ;
- contexte trop long ;
- confusion entre continuation et régénération.

## 8. Palier 2D — Composeur et pièces jointes

**Importance :** haute
**Complexité :** moyenne
**Prérequis :** aucun au-delà des paliers déjà terminés

### Objectif

Moderniser la barre de saisie sans changer son emplacement ni le comportement éphémère des captures.

### Fonctionnalités

- menu compact **Joindre** regroupant image et fichier texte ;
- glisser-déposer d’images et de fichiers `.md/.txt` ;
- conservation de `Ctrl+V` pour les captures ;
- aperçus temporaires retirable ;
- message clair si le modèle ne supporte pas les images ;
- états de taille/type refusé visibles au lieu d’un échec silencieux ;
- bouton Web inchangé ;
- Entrée et Maj+Entrée inchangés.

### Invariants

- aucune image binaire persistée ;
- aucun fichier original supprimé ou modifié ;
- après redémarrage, seules les métadonnées historiques restent ;
- contrat anti-perte de `InputBar` conservé.

### Critères d’acceptation

- collage, sélection et drag-and-drop testés ;
- erreurs de type/taille traduites ;
- clavier et lecteur d’écran testés ;
- thème clair/sombre validé ;
- aucun changement du moteur LLM.

## 9. Palier 2E — Sources et longues réponses

**Importance :** moyenne
**Complexité :** faible à moyenne
**Prérequis :** palier 2A terminé

### Objectif

Améliorer la lecture des réponses longues sans introduire une nouvelle bibliothèque de rendu.

### Fonctionnalités possibles

- zone Sources repliable au-delà d’un seuil ;
- compteur de sources toujours visible ;
- bouton afficher/masquer accessible ;
- navigation facultative entre les grands titres Markdown ;
- meilleure gestion des métadonnées longues ;
- profilage avant toute virtualisation ;
- virtualisation uniquement si une mesure prouve le besoin.

### Critères d’acceptation

- sources sûres et filtrées inchangées ;
- navigation clavier ;
- aucune exécution de HTML brut ;
- streaming Markdown inchangé ;
- aucun saut de scroll ajouté.

## 10. Palier 3A — Registre des capacités modèle

**Importance :** très haute
**Complexité :** grande
**Prérequis :** fondations du palier 1

### Objectif

Décrire explicitement les capacités de chaque modèle afin que les futurs calculs de contexte ne reposent pas sur des suppositions.

### Données prévues

- fenêtre de contexte ;
- sortie maximale ;
- support image ;
- support outils ;
- disponibilité de l’usage fournisseur ;
- tarifs optionnels ;
- provenance de la capacité : connue, détectée, configurée ou inconnue.

### Travail attendu

- migration additive ;
- champs avancés dans les réglages modèle ;
- valeur conservatrice pour une fenêtre inconnue ;
- tri-état pour outils et statistiques ;
- capacités spécifiques non bloquantes ;
- compatibilité OpenAI-compatible et modèles locaux.

### Critères d’acceptation

- modèle inconnu reste utilisable en texte ;
- valeurs manuelles prioritaires ;
- absence de capacité se dégrade proprement ;
- aucune fausse capacité présentée comme certaine ;
- migration depuis V8 testée.

## 11. Palier 3B — Budget et fenêtre glissante

**Importance :** critique
**Complexité :** grande
**Prérequis :** 3A

### Objectif

Empêcher les longues conversations de dépasser la fenêtre du modèle ou d’envoyer inutilement tout l’historique.

### Ordre de priorité du contexte

1. instructions générales et profil ;
2. garde-fous Web ;
3. connaissances activées ;
4. mémoire synthétique ;
5. tours récents ;
6. message courant, jamais tronqué silencieusement.

### Fonctionnalités

- réserve de sortie ;
- marge de sécurité de tokenisation ;
- fenêtre récente déterministe ;
- erreur `context_length` claire ;
- aucune suppression de l’historique SQLite ;
- repli si le modèle ne fournit pas sa fenêtre.

### Critères d’acceptation

- question courante toujours conservée ;
- tours récents prioritaires ;
- historique source intact ;
- tests avec petites et grandes fenêtres ;
- coûts et latences comparés avant/après.

## 12. Palier 3C — Résumé et mémoire de conversation

**Importance :** critique
**Complexité :** très grande
**Prérequis :** 3A et 3B

### Objectif

Maintenir la continuité pédagogique quand les anciens tours sortent de la fenêtre récente.

### Contenu de la mémoire

- logiciel et version ;
- objectif ;
- état réellement observé ;
- étapes déclarées terminées ;
- décisions et valeurs importantes ;
- erreurs et solutions déjà essayées ;
- blocage courant ;
- références nécessaires à la suite.

### Règles

- résumé par conversation uniquement ;
- aucune mémoire globale cachée ;
- distinction stricte entre étape proposée et effectuée ;
- mise à jour incrémentale par lots bornés ;
- ancien résumé conservé si la mise à jour échoue ;
- repli vers les tours récents ;
- historique original jamais supprimé.

### Critères d’acceptation

- mémoire stable sur une longue procédure ;
- aucune étape inventée comme terminée ;
- échec du résumé non bloquant ;
- coût occasionnel mesuré ;
- possibilité de réinitialiser la mémoire sans perdre les messages.

## 13. Palier 3D — Jauge et inspecteur de contexte

**Importance :** haute
**Complexité :** moyenne
**Prérequis :** 3A, 3B et idéalement 3C

### Objectif

Rendre le contexte visible et contrôlable par l’utilisateur.

### Informations affichées

- fenêtre configurée ;
- occupation estimée ;
- poids des instructions ;
- poids des connaissances ;
- poids de la mémoire ;
- poids des messages récents ;
- date du dernier résumé ;
- provenance exacte ou estimée des mesures.

### Actions

- ouvrir l’inspecteur ;
- réinitialiser uniquement le résumé ;
- modifier la fenêtre d’un modèle inconnu ;
- comprendre pourquoi un ancien message n’est plus envoyé au modèle.

### Critères d’acceptation

- jauge discrète et cohérente avec LogAssist ;
- aucune donnée sensible exposée ;
- valeurs estimées clairement signalées ;
- accessibilité clavier et thème clair/sombre.

## 14. Palier 4 — Consolidation finale

**Importance :** très haute
**Complexité :** grande
**Prérequis :** tous les paliers fonctionnels choisis

### Objectif

Transformer la branche de chantier en version prête à intégrer et distribuer.

### Travaux

- matrice de fournisseurs distants et locaux ;
- OpenAI officiel, OpenRouter, NVIDIA NIM, LM Studio et Ollama ;
- conversations très longues ;
- profilage du rendu et du bundle ;
- optimisation uniquement après mesure ;
- migration réelle depuis plusieurs versions de DB ;
- audit de sécurité ciblé ;
- tests TypeScript complets ;
- `cargo test` et Clippy ;
- build Windows ;
- validation Tauri manuelle ;
- documentation et notes de version ;
- revue finale avant fusion.

### Critères d’acceptation

- aucun test rouge ;
- aucun secret dans logs ou SQLite ;
- migration testée sur copie réelle ;
- fonctions directes, Web et locales validées ;
- comportement image éphémère confirmé ;
- branche fusionnable sans correction connue critique ou importante.

## 15. Chantier S1 — Sécurité réseau LLM côté Rust

**Importance :** très haute
**Complexité :** très grande
**Statut :** chantier séparé, non requis pour commencer le palier 3

### Objectif

Réduire la surface réseau et les secrets accessibles à la WebView.

### Travaux potentiels

- déplacer les appels LLM dans le backend Rust ;
- récupérer les clés uniquement côté Rust ;
- allowlist ou politique stricte des URLs fournisseurs ;
- restreindre `connect-src` en production ;
- valider le format générique `secret_ref` ;
- erreurs et logs redacted côté Rust ;
- conserver les adaptateurs TypeScript derrière un contrat IPC ou les porter progressivement.

### Risques

- chantier transversal ;
- compatibilité des fournisseurs configurables ;
- streaming SSE à transporter via événements Tauri ;
- annulation et performances ;
- migrations d’architecture sans gain visuel immédiat.

## 16. Hors périmètre actuel

Ne pas implémenter sans nouvelle décision produit :

- édition d’un ancien message ;
- branches de conversation ;
- comparaison de variantes ;
- mémoire globale entre toutes les conversations ;
- stockage durable des captures ;
- suppression des fichiers originaux utilisateur ;
- contrôle souris/clavier ;
- agent desktop autonome ;
- exécution libre de commandes locales.

## 17. Modèle de démarrage d’une nouvelle session

Copier ce message dans une nouvelle session en remplaçant `<PALIER>` :

```text
Travaille sur le projet LogAssist.

Lis d’abord :
1. AGENTS.md du dépôt ;
2. docs/superpowers/plans/paliers-restant.md ;
3. docs/superpowers/specs/2026-11-05-chat-engine-modernization-design.md.

Je veux travailler uniquement sur le palier <PALIER>.

Avant de coder :
- vérifie la branche et le worktree ;
- confirme les prérequis et l’état actuel ;
- propose un plan borné pour ce palier seulement ;
- n’implémente aucun autre palier ;
- utilise le TDD ;
- ne lance jamais npm install depuis WSL ;
- conserve les invariants sécurité, SQL, images éphémères et anti-perte.

À la fin :
- exécute les tests et builds requis ;
- fais la validation manuelle nécessaire ;
- mets à jour paliers-restant.md avec le statut, le commit et les tests.
```

## 18. Procédure de mise à jour de ce document

Après chaque session/palier :

1. cocher le palier terminé ;
2. déplacer son résumé dans **Paliers terminés** ;
3. enregistrer la branche et le commit final ;
4. enregistrer le nombre de tests et les builds exécutés ;
5. noter les tests manuels validés ou restants ;
6. noter toute dette découverte sans l’implémenter hors périmètre ;
7. mettre à jour l’ordre recommandé si une dépendance change ;
8. conserver les paliers non choisis sans les supprimer.

## 19. Journal synthétique

| Date | Palier | Statut | Commit principal | Validation |
|---|---|---|---|---|
| 2026-11-06 | 0–1 | Terminé | série jusqu’à `96f481e` | tests WSL/Windows |
| 2026-11-06 | 2A | Terminé | série jusqu’à `ae13808` | auto-scroll et interface validés |
| 2026-11-06 | 2B | Terminé | `8c247ce` à `b602e22` | 496 tests + Tauri manuel validé |

## 20. Prochain choix recommandé

Le prochain palier naturel est **2C — Continuer une réponse interrompue**.

Pour maximiser rapidement l’amélioration des longues conversations, choisir ensuite **3A**, puis **3B**, **3C** et **3D** dans cet ordre. Ne pas commencer 3C sans 3A/3B.
