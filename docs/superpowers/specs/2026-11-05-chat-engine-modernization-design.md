# Design — Modernisation du moteur de chat LogAssist

**Date :** 2026-11-05

**Statut :** validé par l'utilisateur

**Branche dédiée :** `feat/chat-engine-modernization`

**Branche stable de départ :** `feat/m1-socle-chat` au commit `cee69cc`

## 1. Intention

Faire évoluer LogAssist vers un chat de référence pour apprendre des logiciels, sans transformer son identité visuelle ni en faire un agent qui agit à la place de l'utilisateur.

Le produit reste un **conseiller** : il analyse les messages, captures et fichiers volontairement fournis, utilise les connaissances activées et peut consulter le Web via le MCP borné existant. Il ne contrôle ni la souris, ni le clavier, ni les logiciels du poste.

Le chantier équilibre trois priorités validées :

1. conserver un contexte fiable dans les conversations longues ;
2. améliorer la lecture et le défilement sans dénaturer le chat actuel ;
3. améliorer l'usage des fichiers et captures tout en gardant les images éphémères.

## 2. Expertise du socle actuel

### 2.1 Points forts à préserver

- Streaming SSE robuste, y compris UTF-8 multioctet, CRLF et flush final.
- Contrat anti-perte : `useChat.send()` retourne `Promise<boolean>` et ne lève jamais.
- Persistance du message utilisateur avant l'appel fournisseur.
- Attente des écritures assistant avant le passage de `busy` à `false`.
- Interruption du flux LLM et de la requête MCP active.
- Adaptateur `IProvider` indépendant du consommateur.
- Orchestrateur Web borné : deux tours d'outils et quatre appels MCP maximum.
- Secrets uniquement dans le Credential Manager Windows.
- SQL paramétré, Markdown échappé et absence de rendu HTML brut.
- Sources Web filtrées, dédupliquées et persistées sans contenu Web brut.
- Couverture Vitest et Rust déjà importante.

### 2.2 Limites observées

- `src/hooks/useChat.ts` concentre état React, pièces jointes, contexte, fournisseur, Web, streaming, erreurs et persistance. Toute nouvelle fonction augmente le couplage.
- L'intégralité de l'historique est renvoyée à chaque tour. Une longue conversation finira par dépasser la fenêtre du modèle ou augmenter inutilement coût et latence.
- Les capacités d'un modèle se limitent principalement à `supports_images`. Les outils, la fenêtre de contexte, la sortie maximale et la disponibilité de statistiques ne sont pas décrits de manière durable.
- Le compteur affiché sous chaque réponse représente actuellement la conversation entière. La même valeur cumulative apparaît donc sous plusieurs messages et ne correspond pas au coût du tour concerné.
- Le nom du fournisseur transmis au calcul tarifaire ne correspond pas toujours à l'identifiant attendu par le catalogue.
- Le tarif générique de repli produit un coût chiffré alors que le vrai tarif peut être inconnu.
- Le temps du premier token est mesuré par l'adaptateur mais n'est ni persisté ni affiché.
- `ChatView` force le bas de la conversation à chaque delta. L'utilisateur ne peut pas relire sereinement un ancien passage pendant le streaming.
- Les actions de récupération restent incomplètes : retenter une erreur, continuer une interruption ou régénérer la dernière réponse.
- Les images du message courant sont disponibles pour le modèle, mais ne peuvent pas être rejouées depuis l'historique. Ce comportement est désormais un choix produit explicite, pas un défaut à corriger par stockage durable.

## 3. Principes directeurs

