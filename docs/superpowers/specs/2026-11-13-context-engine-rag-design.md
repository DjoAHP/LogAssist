# Design — Moteur de contexte IA et RAG local

**Date :** 2026-11-13
**Statut :** conception validée par l’utilisateur
**Branche :** `feat/context-engine-rag`
**Branche de départ :** `feat/m1-socle-chat` au commit `63e1bf0`

## 1. Intention

LogAssist doit pouvoir utiliser une bibliothèque Markdown importante, des
conversations longues, des images et des outils MCP sans envoyer une requête qui
dépasse la fenêtre du modèle actif.

La correction ne consiste ni à supprimer des connaissances, ni à modifier les
documents originaux, ni à augmenter arbitrairement la fenêtre de LM Studio. Elle
introduit une projection bornée du contexte complet : les données restent dans
SQLite, tandis que chaque appel fournisseur reçoit uniquement les éléments utiles
qui tiennent dans un budget calculé avant le réseau.

Cette conception réalise et précise le « palier contexte » annoncé dans
`docs/superpowers/specs/2026-11-05-chat-engine-modernization-design.md`. Elle le
complète avec un RAG local pour les connaissances et remplace deux décisions
devenues trop optimistes :

- le repli d’une fenêtre inconnue passe de 32 768 à 4 096 tokens ;
- aucune synthèse LLM automatique n’est créée dans cette livraison.

## 2. Constats vérifiés dans le dépôt

### 2.1 Connaissances Markdown

Dans `src/hooks/useChat.ts`, l’envoi normal et la récupération chargent toutes les
connaissances éligibles. `src/lib/prompts/compose.ts` concatène ensuite le contenu
intégral de chaque document à la fin du prompt système.

La sélection actuelle suit cette règle, qui doit rester strictement inchangée :

1. lire `conversation_knowledge` ;
2. si la liste contient au moins un identifiant, utiliser cette liste comme
   sélection de conversation ;
3. sinon, utiliser la sélection globale ;
4. dans les deux cas, exclure les documents dont `enabled !== 1`.

Un premier message peut donc déjà dépasser une fenêtre de 8 192 tokens si les
documents actifs sont volumineux.

### 2.2 Historique

`messages.listByConversation()` retourne toutes les lignes, puis
`buildChatMessages()` les recopie toutes. `createRecoveryPlan()` retire uniquement
la réponse à remplacer ; tout l’historique antérieur repart lors d’un retry ou
d’une régénération.

SQLite reste la source complète. Aucune limite n’est actuellement appliquée à la
projection envoyée au fournisseur.

### 2.3 Estimation des tokens

`estimateTurnMetrics()` est exécuté après la réponse lorsque le fournisseur ne
rapporte pas son usage. Il sert aux métriques, pas à la protection de la requête.
Il encode seulement `message.content` avec tiktoken et ignore notamment :

- l’enveloppe du protocole et les rôles ;
- les définitions d’outils ;
- les appels et résultats d’outils ;
- le coût visuel des images.

Pour un modèle inconnu, le code retombe sur `cl100k_base`, qui n’est pas le
tokenizer universel des modèles locaux.

### 2.4 Images

Le Base64 des images du message courant est transmis dans `image_url`. Les images
historiques ne sont pas rejouées : seul leur chip de métadonnées persiste, ce qui
respecte l’invariant d’images éphémères.

Le constat initial est donc partiellement confirmé : une image courante consomme
du contexte, mais son Base64 ne doit pas être assimilé à des tokens et les
anciennes images ne s’accumulent pas dans les requêtes suivantes.

### 2.5 MCP

`runToolAgent()` autorise deux tours d’outils, quatre appels MCP et jusqu’à
120 000 caractères Unicode injectés. Cette limite protège la mémoire applicative,
mais pas une fenêtre de contexte en tokens. Les schémas des outils sont eux aussi
présentés au modèle sans estimation préalable.

Chaque appel de `runToolAgent()` appelle actuellement le fournisseur directement.
Un contrôle effectué seulement avant le premier tour ne suffirait donc pas.

### 2.6 Capacités des modèles

