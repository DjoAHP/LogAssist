# Design system LogAssist

## Couleurs de marque

- Bleu gris : `#9FBFD6` via `--brand-from`.
- Cyan : `#27C8D6` via `--brand-to`.
- Un bouton utilisant `bg-brand-from` utilise aussi `text-brand-foreground`.

## Modales des outils du header

Toutes les modales principales ouvertes depuis la zone d’outils située à droite
du header utilisent le même gabarit :

- largeur : `1100px` ;
- hauteur : `75vh` ;
- largeur maximale responsive : `96vw` ;
- contenu excédentaire : défilement vertical interne.

Le token partagé se trouve dans :

`src/components/settings/headerToolDialog.ts`

Chaque nouvel outil du header doit importer `HEADER_TOOL_DIALOG_SIZE_CLASS`.
Il ne doit pas définir une largeur ou une hauteur locale concurrente.

Le libellé du bouton et le titre du modal utilisent le même nom fonctionnel.
Une icône `size-4`, secondaire et discrète, apparaît immédiatement à droite du
titre :

| Outil | Libellé du header | Titre du modal | Icône |
|---|---|---|---|
| MCP | MCP | MCP | `McpIcon` |
| System Prompt | Assistant | Assistant | `BookIcon` |
| Models settings | Fournisseurs | Fournisseur | `ReglageIcon` |
| Paramètres généraux | Paramètres généraux | Paramètres généraux | `ParaGenIcon` |

Ce standard s’applique aux modales principales, notamment :

- Fournisseurs ;
- System Prompt et connaissances ;
- MCP.

Les sous-modales contextuelles, comme le sélecteur de modèles ou le formulaire
d’une connaissance, conservent une taille adaptée à leur contenu.

## Galerie des connecteurs

La catégorie **Connecteurs** se trouve dans Paramètres généraux. Elle utilise une
grille responsive de tuiles carrées `2 → 3 → 4` colonnes :

- tuile : `aspect-square`, `rounded-lg`, bordure `border-border` ;
- icône : `size-8`, couleur héritée, accent `brand-from` au survol ;
- statut : texte obligatoire sous le nom, vert si connecté et neutre sinon ;
- focus : `focus-visible:ring-2 focus-visible:ring-brand-to`.

GitHub utilise `GithubConnecteurIcon`, générée depuis
`src/icons/svg/github_connecteur.svg`. Le composant inline conserve le `viewBox`
512 × 512, la transformation et les 30 chemins du fichier source. Seul le
remplissage devient `currentColor` afin de suivre automatiquement le thème ; aucun
trait d'épaississement n'est ajouté.

La configuration GitHub et le sélecteur de dépôt sont des sous-modales. Le bouton
GitHub de l'InputBar se place immédiatement à gauche du textarea. Il partage
strictement le gabarit Image/Fichier/Web : hauteur `38px`, bordure et fond standards,
padding horizontal `px-3`, icône `size-4`, survol et états désactivés identiques.
Une liaison active affiche une puce `owner/repo@ref` séparée du bouton afin d'éviter
tout bouton HTML imbriqué.
Si le jeton manque, la puce affiche **Dépôt indisponible** et reste détachable.

## Galerie des fournisseurs

La galerie affiche quatre cartes par ligne dans le gabarit desktop des outils
du header. Elle passe à trois, deux puis une colonne lorsque la largeur diminue.

Les cartes utilisent le format compact de référence :

- hauteur minimale : `14rem` (`min-h-56`) ;
- grille interne des actions : trois colonnes égales ;
- icônes d’action : `1.25rem` dans une empreinte de `1.5rem` ;
- libellés d’action : `11px` ;
- bouton inférieur : taille `text-xs` et padding vertical compact.

## Galerie MCP

La galerie MCP affiche les serveurs en **lignes empilées** (une ligne par serveur) au lieu d'une grille de cartes.

### Barre d'actions (header de la galerie)

- Recherche à gauche, occupant l'espace disponible.
- À droite, deux boutons dans l'ordre : **« Importer JSON »** (secondaire : `border border-border`, `hover:bg-foreground/5`) puis **« Ajouter un serveur »** (primaire : `bg-brand-from`, `text-brand-foreground`, icône `Plus` à gauche). Hauteur standard des boutons LogAssist (`px-3 py-1.5`, `text-sm`).

### Ligne de serveur (remplace l'ancienne carte `min-h-56`)

Chaque ligne est un `<li role="listitem">` avec `data-testid="mcp-server-card"`, affichage horizontal compact :

| Zone | Contenu | Style |
|------|---------|-------|
| 1. Identité | Nom (gras) + badge « Intégré » si `builtin` + URL en dessous (gris, tronquée) | `flex-1`, `text-sm` / `text-xs` |
| 2. État | Icône (3,5) + libellé, largeur fixe `min-w-[120px]` pour aligner les boutons | Tonalité par état : connecté → `text-green-600 dark:text-green-400`, échecs → `text-destructive`, neutres → `text-muted-foreground` |
| 3. Actions (icônes) | Tester 📡, Actualiser ⟳, Modifier 🔧, **Supprimer** 🗑️ (non-builtin seulement) | `rounded-md p-1.5`, `hover:bg-foreground/5`, focus visible `ring-brand-to` |
| 4. Parcourir | Bouton texte « Parcourir les outils (N) » | Contour `border-border`, `hover:border-brand-to` |
| 5. Toggle | « Activer/Désactiver le serveur » + checkbox | `size-4 accent-brand-from`, désactivé si pas `canEnable` |

- TinyFish (`builtin: true`) : badge « Intégré », **pas de bouton Supprimer**, même structure sinon.
- États réseau : texte + icône + **couleur** respectée (voir `statusToneClass` dans `McpServerCard.tsx`).
- Espacement vertical entre lignes : `gap-2` ; pas de hauteur minimale imposée.

### Mise à jour de la galerie des fournisseurs (inchangée)

La galerie des fournisseurs conserve sa grille 4→3→2→1 colonnes et ses cartes `min-h-56`.

## Messages du chat

Les questions utilisateur et les réponses assistant partagent la même surface
glassmorphism légère :

- rayon : `rounded-xl` ;
- fond : `bg-background/40` ;
- flou : `backdrop-blur-sm` ;
- bordure : `border-border/50` ;
- aucune ombre ajoutée, afin de garder l’effet discret.

La réponse assistant conserve son accent cyan à gauche. Les erreurs utilisent
le même rayon, avec leur fond et leur bordure destructifs.
