# Refonte des cartes fournisseur

Date : 7 novembre 2026
Branche : `feat/redesign-cartes-fournisseurs`

## Contexte

La galerie affiche aujourd’hui des cartes horizontales au format 16:9. Chaque
carte mélange l’identité du fournisseur, la liste de ses modèles, quatre actions
et plusieurs messages de statut. Cette densité réduit la hiérarchie visuelle et
donne peu de présence aux commandes principales.

La référence fournie dans `final.png` organise la carte en quatre zones :

1. nom, URL et suppression ;
2. séparation horizontale ;
3. test de connexion, récupération des modèles et modification ;
4. bouton pleine largeur pour parcourir les modèles.

## Objectifs

- Reprendre cette structure dans l’identité visuelle de LogAssist.
- Donner plus de présence aux actions sans surcharger la galerie.
- Conserver les comportements, messages d’erreur et protections existants.
- Assurer un rendu cohérent dans les thèmes clair et sombre.
- Améliorer la navigation clavier et l’annonce des états asynchrones.

## Hors périmètre

- Aucun changement de base de données ou de service IA.
- Aucun changement du formulaire fournisseur ni de `ModelPickerModal`.
- Aucune nouvelle fonctionnalité de gestion des modèles.
- Aucune création d’icône dans `djodev-icons` pour cette livraison.

## Direction visuelle

La carte suit une direction « console fournisseur » : fond nuancé, bordure
précise, profondeur légère et accents issus de `--brand-from` et `--brand-to`.
Le survol renforce la bordure et le reflet de marque sans déplacer la carte.
Le rendu reste sobre afin de s’intégrer aux réglages existants.

La galerie affiche trois colonnes sur grand écran, deux sur largeur moyenne et
une sur petite largeur. Les cartes adoptent un format presque carré. La carte
« Ajouter un fournisseur » suit la même hauteur et la même grille.

### En-tête

- Le nom du fournisseur occupe la première ligne et reste tronqué s’il déborde.
- L’URL apparaît en dessous avec une couleur secondaire. Sa valeur complète
  reste disponible au survol et pour les technologies d’assistance.
- Le bouton de suppression se place en haut à droite. Il reste neutre au repos
  et prend le style destructif au survol ou au focus.
- Une ligne fine sépare l’en-tête des actions.

### Actions

Trois boutons de même largeur forment la zone centrale :

- `RadioTower` : Tester la connexion ;
- `CloudDownload` : Récupérer les modèles ;
- `Wrench` : Modifier.

Chaque bouton comprend une icône Lucide, un libellé centré sur deux lignes au
maximum et une zone de statut réservée. Toute la cellule est cliquable. Les
icônes Lucide garantissent une famille visuelle cohérente et correspondent à la
référence. Leur remplacement par des SVG personnels fera l’objet d’un chantier
séparé.

### Action principale

Le bouton `Parcourir les modèles (n)` occupe toute la largeur en bas de carte.
Sa bordure et son état de survol emploient les couleurs de marque. Le compteur
reflète le nombre de modèles actuellement chargés pour le fournisseur.

La liste détaillée des modèles disparaît de la carte. `ModelPickerModal` reste
le point d’accès à cette liste.

## Architecture

### `ProviderCard`

Un nouveau composant de présentation reçoit :

- le fournisseur ;
- le nombre de modèles ;
- l’état du test de connexion ;
- l’état de récupération des modèles ;
- les callbacks de test, récupération, modification, suppression et parcours.

Le composant ne dépend ni de SQLite, ni du Credential Manager, ni d’un
adaptateur IA. Il rend la carte et transmet les interactions au parent.

Un sous-composant interne `ProviderAction` uniformise la structure, les styles
et les états des trois cellules d’action. Il ne mérite pas de fichier séparé
tant qu’aucun autre écran ne le réutilise.

### `SettingsDialog`

`SettingsDialog` reste l’orchestrateur. Il conserve les appels à
`createProvider`, `secrets`, `providers`, le dialogue natif de suppression et
l’ouverture des deux modales existantes. Il construit les propriétés de chaque
`ProviderCard` à partir de ses états actuels.

Cette limite évite de déplacer la logique métier pendant une refonte visuelle.

## Flux et états

### Test de connexion

1. L’utilisateur active la cellule de test.
2. `SettingsDialog` place le fournisseur dans l’état `testing`.
3. La cellule désactive son bouton et affiche un indicateur de chargement.
4. La cellule affiche ensuite un succès ou un échec.

### Récupération des modèles

Le flux existant reste inchangé : lecture de la clé, appel distant,
dédoublonnage, insertion puis rafraîchissement. Pendant l’appel, seule la
cellule de récupération est désactivée. Après succès, son statut indique le
nombre ajouté et le compteur du bouton inférieur se met à jour.

### Erreurs

Les fonctions existantes continuent de filtrer les détails sensibles. Chaque
cellule réserve une zone où le message i18n peut revenir à la ligne sans modifier
la hauteur de la carte. Le message complet reste associé au bouton pour les
technologies d’assistance. La couleur accompagne toujours un texte et une icône.

La confirmation native protège toujours la suppression du fournisseur, de ses
modèles et de son secret.

## Accessibilité

- Tous les contrôles utilisent des éléments `button` avec `type="button"`.
- Chaque icône décorative porte `aria-hidden="true"`.
- Les statuts asynchrones utilisent une zone `aria-live` adaptée.
- Le focus clavier emploie un anneau visible basé sur `--brand-to`.
- Les états désactivés restent lisibles dans les deux thèmes.
- Les animations respectent `prefers-reduced-motion`.
- Les textes tronqués conservent leur valeur complète dans un nom accessible.

## Tests

L’implémentation suit le TDD.

### Tests du composant

- affiche le nom, l’URL et le compteur ;
- déclenche chaque callback depuis le bon bouton ;
- désactive l’action concernée pendant son chargement ;
- affiche les états de succès et d’échec ;
- expose des noms accessibles et une zone de statut ;
- conserve une structure stable sans liste de modèles intégrée.

### Tests d’intégration

Les tests de `SettingsDialog` continuent de couvrir la recherche, le test de
connexion, la récupération, la suppression et l’ouverture de
`ModelPickerModal`. Les sélecteurs ciblent les attributs d’action plutôt que la
structure visuelle interne.

La validation finale comprend les tests ciblés, la suite complète et le build
Windows. La référence avant modification compte 43 fichiers et 499 tests
passants.

## Critères d’acceptation

- La galerie affiche trois cartes par ligne dans la largeur standard du dialogue.
- Chaque carte suit l’ordre visuel de la référence fournie.
- La liste des modèles n’apparaît plus dans la carte.
- Les cinq opérations existantes restent fonctionnelles : test, récupération,
  modification, suppression et parcours des modèles.
- Les états de test et de récupération apparaissent dans leur cellule d’action.
- Le design fonctionne en thème clair, en thème sombre et au clavier.
- Les tests existants et les nouveaux tests passent sans fuite de donnée sensible.