1. **Évolution, pas refonte.** Le shell actuel, la sidebar, le header, le fond, le composeur et l'ambiance sombre restent reconnaissables.
2. **Compatibilité par capacités.** Le cœur demande une capacité ; chaque adaptateur annonce ce qu'il supporte et fournit un repli sûr.
3. **Compatibilité honnête.** Une URL et une clé suffisent pour une API respectant un protocole pris en charge. Une API propriétaire nécessite un adaptateur dédié ; aucune architecture ne peut garantir la compatibilité avec un protocole inconnu.
4. **Aucune fonction optionnelle ne bloque le chat.** Résumé, métriques, Web ou usage fournisseur en panne doivent se dégrader proprement.
5. **Images éphémères.** LogAssist ne crée pas d'archive binaire des images et ne touche jamais au fichier original de l'utilisateur.
6. **Mesures honnêtes.** Une valeur estimée est marquée comme telle. Aucun coût n'est inventé quand le tarif est inconnu.
7. **Migrations additives.** Les données existantes restent lisibles et aucun historique n'est réécrit destructivement.
8. **TDD et gates par palier.** Chaque comportement est testé avant son implémentation et chaque palier reste intégrable indépendamment.

## 4. Périmètre

### 4.1 Inclus

- Extraction progressive de l'orchestration hors de `useChat`.
- Registre de capacités par modèle, avec valeurs configurables.
- Budget de contexte, fenêtre glissante et résumé spécialisé par conversation.
- Compteurs et latences par tour.
- Auto-scroll respectueux de la lecture.
- Présentation hybride : message utilisateur compact, réponse assistant plus ouverte.
- Actions **Copier**, **Retenter**, **Continuer** et **Régénérer la dernière réponse**.
- Composeur rationalisé sans changement d'emplacement.
- Collage, glisser-déposer et sélection d'images éphémères.
- États d'erreur récupérables sans duplication du message utilisateur.
- Compatibilité maintenue avec les fournisseurs OpenAI-compatibles, locaux ou distants.

### 4.2 Non-objectifs

- Contrôle de la souris, du clavier ou d'un logiciel tiers.
- Exécution autonome de commandes ou modification de fichiers utilisateur.
- Mémoire globale cachée entre conversations.
- Stockage durable des images ou captures.
- Branches visuelles de conversation et comparaison de plusieurs variantes.
- Édition d'un ancien message au milieu de l'historique.
- Synchronisation cloud ou multi-appareils.
- Refonte de la sidebar, du header, des réglages ou de l'identité graphique.
- Adaptateur universel capable de comprendre une API propriétaire sans implémentation dédiée.

## 5. Architecture cible

```text
ChatView / Composer / ContextMeter
                │
                ▼
     ConversationController
     (hook React mince)
                │
      ┌─────────┼─────────┬──────────────────┐
      ▼         ▼         ▼                  ▼
  TurnRunner ContextEngine AttachmentSession CapabilityRegistry
      │         │         │                  │
      └─────────┴─────────┴──────────────────┘
                │
      Provider adapters / SQLite / MCP / Secrets
```

### 5.1 `ConversationController`

Le hook exposé à React conserve uniquement :

- le modèle de vue des messages ;
- l'état occupé et les statuts visibles ;
- les commandes `load`, `send`, `interrupt`, `retry`, `continue` et `regenerateLast` ;
- le contrat anti-perte `Promise<boolean>` ;
- la synchronisation entre conversation active et résultats asynchrones.

Il ne construit plus directement les requêtes fournisseur et ne contient plus la logique de budget de contexte.

### 5.2 `TurnRunner`

`TurnRunner` orchestre un tour sans dépendre de React :

1. valider l'intention d'envoi ;
2. persister le message utilisateur ;
3. demander un paquet de contexte à `ContextEngine` ;
4. résoudre les capacités et l'adaptateur du modèle ;
5. exécuter le flux direct ou l'orchestrateur Web existant ;
6. normaliser les métriques ;
7. persister la réponse, les sources et l'erreur éventuelle ;
8. retourner des événements typés au contrôleur.

Le service accepte un `AbortSignal`. Il ne connaît ni composant React ni fonction `setState`.

### 5.3 `AttachmentSession`

Ce service formalise le comportement actuel :

