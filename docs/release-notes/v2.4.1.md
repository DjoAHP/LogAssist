# LogAssist v2.4.1

## 🖼️ Arrière-plan personnalisé

L'interface principale dispose d'un arrière-plan graphique créé sur mesure :
une texture sombre pour le mode sombre, une texture claire pour le mode clair.
Le basculement se fait automatiquement avec le thème — la barre latérale
conserveson propre fond pour garantir la lisibilité des raccourcis.

## ✨ Rendu markdown des réponses

Les réponses de l'assistant s'affichent en markdown complet : titres, gras,
listes, tableaux à bordures discrètes, blocs de code aux coins arrondis avec
coloration syntaxique adaptée au thème actif.

Chaque bloc de code offre un bouton « Copier » avec retour visuel, et le rendu
se construit en direct pendant le streaming sans clignotement : seuls les
messages en cours sont recalculés, les conversations longues restent fluides.

Le HTML brut éventuel d'un modèle reste affiché comme du texte, jamais exécuté.
Les messages utilisateur restent en texte brut.

## 🏷️ Version dans la barre de titre

La barre de la fenêtre affiche « LogAssist vX.Y.Z ». La version est propagée
automatiquement depuis package.json au build : un seul endroit à éditer.

## 🔧 Corrigé

- Flash blanc au démarrage supprimé, et le correctif respecte désormais le
  mode clair (régression de la v2.4.0 : la zone de chat restait noire après
  un passage en mode clair).
- Le mode clair s'affiche correctement sur toute l'interface.
- Script de synchronisation de version immunisé contre le BOM UTF-8 que
  certains outils Windows ajoutent, et couvert par des tests.

---

**Installateur** : `LogAssist_2.4.1_x64-setup.exe` (NSIS) ou
`LogAssist_2.4.1_x64_en-US.msi`, dans `src-tauri/target/release/bundle/`.