La table `models` connaît seulement l’identifiant, la vision et l’état par défaut.
`listRemoteModels()` réduit la réponse de `GET /models` à une liste de chaînes.

LM Studio expose toutefois, via `GET /api/v1/models` :

- `loaded_instances[].config.context_length`, fenêtre réellement chargée ;
- `max_context_length`, maximum théorique du fichier ;
- les capacités vision et outils.

Pour l’erreur observée `n_keep: 37609 >= n_ctx: 8192`, la valeur pertinente est la
fenêtre chargée de 8 192, pas le maximum théorique du modèle.

### 2.7 Référence de tests

Les 58 tests ciblés de contexte, prompt, métriques, récupération et MCP passent
sous PowerShell/Windows. Le lancement des mêmes tests depuis WSL échoue avant
l’exécution à cause du binding Rolldown Windows présent dans `node_modules`, piège
déjà documenté dans `AGENTS.md`. Aucune réinstallation n’a été effectuée sous WSL.

## 3. Décisions validées

1. Utiliser un RAG lexical local en TypeScript, sans API payante, modèle à
   télécharger ni nouvelle dépendance native.
2. Garder le moteur de recherche derrière une interface afin de pouvoir ajouter
   ultérieurement des embeddings locaux.
3. Centraliser le contrôle à la frontière de chaque appel fournisseur.
4. Préserver intégralement les instructions de base et le message utilisateur
   courant ; bloquer explicitement s’ils ne tiennent pas.
5. Conserver des tours récents et pertinents sans supprimer de ligne SQLite.
6. Ne pas créer de synthèse automatique dans cette livraison. Une extension
   future pourra fournir une mémoire synthétique au même planificateur.
7. Ne jamais utiliser la longueur Base64 comme estimation du coût d’une image.
8. Journaliser uniquement des métadonnées non sensibles.

## 4. Approches écartées

### 4.1 SQLite FTS5 dès cette livraison

FTS5 donnerait un index persistant rapide, mais imposerait une migration dérivée,
une synchronisation stricte à chaque ajout, modification et suppression, ainsi
qu’une dépendance à la compilation SQLite embarquée sous Windows. Il n’apporterait
pas de compréhension sémantique supplémentaire par rapport au BM25 retenu.

### 4.2 Embeddings locaux dès cette livraison

Une recherche hybride lexical + vecteurs améliorerait certains rappels
sémantiques, mais exigerait un modèle d’embeddings, un runtime WASM/ONNX ou un
service local, une phase d’indexation et une distribution plus lourde. Cette
évolution restera possible derrière `KnowledgeRetriever` après mesure des limites
du moteur lexical.

## 5. Architecture cible

```text
useChat
  │
  ├── charge les sources complètes (SQLite, réglages, pièces jointes)
  │
  ▼
ContextEngine
  ├── ModelContextResolver
  ├── TokenEstimator
  ├── MarkdownChunker
  ├── KnowledgeRetriever
  ├── HistorySelector
  ├── ContextPlanner
  └── ContextDiagnostics
  │
  ▼
ContextSession / garde par tour
  │
  ├── appel direct
  ├── retry / régénération
  ├── premier tour MCP
  ├── tours après résultats MCP
  ├── repli sans outils
  └── tour final sans outils
  │
  ▼
IProvider.runTurn
```

### 5.1 Nouveau domaine `src/lib/context/`

Le domaine est indépendant de React et de SQLite. Il reçoit des objets typés et
retourne une projection testable.

Fichiers prévus :

- `types.ts` : contrats communs ;
- `modelCapabilities.ts` : résolution et provenance de la fenêtre ;
- `tokenEstimator.ts` : estimation texte, messages, outils et images ;
- `markdownChunker.ts` : vue découpée des documents ;
- `knowledgeRetriever.ts` : index lexical, classement et diversité ;
- `historySelector.ts` : regroupement et sélection des tours ;
- `contextPlanner.ts` : allocation du budget et construction finale ;
- `diagnostics.ts` : projection sûre vers `logger.debug`.

Les noms exacts pourront être ajustés dans le plan si les responsabilités restent
identiques.

### 5.2 Contrats principaux

