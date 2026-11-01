# Design — Modal "Parcourir les modèles" (remplace le menu déroulant)

**Intention** : le menu déroulant cwd(::dropdown) des réglages fournisseur n'était pas pratique.
Remplacé par un modal plein de parcourt du modèle, demandé par l'utilisateur.

## Comportement demandé

1. Carte fournisseur : nom, URL, "Tester la connexion", "Récupérer les modèles", "Modifier", Corbeille
   (déjà présents) + en dessous un bouton **"Parcourir les modèles"** affichant le nombre de modèles.
2. Clic → modal (par-dessus les réglages) contenant, réunis :
   - barre de recherche (filtre la liste),
   - champ d'ajout textuel + bouton (comme avant) : ajoute le modèle en base,
   - la liste complète des modèles du fournisseur (ceux en base ; la récupération les y écrit déjà),
   - défaut indiqué par une étoile ;
   - **clic sur un modèle → le définir comme modèle actif** (mécanique `setDefaultModel` existante,
     is_mode GLOBAL : un seul modèle actif pour tout le chat), puis le modal se ferme.
3. Le composant `ModelDropdown` est supprimé.

## Approches envisagées

- **A. Modal dédié (retenu)** : composant épuré `ModelPickerModal`, props mode muet
  (données via props, actions via callbacks). Testable, réutilisable, séparé du dialog réglages.
- B. Slam state dans SettingsDialog : rejeté (composant déjà dense, testabilité en berne).
- C. Fusionner dans ProviderForm : rejeté (la carte doit rester lisible et stable).

## Détails

- Listes : `models[p.id]` (ModelRow[]) — pas de pipeline `combinedModels`/`filteredModels` +
  `fetchedModels` : les modèles récupérés sont auto-ajoutés en base, la distinction n'a plus de sens.
- Échappe : si le modal est ouvert, Échappe ferme le modal (pas les réglages) — géré par l'état
  `browsing` dans le handler global d'échappe du dialog.
- i18n : `browseModels: "Parcourir les modèles"` ; compte affiché "(N)" dans le bouton.
- Invariants conservés : SQL paramétré, aucune chaîne en dur (i18n/fr.ts), tests TDD red→green.
