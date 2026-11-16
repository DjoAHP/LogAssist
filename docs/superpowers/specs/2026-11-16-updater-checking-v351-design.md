# État de vérification updater — conception v3.5.1

Date : 16 novembre 2026

Branche : `feat/updater-checking-v3.5.1` (depuis `feat/m1-socle-chat`)

Statut : conception validée par l’utilisateur

## 1. Contexte

LogAssist v3.5.0 contient le premier updater signé. L’installation MSI et le
check manuel ont été validés : le panneau affiche correctement « LogAssist est
à jour ». Pendant la requête, le bouton ne fournit toutefois aucun retour
visuel, alors que la chaîne i18n `t.updater.checking` existe déjà.

v3.5.1 ajoute ce retour visuel. Cette petite amélioration sert aussi de première
version supérieure pour tester le cycle complet : détection, téléchargement,
vérification minisign et installation depuis LogAssist v3.5.0.

## 2. Comportement

Lors d’une vérification manuelle, le bouton :

- remplace « Vérifier les mises à jour » par « Vérification… » ;
- désactive le clic jusqu’à la résolution ;
- anime l’icône `RefreshCw` avec `animate-spin` ;
- expose l’état via le `role="status"` déjà présent dans le panneau.

À la résolution, l’état devient `upToDate`, `available` ou `error` selon le
résultat. La vérification silencieuse lancée au démarrage ne montre pas la phase
intermédiaire : elle reste invisible lorsqu’aucune mise à jour n’existe.

## 3. Architecture

`UpdaterState` reçoit une variante :

```ts
{ phase: "checking" }
```

`runCheck(silent)` ne place l’état en `checking` que si `silent === false`,
avant l’appel au plugin Tauri. `busyRef` conserve son rôle de verrou synchrone :
un deuxième clic ne lance aucun appel concurrent.

`UpdaterPanel` dérive du même état :

- texte du bouton : `checking` ou `checkNow` ;
- bouton désactivé pendant `checking` et `downloading` ;
- classe `animate-spin` seulement pendant `checking`.

`UpdateBanner` ne traite pas cette variante et reste masquée pendant le check.

## 4. Tests TDD

- hook : une promesse différée maintient `phase: "checking"` jusqu’à sa
  résolution ;
- hook : le check silencieux conserve `phase: "idle"` pendant la requête ;
- panneau : texte « Vérification… », bouton désactivé et icône animée ;
- régressions : absence de mise à jour, mise à jour disponible et erreur de
  vérification conservent leurs états actuels ;
- gates complètes TypeScript, Vitest, Vite, Rust et Clippy.

## 5. Livraison v3.5.1

La livraison comprend trois commits cohérents :

1. état `checking` et tests ;
2. bump synchronisé vers `3.5.1` ;
3. `.github/release-notes/v3.5.1.md`.

Après PR, CI et merge, l’utilisateur approuve les notes puis autorise le tag
annoté `v3.5.1`. Le workflow existant publie les installateurs, signatures et
`latest.json`.

Le test final part de LogAssist v3.5.0 installé :

1. détection de v3.5.1 ;
2. téléchargement depuis l’interface ;
3. vérification de la signature ;
4. installation ;
5. confirmation de la version 3.5.1 et du nouvel état « Vérification… ».

## 6. Hors périmètre

- installation silencieuse ;
- date de dernière vérification ;
- persistance d’un historique ;
- canaux beta ;
- modification des clés ou de la signature updater ;
- correction globale des focus clavier.
