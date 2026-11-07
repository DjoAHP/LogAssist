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

Ce standard s’applique aux modales principales, notamment :

- Fournisseurs ;
- System Prompt et connaissances ;
- MCP.

Les sous-modales contextuelles, comme le sélecteur de modèles ou le formulaire
d’une connaissance, conservent une taille adaptée à leur contenu.