```ts
type ContextWindowSource =
  | "manual"
  | "provider_loaded"
  | "provider_metadata"
  | "registry"
  | "fallback"

interface ModelContextProfile {
  contextWindowTokens: number
  maxOutputTokens: number
  source: ContextWindowSource
  tokenizer: "openai_tiktoken" | "conservative"
}

interface KnowledgeReference {
  documentId: string
  documentFingerprint: string
  chunkIndex: number
  headingPath: string[]
  promptLabel: string
}

interface ContextPlan {
  messages: ChatMessage[]
  maxOutputTokens: number
  knowledgeReferences: KnowledgeReference[]
  stats: ContextStats
  session: ContextSession
}
```

`headingPath` et les contenus servent à composer le prompt en mémoire. La version
destinée au logger retire noms, titres et textes privés.

### 5.3 Frontière fournisseur obligatoire

Le contrôle doit être impossible à contourner par accident. `runAssistantTurn()`
et `runToolAgent()` ne construiront plus librement une requête finale. Ils
recevront un exécuteur borné ou une callback `prepareRound()` qui :

1. reçoit les messages dynamiques et les outils du tour ;
2. recompte toutes les catégories ;
3. réduit seulement les éléments optionnels ;
4. refuse le tour si les éléments obligatoires ne tiennent pas ;
5. appelle ensuite `provider.runTurn()`.

Les chemins direct, MCP, repli et récupération partagent cette frontière.

## 6. Résolution de la fenêtre du modèle

### 6.1 Priorité

La valeur effective est choisie dans cet ordre :

1. `context_window_override` configuré par l’utilisateur ;
2. fenêtre d’une instance actuellement chargée annoncée par le fournisseur ;
3. fenêtre annoncée dans les métadonnées du modèle ;
4. valeur d’un registre statique vérifié pour un modèle connu ;
5. repli de 4 096 tokens.

Chaque valeur doit être un entier sûr dans des bornes centralisées. Une réponse
malformée, négative ou démesurée est ignorée.

### 6.2 LM Studio

Pour une URL locale LM Studio, l’adaptateur dérive l’origine depuis l’URL OpenAI
compatible, puis consulte en lecture seule `/api/v1/models` avec un timeout court.

Le résolveur :

- cherche d’abord une instance chargée dont `id` ou la clé du modèle correspond à
  `modelId` ;
- utilise `loaded_instances[].config.context_length` ;
- si plusieurs instances correspondent, retient la plus petite fenêtre pour ne
  jamais surestimer ;
- n’utilise `max_context_length` que comme métadonnée théorique lorsqu’aucune
  instance chargée ne peut être identifiée ;
- met le résultat en cache éphémère avec une courte durée de vie ;
- invalide le cache après une erreur fournisseur de contexte.

Une panne de cet endpoint ne bloque pas le chat : le résolveur continue vers les
sources suivantes.

### 6.3 Autres fournisseurs OpenAI compatibles

La lecture de `/models` accepte opportunément des champs fiables tels que
`context_length` ou `max_context_length`, sans les exiger du protocole standard.
OpenRouter peut ainsi fournir sa fenêtre. Les fournisseurs qui ne renvoient que
`id` continuent de fonctionner.

### 6.4 Réglages manuels et migration

La migration V11 ajoute à `models` :

```sql
context_window_override INTEGER NULL
max_output_tokens_override INTEGER NULL
```

Des contraintes applicatives imposent des entiers positifs cohérents. `NULL`
signifie « automatique ». L’interface avancée du modèle permet de définir ou de
réinitialiser ces deux valeurs, sans modifier la configuration du fournisseur.

La migration est additive. Les modèles historiques restent valides avec deux
valeurs `NULL`.

## 7. Estimation des tokens

### 7.1 Estimateur texte

Deux stratégies implémentent la même interface :

- **OpenAI connu** : tiktoken avec le modèle explicitement supporté ;
- **modèle inconnu ou local** : estimation conservatrice fondée sur le nombre de
  points de code, les octets UTF-8 et un surcoût fixe par message.

