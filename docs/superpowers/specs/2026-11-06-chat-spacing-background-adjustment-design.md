# Design — Ajustement du fond et des marges du chat

**Date :** 2026-11-06

**Statut :** validé par l’utilisateur

**Branche :** `feat/chat-engine-palier-1`

## Intention

Conserver la présentation hybride du palier 2A tout en rapprochant les échanges des bords de la zone de chat et en redonnant aux réponses assistant le même voile translucide que les questions.

## Changements

### Fond des réponses assistant

- Remplacer `bg-transparent` par `bg-foreground/5` sur les réponses assistant normales.
- Conserver le filet gauche `border-l-[var(--brand-to)]`.
- Ne pas modifier les bulles d’erreur destructives.
- Ne pas ajouter de nouvelle couleur.

### Marges latérales

- Remplacer la largeur centrale `max-w-5xl` par `max-w-[90rem]`.
- Conserver le padding extérieur actuel.
- Conserver l’alignement à gauche des réponses et à droite des questions.
- Conserver les limites individuelles `max-w-[56rem]` pour une réponse et `max-w-[80%]` pour une question.

## Non-objectifs

- Aucun changement d’auto-scroll.
- Aucun changement du moteur, de SQLite, des fournisseurs, de MCP ou de Rust.
- Aucun changement du Markdown, des images, sources, métriques ou actions.
- Aucun changement des thèmes ou des variables de marque.

## Tests

- La réponse assistant normale contient `bg-foreground/5` et ne contient plus `bg-transparent`.
- La question conserve son fond translucide.
- La zone centrale utilise `max-w-[90rem]`.
- Les erreurs conservent leur style destructif.
- Les tests `ChatView`, le garde-fou de couleurs et TypeScript restent verts.

## Critères de réussite

- Les réponses retrouvent le voile visuel des questions.
- Les échanges sont sensiblement plus proches des bords sur grand écran.
- La présentation reste immédiatement reconnaissable comme LogAssist.