- le `base64` d'une image reste en mémoire le temps du tour ;
- le binaire n'est pas écrit dans SQLite ni dans un dossier applicatif ;
- les métadonnées minimales peuvent rester dans `messages.attachments` ;
- après redémarrage, l'historique affiche un chip de fichier sans aperçu ;
- les fichiers originaux choisis par l'utilisateur ne sont jamais modifiés ou supprimés ;
- le contenu d'un fichier texte explicitement joint reste injecté dans le message, comme aujourd'hui.

La fermeture normale, un crash ou un redémarrage ne nécessitent donc aucun nettoyage de fichiers image créés par LogAssist puisqu'aucune copie durable n'existe.

### 5.4 `CapabilityRegistry`

Chaque modèle dispose de capacités configurables :

```ts
interface ModelCapabilities {
  supportsImages: boolean
  supportsTools: boolean | "unknown"
  reportsUsage: boolean | "unknown"
  contextWindowTokens: number | null
  maxOutputTokens: number | null
}
```

Règles :

- les fonctions de base texte ne dépendent d'aucune capacité optionnelle ;
- `unknown` autorise une tentative contrôlée lorsque le repli est sûr ;
- un rejet explicite d'une capacité est mémorisé pour la session ;
- les réglages avancés du modèle permettent de corriger manuellement les valeurs annoncées par un fournisseur ;
- une valeur de fenêtre inconnue utilise un défaut conservateur documenté, initialement `32 768` tokens ;
- un dépassement fournisseur devient une erreur normalisée `context_length`, avec une action claire.

Le registre ne doit pas contenir de logique TinyFish. Le Web reste une capacité orchestrée séparément.

## 6. Gestion du contexte et de la mémoire

### 6.1 Objectif

Préserver la continuité pédagogique sans envoyer indéfiniment tout l'historique. La base reste la source complète ; le paquet envoyé au modèle est une projection bornée.

### 6.2 Ordre de priorité

`ContextEngine` assemble le contexte dans cet ordre :

1. instructions générales et profil ;
2. garde-fous Web si le Web est actif ;
3. connaissances explicitement activées ;
4. mémoire synthétique de la conversation ;
5. tours récents en texte intégral ;
6. message utilisateur courant, jamais tronqué silencieusement.

Si les sections obligatoires et le message courant dépassent déjà le budget, l'envoi est refusé avec un diagnostic précis. LogAssist ne tronque pas arbitrairement la demande courante.

### 6.3 Budget

Le planificateur réserve d'abord la sortie, puis alloue le reste à l'entrée :

- sortie configurée sur le modèle si disponible ;
- sinon réserve initiale de 20 % de la fenêtre, bornée entre `1 024` et `8 192` tokens ;
- marge de sécurité pour les différences de tokenisation et l'enveloppe du protocole ;
- conservation prioritaire des tours les plus récents.

Les valeurs exactes restent centralisées, testées et modifiables sans toucher aux composants.

### 6.4 Résumé spécialisé

Quand l'historique ancien ne tient plus dans le budget, LogAssist produit un résumé Markdown structuré, limité à :

- logiciel et version ;
- objectif utilisateur ;
- état réellement observé ;
- étapes déclarées comme terminées ;
- décisions et valeurs importantes ;
- erreurs déjà rencontrées et solutions essayées ;
- blocage courant ;
- références indispensables à la suite.

Le résumé ne doit pas transformer une étape seulement proposée en étape effectuée. Son prompt rappelle cette distinction.

Le résumé est généré avec le modèle actif via le contrat fournisseur commun. Il est créé uniquement au franchissement du seuil de contexte, pas à chaque message. Pendant cette opération, l'interface affiche « Optimisation du contexte… ».

La mise à jour est incrémentale : elle combine le résumé valide précédent avec un lot borné de messages anciens encore non couverts. Le lot respecte lui-même le budget du modèle. Si plusieurs lots sont nécessaires, ils sont traités séquentiellement avec une limite explicite ; LogAssist ne tente jamais de résumer tout un historique hors fenêtre dans une seule requête.

En cas d'échec :