Le moteur ne prétend pas fournir un comptage exact pour Qwen, Llama, Mistral ou
Gemini. La marge de sécurité absorbe une partie de l’écart et la provenance est
visible dans le diagnostic.

L’estimation inclut :

- contenus textuels ;
- rôles et enveloppes de messages ;
- noms et arguments d’appels d’outils ;
- identifiants de résultats d’outils ;
- noms, descriptions et JSON Schema des définitions MCP.

### 7.2 Images

`Attachment` reçoit des dimensions optionnelles, calculées en mémoire lors de la
sélection ou du collage. Ces dimensions ne sont pas persistées comme binaire.

La stratégie image suit cet ordre :

1. formule documentée pour un fournisseur et un modèle connus ;
2. estimation conservatrice à partir des dimensions ;
3. réserve fixe conservatrice quand les dimensions sont indisponibles.

La chaîne Base64 n’est jamais encodée par tiktoken et sa longueur n’entre jamais
dans la formule. Elle n’apparaît pas dans les diagnostics.

### 7.3 Sortie et marge

Sans override, la réserve de génération vaut 20 % de la fenêtre, bornée entre
1 024 et 8 192 tokens. Elle ne peut jamais rendre le budget d’entrée négatif.

Une marge supplémentaire couvre :

- l’écart de tokenizer ;
- les enveloppes spécifiques au fournisseur ;
- les légères différences de sérialisation.

Le paramètre interne `maxOutputTokens` est traduit par l’adaptateur :

- `max_completion_tokens` pour l’API OpenAI officielle lorsque requis ;
- `max_tokens` pour les endpoints OpenAI compatibles, dont LM Studio.

Cette traduction reste dans l’adaptateur, pas dans le planificateur.

## 8. RAG local des connaissances Markdown

### 8.1 Éligibilité inchangée

Un helper unique remplace le code dupliqué entre envoi et récupération. Il
reproduit exactement la sélection globale et par conversation décrite en 2.1.
Le RAG ne recherche jamais dans un document non éligible.

### 8.2 Découpage

Le découpage construit une vue dérivée sans écrire dans `knowledge.content`.

Règles :

- normaliser les fins de ligne uniquement dans la vue de travail ;
- suivre le chemin des titres Markdown de niveau 1 à 6 ;
- conserver le titre parent comme métadonnée de chaque passage ;
- grouper les paragraphes tant que la cible de tokens n’est pas dépassée ;
- conserver les listes avec leur introduction lorsque possible ;
- ne pas couper un bloc de code ordinaire ;
- scinder un bloc de code exceptionnellement trop grand par lignes, avec une
  référence de continuation, plutôt que rendre tout le document inutilisable ;
- ne jamais fabriquer ni supprimer du contenu dans l’original.

Chaque passage reçoit : identifiant du document, empreinte du contenu, index,
chemin des titres, texte dérivé et estimation de tokens.

### 8.3 Index et cache

Un cache mémoire indexé par `knowledge.id + empreinte(content)` conserve les
passages et statistiques lexicales. Une modification change l’empreinte et
invalide naturellement l’entrée. Une suppression la rend inaccessible lors de la
prochaine sélection.

Aucune table de chunks ni index FTS n’est ajouté dans cette livraison.

### 8.4 Requête de recherche

La requête locale combine :

- le message utilisateur courant, y compris le texte explicitement joint ;
- un contexte conversationnel récent strictement borné ;
- les termes techniques, identifiants et chemins détectés.

Cette extension permet de retrouver un passage pertinent pour une question comme
« et maintenant ? » sans envoyer tout l’historique au retriever.

Le contenu de la requête n’est jamais journalisé.

### 8.5 Classement

Le classement utilise BM25 avec :

- boost du nom de document ;
- boost du chemin de titres ;
- boost des correspondances exactes d’identifiants techniques ;
- pénalité des doublons proches ;
- diversification entre documents lorsque plusieurs scores sont comparables ;
- coût en tokens pris en compte lors de la sélection finale.

Le moteur retourne les meilleurs passages qui tiennent dans le budget alloué. Un
score nul n’oblige pas l’injection d’un document sans rapport.

### 8.6 Injection et références

