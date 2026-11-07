# Ajustements de la galerie des fournisseurs — Design

## Contexte

La branche `feat/modal-fournisseurs-galerie` contient déjà la première version de la
galerie des fournisseurs. Les essais visuels demandent trois ajustements ciblés :

1. rendre le modal légèrement moins haut et plus large ;
2. garantir que la carte « Ajouter un fournisseur » ait exactement les mêmes
   dimensions que les cartes des fournisseurs ;
3. ajouter une recherche des fournisseurs par nom ou URL.

## Périmètre

Les changements restent dans l’onglet « Fournisseurs » de
`src/components/settings/SettingsDialog.tsx`. L’onglet « Modèles local », le formulaire
de fournisseur et le sélecteur de modèles ne changent pas.

## Dimensions du modal

Le conteneur du dialog utilisera :

```text
w-[1100px] max-w-[96vw] max-h-[75vh]
```

Le dialog reste centré, responsive et limité par la largeur de la fenêtre. Son contenu
vertical continue à défiler lorsqu’il dépasse `75vh`.

## Cartes de dimensions identiques

La galerie conserve le ratio `aspect-[16/9]`.

La carte d’ajout et les cartes fournisseurs partageront les mêmes contraintes de boîte :

- largeur complète de leur cellule de grille ;
- ratio 16:9 ;
- `overflow-hidden` pour empêcher le contenu d’agrandir la carte ;
- contenu interne organisé en flexbox.

Dans une carte fournisseur, la zone centrale utilisera `min-h-0 overflow-y-auto`. Une
longue liste de modèles défilera donc à l’intérieur de la carte au lieu de modifier sa
hauteur. Cette approche conserve le format 16:9 sur toutes les cartes.

## Recherche des fournisseurs

Une barre de recherche sera placée sous les onglets et au-dessus de la grille.

### Comportement

- filtrage instantané côté React, sans requête SQL supplémentaire ;
- recherche insensible à la casse ;
- correspondance partielle sur `provider.name` ou `provider.base_url` ;
- suppression des espaces en début et fin de requête ;
- la carte « Ajouter un fournisseur » reste visible pendant une recherche ;
- la recherche n’altère pas la liste originale chargée depuis SQLite.

Le filtrage sera calculé à partir de l’état `rows` et d’un nouvel état local
`providerQuery`.

### États vides

- Si aucun fournisseur n’est enregistré, conserver le message existant
  `t.settings.noProviders`.
- Si des fournisseurs existent mais qu’aucun ne correspond à la recherche, afficher
  une nouvelle chaîne i18n : « Aucun fournisseur ne correspond à votre recherche. »

## Accessibilité et i18n

- La barre de recherche aura un label accessible issu de `src/i18n/fr.ts`.
- Son placeholder sera également issu de `src/i18n/fr.ts`.
- Une icône de recherche décorative pourra être affichée avec `aria-hidden="true"`.
- Aucun texte d’interface ne sera écrit directement dans le composant.

Nouvelles clés proposées dans `t.settings` :

- `searchProviders` : « Rechercher un fournisseur » ;
- `searchProvidersPlaceholder` : « Rechercher par nom ou URL… » ;
- `noProviderResults` : « Aucun fournisseur ne correspond à votre recherche. »

## Tests

Les tests de `SettingsDialog` couvriront :

1. le filtrage d’un fournisseur par son nom ;
2. le filtrage par son URL ;
3. l’insensibilité à la casse ;
4. l’affichage du message sans résultat ;
5. la présence permanente de la carte d’ajout pendant le filtrage.

Les tests métier existants (connexion, récupération des modèles, suppression et
sélection de modèle) doivent continuer à passer.

## Invariants du projet

- aucun secret dans SQLite, le DOM ou les logs ;
- aucun `console.log` ;
- aucun `dangerouslySetInnerHTML` ;
- aucune couleur orange ;
- toutes les chaînes UI passent par `src/i18n/fr.ts` ;
- les fonctionnalités existantes du modal restent inchangées.

## Critères d’acceptation

- le modal utilise `w-[1100px] max-w-[96vw] max-h-[75vh]` ;
- la carte d’ajout et les cartes fournisseurs ont la même taille réelle ;
- une longue liste de modèles ne déforme aucune carte ;
- la barre de recherche se trouve sous les onglets ;
- la recherche filtre instantanément par nom ou URL, sans tenir compte de la casse ;
- les états « aucun fournisseur » et « aucun résultat » sont distincts ;
- la carte d’ajout reste disponible pendant une recherche ;
- les tests ciblés et le contrôle TypeScript passent.