- l'envoi continue avec une fenêtre récente déterministe si elle tient dans le budget ;
- aucune mémoire précédente valide n'est écrasée ;
- l'échec est journalisé sans contenu sensible et reste non bloquant ;
- si même le repli ne tient pas, une erreur de contexte explicite est affichée.

### 6.5 Contrôle utilisateur

Une jauge discrète indique l'occupation estimée du contexte. Un inspecteur explique :

- modèle et fenêtre configurée ;
- volume des instructions, connaissances, mémoire et messages récents ;
- présence d'une estimation ou de mesures fournisseur ;
- date du dernier résumé ;
- action pour réinitialiser uniquement le résumé de la conversation.

Il n'existe aucune mémoire implicite entre deux conversations.

## 7. Persistance et migrations

Une migration incrémente `SCHEMA_VERSION`. Elle reste additive et respecte le mécanisme `PRAGMA user_version`.

### 7.1 Modèles

Les modèles reçoivent des champs optionnels pour :

- fenêtre de contexte ;
- sortie maximale ;
- support des outils en tri-état ;
- disponibilité des statistiques d'usage en tri-état ;
- prix d'entrée et de sortie optionnels par million de tokens.

Une absence de prix signifie « coût inconnu ». L'interface n'affiche alors aucun faux montant générique.

### 7.2 Mémoire de conversation

Une table dédiée, liée en cascade à `conversations`, conserve :

- `conversation_id` ;
- résumé Markdown ;
- identifiant du dernier message couvert ;
- estimation du nombre de tokens ;
- date de mise à jour.

L'historique complet reste dans `messages`. Supprimer ou réinitialiser le résumé ne supprime aucun message.

### 7.3 Métriques de message

Les réponses assistant peuvent conserver :

- temps du premier token ;
- durée totale ;
- tokens d'entrée ;
- tokens de sortie ;
- origine de la mesure : `provider` ou `estimated`.

Le coût est calculé uniquement si un tarif fiable est disponible. Les métriques historiques absentes restent `NULL`.

### 7.4 Images

Aucune colonne de blob, aucun chemin de copie locale et aucun cache image durable ne sont ajoutés. `attachments` reste un JSON de métadonnées pour l'historique.

## 8. Fournisseurs et compatibilité

### 8.1 Socle universel

Le format interne `ChatRequest` reste indépendant du fournisseur. Les consommateurs dépendent d'une interface commune et non de `createOpenAICompatible`.

Le socle OpenAI-compatible continue d'accepter :

- nom libre ;
- URL de base distante en HTTPS ;
- URL locale autorisée ;
- clé API ou secret vide pour un serveur local ;
- identifiant de modèle libre.

Une nouvelle famille d'API se branche par un adaptateur qui traduit messages, images, outils, streaming, erreurs et usage. Le reste du chat ne change pas.

### 8.2 Dégradation par capacité

- Sans vision : blocage de l'envoi d'image avec diagnostic, texte toujours disponible.
- Sans outils : une seule reprise sans outils, puis capacité mémorisée pour la session.
- Sans usage : comptage local marqué « estimé ».
- Sans fenêtre connue : valeur conservatrice et réglage manuel.
- Sans prix : tokens visibles, coût masqué.
- Sans méthode de complétion non streamée : l'adaptateur peut implémenter le résumé par un flux silencieux interne.

### 8.3 Erreurs

Les erreurs réseau et HTTP continuent à passer par `normalizeHttpStatus` et `normalizeNetworkError`. Le domaine ajoute au minimum :

- `context_length` ;
- erreur de réponse fournisseur invalide si elle ne peut pas être classée autrement.

Chaque nouveau `ApiErrorKind` possède une clé i18n et un test de couverture.

## 9. Expérience utilisateur

### 9.1 Continuité visuelle

Le chantier ne remplace pas l'identité de LogAssist.

Conservés :

- sidebar et header ;
- arrière-plans sombre et clair ;
- position du sélecteur de modèle et du composeur, sauf ajustement mineur de densité ;
- palette neutre ;
- icônes et formes générales existantes.