Les passages sont injectés dans une section dédiée, séparée des instructions de
base. Chaque passage porte un alias court :

```text
[K1] HISE — Interface > Éditeur de scripts — passage 3
…extrait pertinent…
```

Le prompt demande au modèle d’utiliser ces alias lorsqu’une attribution est
utile. `ContextPlan` conserve la correspondance complète. Les diagnostics ne
gardent que `documentId`, l’empreinte courte et `chunkIndex`, jamais le nom, les
titres ou le contenu privé.

`messages.sources` reste réservé aux sources Web validées ; les références de
connaissances ne sont pas mélangées à ce contrat.

## 9. Sélection de l’historique

### 9.1 Tours cohérents

Les lignes SQLite sont regroupées en tours utilisateur/assistant. Une erreur ou
une interruption reste associée au message utilisateur qui la précède. Le moteur
évite de conserver une réponse ancienne sans sa question.

Le message utilisateur courant est identifié explicitement et n’est jamais
considéré comme un candidat optionnel.

### 9.2 Priorités

Après les éléments obligatoires, le planificateur :

1. tente de conserver les tours complets les plus récents ;
2. classe les tours plus anciens selon leur pertinence pour la question actuelle ;
3. sélectionne les candidats dans le budget ;
4. restaure leur ordre chronologique avant l’appel fournisseur.

Un tour optionnel trop grand est écarté comme unité cohérente plutôt que tronqué
silencieusement. La raison apparaît dans les statistiques.

### 9.3 Absence de synthèse dans cette livraison

Aucun appel LLM supplémentaire n’est effectué pour résumer l’historique. Ce choix
évite latence, coût, nouvelles erreurs et déformation d’étapes techniques.

`ContextPlanner` accepte néanmoins à terme une section optionnelle de mémoire.
L’ajout futur d’un `ConversationMemoryProvider` ne changera ni le RAG, ni le
budget, ni la source complète dans `messages`.

## 10. Allocation du budget

### 10.1 Éléments obligatoires

Sont obligatoires et jamais tronqués silencieusement :

- instructions générales ;
- profil ;
- garde-fou Web lorsqu’il s’applique ;
- message utilisateur courant et fichier texte courant ;
- images courantes, avec leur coût estimé ;
- réserve de sortie ;
- marge de sécurité ;
- définitions des outils effectivement présentés pour ce tour.

Si ces éléments dépassent la fenêtre, le réseau n’est pas appelé.

### 10.2 Éléments adaptatifs

Le reste du budget est partagé entre :

- tours récents ;
- passages de connaissances ;
- anciens tours pertinents ;
- résultats MCP lors des tours suivants.

Les quotas internes sont souples : une catégorie peut emprunter l’espace inutilisé
d’une autre. Les constantes et priorités sont centralisées et couvertes par des
tests de propriétés, pas dispersées dans les composants.

### 10.3 Condition finale

Pour chaque tour :

```text
entrée estimée
+ sortie réservée
+ marge de sécurité
<= fenêtre effective
```

Le planificateur effectue une dernière estimation sur la requête réellement
sérialisable. Si elle échoue encore, il retire les candidats optionnels les moins
utiles, puis bloque plutôt que d’envoyer une requête vouée à l’échec.

## 11. MCP sous le même budget

### 11.1 Définitions d’outils

Les noms, descriptions et schémas de tous les outils offerts au tour sont comptés.
Si les seuls outils actifs empêchent les éléments obligatoires de tenir, LogAssist
signale explicitement que le catalogue MCP actif est trop volumineux. Aucun outil
autorisé n’est retiré silencieusement.

Le repli existant après rejet de `tools` est replanifié sans définitions d’outils,
ce qui libère naturellement leur budget.

### 11.2 Résultats

La limite de 120 000 caractères reste une défense mémoire supérieure, mais la
limite effective devient le nombre de tokens encore disponible.

Avant chaque nouveau tour LLM :

1. envelopper le résultat externe comme donnée non fiable ;
2. estimer son coût avec les messages et outils déjà présents ;
3. conserver les segments qui tiennent, aux frontières de paragraphes ou
   structures JSON lorsque possible ;
