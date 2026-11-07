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

Ce standard s’applique aux modales principales, notamment :

- Fournisseurs ;
- System Prompt et connaissances ;
- MCP.

Les sous-modales contextuelles, comme le sélecteur de modèles ou le formulaire
d’une connaissance, conservent une taille adaptée à leur contenu.

## Galerie des fournisseurs

La galerie affiche quatre cartes par ligne dans le gabarit desktop des outils
du header. Elle passe à trois, deux puis une colonne lorsque la largeur diminue.

Les cartes utilisent le format compact de référence :

- hauteur minimale : `14rem` (`min-h-56`) ;
- grille interne des actions : trois colonnes égales ;
- icônes d’action : `1.25rem` dans une empreinte de `1.5rem` ;
- libellés d’action : `11px` ;
- bouton inférieur : taille `text-xs` et padding vertical compact.

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