Les couleurs de marque existantes deviennent des accents secondaires :

- `#9FBFD6` pour contrôles principaux clairs et repères calmes ;
- `#27C8D6` pour focus, état actif, progression et filet assistant ;
- texte noir sur `bg-brand-from`, conformément à l'invariant d'accessibilité.

Aucune couleur vive supplémentaire ni style sans rapport avec l'application n'est introduit.

### 9.2 Présentation hybride

- Le message utilisateur reste une bulle compacte alignée à droite.
- La réponse assistant reste dans le flux actuel, mais avec une surface plus ouverte, une largeur de lecture bornée et un filet bleu discret.
- Les titres, tableaux, listes, code et sources conservent le moteur Markdown sécurisé.
- Les métadonnées sont regroupées en bas : modèle, latences, tokens, coût éventuel et actions.
- Les sources longues sont repliables sans masquer leur présence.

### 9.3 Auto-scroll

Le conteneur suit le streaming uniquement lorsque l'utilisateur se trouve près du bas.

- Un seuil mesuré sur le conteneur détermine `isNearBottom`.
- Si l'utilisateur remonte, les deltas ne déplacent plus sa lecture.
- Un bouton « Nouvelle réponse — revenir en bas » apparaît.
- Un clic réactive le suivi et descend au dernier contenu.
- Le comportement respecte `prefers-reduced-motion`.

Le `scrollIntoView` exécuté à chaque delta est supprimé.

### 9.4 Composeur et pièces jointes

- Le composeur reste en bas de la zone centrale.
- Entrée envoie, Maj+Entrée crée une ligne, comme aujourd'hui.
- Coller, glisser-déposer ou choisir une image produit un aperçu temporaire retirable.
- Un menu compact « Joindre » peut regrouper image et fichier texte sans supprimer les raccourcis existants.
- Le bouton Web conserve son comportement pour le prochain message.
- Un modèle sans vision explique pourquoi l'image ne peut pas partir.
- Après redémarrage, une ancienne image apparaît comme chip de métadonnées sans `img src=""`.

### 9.5 Actions de réponse

- **Copier** garde le comportement actuel.
- **Retenter** rejoue un tour en erreur à partir du message utilisateur déjà persisté, sans créer de doublon.
- **Continuer** complète une réponse interrompue et met à jour le même message après succès.
- **Régénérer** est limité à la dernière réponse assistant. La réponse précédente reste affichée tant que la nouvelle génération n'a pas réussi ; le remplacement en base n'est effectué qu'après succès. Une erreur conserve donc l'ancienne réponse.

Les variantes multiples et branches restent hors périmètre. La régénération est un remplacement explicite, pas une arborescence.

## 10. Gestion des erreurs et cohérence

### 10.1 Séquence d'un envoi

1. Valider le contenu et la capacité image.
2. Afficher puis persister le message utilisateur.
3. Construire le contexte.
4. Ajouter la bulle assistant temporaire.
5. Exécuter le fournisseur ou le Web.
6. Persister la réponse, l'interruption ou l'erreur.
7. Attendre la persistance avant de libérer `busy`.

### 10.2 Invariants

- Échec avant persistance utilisateur : `send()` retourne `false`, le composeur restaure le contenu et la bulle optimiste disparaît.
- Échec après persistance utilisateur : `send()` retourne `true` et matérialise l'erreur dans la réponse assistant.
- Une optimisation de contexte ne supprime jamais l'historique source.
- Une régénération échouée ne détruit pas la réponse précédente.
- Une interruption conserve le texte déjà reçu.
- Un changement rapide de conversation ne peut pas appliquer un résultat obsolète à la vue active.
- Une erreur persistée est expurgée de tout secret ou en-tête d'autorisation.

### 10.3 États visibles

Les statuts restent courts et traduits :

- réflexion ;
- optimisation du contexte ;
- recherche Web ;
- lecture d'une page ;
- réponse interrompue ;
- erreur récupérable avec action adaptée.