4. ajouter une marque explicite si une partie a été omise ;
5. replanifier l’historique et les connaissances optionnels ;
6. bloquer si les obligations du protocole outil ne peuvent plus tenir.

Le Base64 des médias MCP reste séparé et n’est jamais injecté au modèle, comme
aujourd’hui.

### 11.3 Tous les chemins couverts

La garde s’applique à :

- premier tour avec outils ;
- second tour avec outils ;
- tour final `toolChoice: "none"` ;
- reprise unique sans outils pour incompatibilité ;
- retry et régénération utilisant des outils.

## 12. Intégration dans `useChat`

### 12.1 Envoi normal

L’ordre anti-perte reste :

1. valider localement la présence de contenu ;
2. afficher et persister le message utilisateur ;
3. créer la bulle assistant ;
4. charger les sources de contexte ;
5. préparer le plan ;
6. exécuter le tour borné ;
7. persister réponse, interruption ou erreur ;
8. libérer `busy` après les écritures.

Un dépassement détecté aux étapes 4 ou 5 intervient après la persistance
utilisateur. `send()` retourne donc `true` et une bulle assistant matérialise
l’erreur, conformément au contrat actuel.

### 12.2 Retry et régénération

`createRecoveryPlan()` continue de déterminer l’admissibilité et d’exclure la
réponse cible. Le résultat complet devient ensuite une source pour le même moteur
de contexte.

Une régénération échouée, y compris pour contexte insuffisant, ne remplace pas
l’ancienne réponse. Un retry d’une erreur de contexte peut réussir après un
changement de modèle ou de réglage sans dupliquer le message utilisateur.

### 12.3 Pièces jointes

- le texte joint au message courant reste intégral et obligatoire ;
- si ce texte seul ne tient pas, l’envoi fournisseur est bloqué explicitement ;
- l’image courante reste éphémère et transmise sans persistance Base64 ;
- aucune ancienne image vide n’est réinjectée.

## 13. Erreurs

### 13.1 Nouveau type

`ApiErrorKind` ajoute `context_length`. `KIND_TO_KEY` et `src/i18n/fr.ts` ajoutent
le libellé correspondant. Le garde-fou `errors.i18n.test.ts` garantit la
complétude.

Le message utilisateur explique que le contexte obligatoire dépasse la fenêtre
du modèle et propose des actions sûres : choisir un modèle/fenêtre adapté, réduire
la pièce jointe courante ou désactiver des outils inutiles. Il ne conseille pas de
supprimer l’historique ou les documents.

### 13.2 Classification fournisseur

Les réponses fournisseur mentionnant un dépassement (`n_ctx`, `n_keep`, context
length, prompt too long) sont normalisées en `context_length`. Elles invalident le
cache de capacité afin qu’une relance puisse redécouvrir la fenêtre chargée.

Cette classification reste secondaire : le but principal est de détecter le
dépassement avant le réseau.

### 13.3 Détails persistés

La ligne `messages.error` ne contient aucun extrait de contexte. Elle conserve un
payload public et rédigé. Les statistiques détaillées restent uniquement dans le
log debug de développement.

## 14. Diagnostic de contexte

Un seul événement structuré `context.plan` est émis en mode debug :

```ts
interface SafeContextDiagnostic {
  modelId: string
  contextWindowTokens: number
  contextWindowSource: ContextWindowSource
  tokenizer: "openai_tiktoken" | "conservative"
  tokens: {
    system: number
    knowledge: number
    history: number
    currentUser: number
    images: number
    tools: number
    mcpResults: number
    outputReserve: number
    safetyMargin: number
    total: number
  }
  selected: {
    knowledge: Array<{ documentId: string; fingerprint: string; chunkIndex: number }>
    historyMessages: number
    historyTurns: number
  }
  omitted: {
    knowledgeChunks: number
    historyTurns: number
    mcpSegments: number
    reasons: string[]
  }
}
```

Sont interdits dans cet objet :

- clé API ou secret MCP ;
- headers d’authentification ;
- texte des messages ;
- contenu ou nom de document ;
- chemin de titres privé ;
- arguments ou résultats MCP bruts ;
- URL privée ;
- Base64 ou dimensions permettant de reconstruire une image.

