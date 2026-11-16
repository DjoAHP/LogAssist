# Notes de release versionnées — conception

Date : 16 novembre 2026

Branche : `chore/release-notes-workflow` (depuis `feat/m1-socle-chat`)

Statut : conception validée par l’utilisateur

## 1. Contexte

Le workflow `.github/workflows/release.yml` construit et publie déjà une
Release GitHub lors du push d’un tag `v*`. Il utilise toutefois un titre
générique (`LogAssist vX.Y.Z`) et un corps identique pour toutes les versions.

L’utilisateur veut conserver son style éditorial à chaque livraison : titre
GitHub exactement égal à `vX.Y.Z`, puis un corps rédigé à partir des
modifications réellement mergées, avec un titre principal, deux ou trois
sections courtes, des emojis, des listes concrètes et une phrase de conclusion.

## 2. Décision

Les notes deviennent un artefact versionné de la branche de release :

```text
.github/release-notes/v3.5.0.md
.github/release-notes/v3.5.1.md
.github/release-notes/v3.6.0.md
```

Avant chaque tag, l’agent analyse le diff depuis le précédent tag et rédige le
fichier correspondant. Le texte est relu par l’utilisateur avant publication.
Le workflow charge ensuite ce fichier ; il échoue avant le build si le fichier
manque ou est vide.

Les alternatives sont écartées : les notes GitHub générées depuis les commits
sont trop techniques ; modifier une Release après publication expose
temporairement un texte incomplet.

## 3. Format éditorial obligatoire

```markdown
# Titre principal orienté bénéfice utilisateur

Court paragraphe d’introduction.

## 🚀 Première évolution importante

- Modification concrète
- Modification concrète

Phrase qui explique l’effet pour l’utilisateur.

## 🔐 Deuxième évolution importante

- Modification concrète
- Modification concrète

Phrase de conclusion courte.
```

Règles :

- le titre de la Release GitHub reste uniquement `vX.Y.Z` ;
- le titre éditorial vit dans le corps Markdown ;
- deux ou trois sections maximum ;
- listes factuelles, sans recopier tous les commits ;
- pas de métriques techniques sauf si elles renforcent réellement la confiance ;
- signaler explicitement toute action requise par l’utilisateur ;
- texte en français, direct et sans formules promotionnelles creuses.

## 4. Workflow GitHub Actions

Le job Release conserve son déclenchement sur les tags `v*` et son contrôle
`tag === version Tauri`. Une étape PowerShell supplémentaire :

1. construit le chemin `.github/release-notes/<tag>.md` à partir de
   `github.ref_name` ;
2. refuse un fichier absent ou vide ;
3. exporte son contenu Markdown comme output multilignes GitHub Actions ;
4. transmet cet output à `tauri-apps/tauri-action@v1` via `releaseBody`.

`releaseName` devient `v__VERSION__`. Le reste de la chaîne ne change pas :
build Windows, signature minisign, installateurs MSI/NSIS, fichiers `.sig`,
`latest.json`, puis publication immédiate.

## 5. Convention persistante dans AGENTS.md

Une section « Workflow de release » est ajoutée sous les règles Git :

1. branche `chore/release-vX.Y.Z` depuis `feat/m1-socle-chat` ;
2. bump + `npm run sync:version` + notes Markdown pertinentes ;
3. PR, gates et merge ;
4. validation explicite du texte par l’utilisateur ;
5. tag annoté `vX.Y.Z` sur le merge commit ;
6. push du tag exact (`git push origin vX.Y.Z`, jamais `--tags`) ;
7. surveillance du workflow Release ;
8. vérification de la Release, de `latest.json`, des installateurs et des
   signatures.

L’agent rédige les notes ; il ne demande pas à l’utilisateur de produire le
texte, mais lui demande l’approbation finale avant le tag.

## 6. Première application : v3.5.0

Le fichier `.github/release-notes/v3.5.0.md` présente :

- les mises à jour automatiques depuis l’interface LogAssist ;
- la vérification minisign des paquets ;
- la publication automatisée par GitHub Actions ;
- la distinction des erreurs et la progression du téléchargement ;
- l’installation manuelle unique de v3.5.0 nécessaire pour amorcer l’updater.

Le texte est montré à l’utilisateur avant la création du tag `v3.5.0`.

## 7. Validation

- test local du script PowerShell avec `v3.5.0.md` ;
- test négatif avec un tag sans fichier de notes ;
- analyse YAML du workflow ;
- gates habituelles de la PR ;
- après le tag : workflow Release vert et présence de `.exe`, `.msi`, `.sig`
  et `latest.json` dans la Release.

## 8. Hors périmètre

- génération des notes par un LLM dans GitHub Actions ;
- publication multi-canal ou pré-release ;
- signature Authenticode Windows ;
- modification automatique d’une Release déjà publiée.