## 11. Performance

- Les anciennes réponses Markdown conservent leur mémoïsation.
- Les mises à jour de streaming ciblent uniquement le message assistant actif.
- Le comptage des tokens est déplacé hors de chaque bulle et calculé par tour.
- Les encodeurs tiktoken sont libérés lors de leur remplacement ou du démontage.
- La construction du contexte est une fonction pure testable.
- Une optimisation de rendu pour les historiques très longs pourra être ajoutée au palier de consolidation si les mesures le justifient ; aucune dépendance de virtualisation n'est imposée sans profilage.

## 12. Sécurité et confidentialité

Les invariants existants restent obligatoires :

- clés uniquement dans le Credential Manager ;
- aucun secret ou `Bearer` dans les logs et erreurs persistées ;
- SQL entièrement paramétré ;
- aucun `innerHTML`, `dangerouslySetInnerHTML` ou `rehype-raw` ;
- contenu Web toujours externe et non fiable ;
- aucun contenu Web brut persisté ;
- aucun binaire d'image persisté ;
- aucune suppression de fichier original ;
- endpoint MCP et outils toujours verrouillés côté Rust.

Le trafic LLM via `tauri-plugin-http` reste dans le périmètre actuel. Son déplacement complet côté Rust et le resserrement de la CSP de production constituent un chantier sécurité séparé afin de ne pas mélanger deux transformations majeures.

## 13. Stratégie de tests

### 13.1 Tests unitaires

- budget selon fenêtre, réserve et marge ;
- priorité des sections du contexte ;
- message courant jamais tronqué silencieusement ;
- fenêtre récente déterministe ;
- création et mise à jour du résumé ;
- repli si le résumé échoue ;
- capacités connues, inconnues et incompatibles ;
- normalisation des métriques fournisseur et estimées ;
- coût absent quand le tarif est inconnu ;
- redaction des détails d'erreur.

### 13.2 Tests d'intégration TypeScript

- envoi direct, Web, interruption et erreurs ;
- ordre persistance utilisateur → contexte → fournisseur → assistant ;
- contrat anti-perte inchangé ;
- persistance attendue avant `busy=false` ;
- retry sans doublon utilisateur ;
- continuation d'une réponse interrompue ;
- régénération réussie et échec conservant l'ancienne réponse ;
- changement rapide de conversation ;
- historique long dépassant le seuil ;
- fournisseur sans outils, usage, prix ou fenêtre connue.

### 13.3 Tests composants

- auto-scroll actif près du bas ;
- position figée après remontée ;
- bouton de retour en bas ;
- rendu hybride sans changement destructif de structure ;
- focus visible et navigation clavier ;
- actions Copier, Retenter, Continuer et Régénérer ;
- collage, sélection, suppression et glisser-déposer d'image ;
- absence d'image historique avec source vide ;
- coût exact, estimé ou absent selon les données.

### 13.4 Migrations et garde-fous

- migration depuis une base V5 ;
- valeurs `NULL` compatibles avec les anciennes lignes ;
- cascade de la mémoire avec la conversation ;
- toutes les requêtes paramétrées ;
- garde `console.log`, couleurs de marque et i18n ;
- aucun nouveau stockage de binaire image.

### 13.5 Validation Rust et Windows

- tests MCP existants inchangés ;
- `cargo test` ;
- `cargo clippy --all-targets -- -D warnings` ;
- build et tests finaux depuis PowerShell Windows ;
- tests manuels avec fournisseur distant, LM Studio/Ollama local et modèle sans outils ;
- fermeture/réouverture confirmant l'absence d'aperçu image durable ;
- conversation longue, interruption, retry et régénération.

## 14. Paliers de livraison

Ce document est la conception directrice du programme, pas l'autorisation d'exécuter un « méga-plan » en une seule fois. Chaque palier reçoit son propre plan d'implémentation, ses commits et sa revue. Le premier passage par `writing-plans` couvre uniquement le palier 1 ; le palier suivant n'est planifié qu'après validation des gates et revue du précédent.