Des tests passent une sentinelle sensible dans chaque catégorie et vérifient son
absence de la sérialisation du diagnostic.

## 15. Persistance et données existantes

- `knowledge.content` n’est jamais tronqué, normalisé en base ni remplacé.
- `conversation_knowledge` garde sa sémantique actuelle.
- `messages` garde l’historique complet.
- `messages.sources` garde seulement les sources Web validées.
- les images utilisateur restent éphémères.
- les médias MCP suivent leur stockage actuel et ne deviennent pas du contexte
  historique.
- V11 ajoute seulement deux colonnes nullable aux modèles.

Aucune migration destructive, aucun backfill volumineux et aucune réindexation
persistante ne sont nécessaires.

## 16. Sécurité et confidentialité

Les invariants existants restent obligatoires :

- secrets uniquement dans le Credential Manager ;
- SQL entièrement paramétré ;
- aucun `dangerouslySetInnerHTML` ou HTML brut ;
- contenu MCP externe toujours traité comme non fiable ;
- aucun résultat MCP brut persisté ;
- aucune image Base64 dans les messages, diagnostics ou erreurs ;
- détails fournisseur rédigés avant affichage, log ou persistance ;
- aucun contenu privé envoyé à un service d’indexation ou d’embeddings.

Le RAG s’exécute intégralement dans l’application locale.

## 17. Performance

- cache des chunks par empreinte de document ;
- cache court des capacités fournisseur ;
- index lexical construit uniquement pour les documents éligibles ou réutilisé ;
- encodeur tiktoken réutilisé de manière bornée puis libéré ;
- aucune estimation dans le rendu React ou à chaque delta ;
- une seule préparation initiale, puis des replanifications incrémentales pour les
  tours MCP ;
- limites explicites sur nombre de chunks, taille de termes et candidats classés.

Un benchmark de bibliothèque synthétique volumineuse vérifie que la préparation
reste interactive. Il ne remplace pas les tests fonctionnels.

## 18. Stratégie de tests TDD

### 18.1 Capacités et estimation

- override manuel prioritaire ;
- LM Studio : instance chargée à 8 192 malgré un maximum supérieur ;
- plusieurs instances : plus petite fenêtre compatible ;
- métadonnée OpenRouter/générique ;
- réponse malformée ignorée ;
- fallback 4 096 ;
- tiktoken seulement pour modèle explicitement connu ;
- estimation conservative Unicode/code/CJK ;
- enveloppes et schémas d’outils comptés ;
- image comptée sans encoder son Base64 ;
- réserve et marge ne dépassant jamais la fenêtre.

### 18.2 Markdown et RAG

- titres imbriqués ;
- paragraphes, listes et blocs de code ;
- bloc de code géant scindé proprement ;
- contenu original non muté ;
- invalidation par empreinte ;
- boost document/titre/identifiant ;
- diversification ;
- aucun passage non pertinent forcé ;
- bibliothèque synthétique volumineuse ;
- références stables et diagnostic sans contenu privé.

### 18.3 Sélections de connaissances

- sélection globale quand aucun override n’existe ;
- sélection de conversation non vide remplaçant la globale ;
- document désactivé exclu même s’il est référencé ;
- ordre déterministe ;
- même résultat en envoi, retry et régénération.

### 18.4 Historique et planification

- conversation courte inchangée ;
- conversation longue bornée ;
- message courant toujours présent et intégral ;
- fichier texte courant toujours présent ou erreur explicite ;
- tours récents prioritaires ;
- ancien tour pertinent récupéré ;
- ordre chronologique restauré ;
- tour trop grand écarté comme unité ;
- aucun DELETE/UPDATE des messages ;
- overflow obligatoire bloqué avant fournisseur.

### 18.5 MCP

- coût des définitions d’outils ;
- résultat volumineux réduit selon les tokens disponibles ;
- marque d’omission présente ;
- Base64 média jamais injecté ;
- premier, second et dernier tours tous gardés ;
- repli sans outils replanifié ;
- catalogue d’outils obligatoire trop grand produisant une erreur explicite ;
- limites de deux tours et quatre appels préservées ;
- usage agrégé préservé.

### 18.6 Intégration React et persistance

- `send()` retourne `false` seulement avant persistance utilisateur ;
- overflow après insert retourne `true` avec erreur assistant ;
- retry sans nouveau message utilisateur ;
- régénération en échec conserve l’ancienne réponse ;
- interruption conserve l’accumulé ;
- vision et streaming inchangés ;
- diagnostics sans secrets, contenus, résultats bruts ou Base64 ;
- migration V11 fraîche et depuis V10 ;
- couverture i18n du nouveau kind.

## 19. Validation

Le travail se fait dans `feat/context-engine-rag`, sans worktree.

Ordre de validation :

1. tests rouges puis verts ciblés sous PowerShell/Windows ;
2. TypeScript strict ;
3. suite Vitest complète ;
4. build Vite via `npm run build` sous Windows ;
5. tests Rust ;
6. `cargo clippy --all-targets -- -D warnings` ;
7. vérification manuelle avec LM Studio et une fenêtre chargée à 8 192 ;
8. conversation longue, bibliothèque volumineuse, image et tour MCP volumineux ;
9. contrôle que le fournisseur n’est pas appelé lors d’un overflow local.

Aucun `npm install` ne sera lancé depuis WSL.

## 20. Paliers d’implémentation

1. **Fondations** : types, erreur, migration, capacités et estimateurs.
2. **RAG** : chunking Markdown, cache, BM25 et références.
3. **Planificateur** : historique, allocation et diagnostics.
4. **Chat** : envoi, retry, régénération et réglages modèle.
5. **MCP** : garde de tous les tours et résultats bornés en tokens.
6. **Consolidation** : tests volumineux, gates Windows/Rust et documentation.

Chaque palier laisse la branche testable et reçoit ses tests avant le code de
production. Un échec de gate bloque le palier suivant.

## 21. Critères d’acceptation

- Une grande bibliothèque active n’est plus concaténée intégralement.
- Les extraits pertinents respectent les titres Markdown et portent leur source.
- Les documents originaux et l’historique SQLite restent intacts.
- Une longue conversation envoie une projection récente et pertinente.
- Le message et les pièces jointes courants ne sont jamais tronqués en silence.
- La fenêtre réellement chargée de LM Studio est utilisée lorsqu’elle est
  disponible.
- Un modèle inconnu utilise un repli prudent et modifiable.
- Tiktoken n’est pas présenté comme universel.
- Le coût image ne dépend jamais de la taille Base64.
- Tous les appels directs, retry, régénération et MCP passent par la même garde.
- Les résultats MCP respectent un budget en tokens.
- Un contexte impossible est bloqué avant le réseau avec une erreur claire.
- Les logs debug donnent des compteurs utiles sans contenu privé.
- Streaming, annulation, vision, outils, sources, persistance et contrat
  `useChat.send()` restent couverts.
- Tests, TypeScript, build Windows, tests Rust et Clippy passent.

## 22. Limites assumées

- Le tokenizer exact d’un modèle local peut rester indisponible ; l’estimation
  conservatrice et la marge réduisent le risque sans promettre l’exactitude.
- Le BM25 ne comprend pas toutes les paraphrases. L’interface permettra un moteur
  hybride local ultérieur.
- Aucun résumé automatique ne conserve les faits d’anciens tours non sélectionnés.
  La pertinence historique et la récence constituent le repli déterministe.
- Certains fournisseurs ne publient aucune fenêtre ; l’override manuel reste alors
  l’autorité la plus fiable.
- Les références de connaissances indiquent les extraits fournis au modèle, pas la
  preuve que chaque extrait a effectivement influencé sa réponse.

## 23. Références

- `AGENTS.md` du dépôt.
- `docs/superpowers/specs/2026-11-05-chat-engine-modernization-design.md`.
- Documentation LM Studio, `GET /api/v1/models` :
  <https://lmstudio.ai/docs/developer/rest/list>.
- Documentation OpenAI Chat Completions et comptage des entrées image, consultée
  pour distinguer texte, outils et images sans généraliser tiktoken.