### Palier 0 — Isolation et référence

- travailler uniquement sur `feat/chat-engine-modernization` ;
- enregistrer l'état des tests avant modification ;
- ne pas installer de dépendance native depuis WSL ;
- conserver des commits petits et cohérents.

### Palier 1 — Fondations sans changement visuel

- extraire les fonctions pures et `TurnRunner` ;
- maintenir tous les comportements existants ;
- corriger les métriques cumulatives et le coût inconnu ;
- ajouter les tests de non-régression.

### Palier 2 — Lecture et récupération

- présentation hybride mesurée ;
- auto-scroll respectueux ;
- retry, continuation et régénération limitée ;
- états accessibles et i18n.

### Palier 3 — Contexte et capacités

- migration additive ;
- registre de capacités ;
- budget et fenêtre glissante ;
- résumé spécialisé ;
- jauge et inspecteur de contexte.

### Palier 4 — Consolidation

- compatibilité fournisseurs et modèles locaux ;
- historiques longs et performance ;
- audit de sécurité ciblé ;
- tests Rust et build Windows ;
- revue finale avant merge.

Chaque palier doit laisser la branche dans un état testable. Un échec de gate bloque le palier suivant.

## 15. Critères de réussite

- Une conversation longue reste utilisable sans envoyer tout l'historique.
- Le résumé conserve l'état d'apprentissage sans déclarer terminée une étape seulement proposée.
- N'importe quel fournisseur OpenAI-compatible correctement configuré conserve le chat texte de base.
- Une capacité absente se dégrade sans casser le chat.
- Chaque réponse affiche ses propres métriques, avec distinction entre mesure et estimation.
- Lire un ancien passage pendant le streaming ne provoque aucun retour forcé en bas.
- L'interface reste immédiatement reconnaissable comme LogAssist.
- Le bleu de marque reste un accent secondaire cohérent.
- Aucune image binaire n'est conservée par LogAssist après la session.
- Les fichiers originaux de l'utilisateur ne sont jamais supprimés.
- Retry et régénération ne dupliquent pas le message utilisateur.
- Les invariants secrets, SQL, Markdown, Web et anti-perte restent couverts.
- Les gates TypeScript, Vitest, Rust, Clippy et build Windows passent avant intégration.

## 16. Risques et parades

| Risque | Parade |
|---|---|
| Résumé inexact | Format spécialisé, distinction proposé/effectué, historique source intact et reset utilisateur |
| Modèle inconnu | Valeurs conservatrices, réglages manuels et erreur de contexte normalisée |
| Régression du streaming | Extraction progressive derrière les mêmes contrats et tests de non-régression |
| Refonte visuelle involontaire | Conservation du shell, tokens existants et revue visuelle à chaque palier |
| Coût affiché faux | Aucun coût sans tarif connu ; provenance des tokens visible |
| Perte lors d'un retry | Message utilisateur déjà persisté, remplacement assistant seulement après succès |
| Complexité excessive | Pas de branches, pas d'édition historique, pas d'agent desktop dans ce chantier |
| Build Tauri cassé par WSL | Aucun `npm install` natif sous WSL ; validation finale PowerShell Windows |

## 17. Décisions laissées au plan d'implémentation

- Noms exacts des nouveaux fichiers et interfaces, en respectant les frontières décrites.
- Regroupement des statements dans une ou plusieurs migrations séquentielles.
- Seuils finaux du planificateur de contexte, dans les bornes définies.
- Forme précise de l'inspecteur de contexte dans l'interface actuelle.
- Choix entre mise à jour SQL atomique ou transaction dédiée pour régénération/continuation.
- Besoin réel d'une optimisation de rendu supplémentaire après profilage.

Ces décisions ne peuvent pas modifier le périmètre, les invariants de sécurité, le comportement éphémère des images ou la continuité visuelle sans nouvelle validation utilisateur.
