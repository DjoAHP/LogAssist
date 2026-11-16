# État « Vérification… » et release v3.5.1 — Plan d’implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Afficher un état manuel « Vérification… » pendant le check updater, puis publier v3.5.1 pour tester la première mise à jour depuis LogAssist v3.5.0.

**Architecture:** `useUpdater` reste l’unique moteur et ajoute la phase `checking` uniquement pour les checks manuels. `UpdaterPanel` dérive le texte, l’état désactivé et l’animation de cette phase ; le check silencieux et `UpdateBanner` restent discrets. La livraison suit le workflow versionné existant jusqu’au test d’installation signé.

**Tech Stack:** React 19, TypeScript strict, Vitest, Tauri v2 updater, GitHub Actions.

**Spec source:** `docs/superpowers/specs/2026-11-16-updater-checking-v351-design.md`

**Contrainte projet:** pas de worktree ; branche active `feat/updater-checking-v3.5.1`.

---

### Task 1: Phase `checking` dans le hook et le panneau (TDD)

**Files:**
- Modify: `src/hooks/useUpdater.ts`
- Test: `src/hooks/useUpdater.test.tsx`
- Modify: `src/components/settings/UpdaterPanel.tsx`
- Test: `src/components/settings/UpdaterPanel.test.tsx`

- [ ] **Step 1: ajouter le test rouge du hook manuel**

Ajouter dans `src/hooks/useUpdater.test.tsx` :

```tsx
it("expose checking pendant une vérification manuelle", async () => {
  let resolveCheck!: (value: null) => void
  mockCheck.mockImplementation(
    () => new Promise((resolve) => { resolveCheck = resolve }),
  )
  const { result } = renderHook(() => useUpdater({ graceDelayMs: 60_000 }))
  let checkPromise!: Promise<void>

  act(() => {
    checkPromise = result.current.checkNow()
  })
  expect(result.current.state).toEqual({ phase: "checking" })

  await act(async () => {
    resolveCheck(null)
    await checkPromise
  })
  expect(result.current.state).toEqual({ phase: "upToDate" })
})
```

- [ ] **Step 2: ajouter le test rouge du check silencieux en vol**

```tsx
it("garde le check silencieux invisible pendant la requête", async () => {
  let resolveCheck!: (value: null) => void
  mockCheck.mockImplementation(
    () => new Promise((resolve) => { resolveCheck = resolve }),
  )
  const { result } = renderHook(() => useUpdater({ graceDelayMs: 0 }))

  await act(async () => {
    await vi.advanceTimersByTimeAsync(0)
  })
  expect(result.current.state).toEqual({ phase: "idle" })

  await act(async () => {
    resolveCheck(null)
    await Promise.resolve()
  })
  expect(result.current.state).toEqual({ phase: "idle" })
})
```

- [ ] **Step 3: ajouter le test rouge du panneau**

```tsx
it("désactive et anime le bouton pendant une vérification manuelle", () => {
  render(<UpdaterPanel state={{ phase: "checking" }} onCheck={noop} onInstall={noop} />)

  const button = screen.getByRole("button", { name: "Vérification…" })
  expect(button).toBeDisabled()
  expect(button.querySelector("svg")).toHaveClass("animate-spin")
  expect(screen.getByRole("status")).toHaveTextContent("Vérification…")
})
```

- [ ] **Step 4: vérifier le rouge**

```powershell
powershell.exe -NoProfile -Command "cd C:\dev\LogAssist; npx vitest run src/hooks/useUpdater.test.tsx src/components/settings/UpdaterPanel.test.tsx"
```

Attendu : échecs sur la phase, le libellé et l’animation absents.

- [ ] **Step 5: implémenter le hook**

Ajouter à `UpdaterState` :

```ts
| { phase: "checking" }
```

Dans `runCheck`, après `busyRef.current = true` et avant `try` :

```ts
if (!silent && mountedRef.current) setState({ phase: "checking" })
```

- [ ] **Step 6: implémenter le panneau**

Dans `statusLine` :

```ts
case "checking":
  return t.updater.checking
```

Dans `UpdaterPanel`, ajouter :

```ts
const checking = state.phase === "checking"
const busy = checking || state.phase === "downloading"
```

Puis adapter le bouton :

```tsx
<button
  onClick={onCheck}
  disabled={busy}
  aria-busy={checking}
  className="flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-sm transition-colors hover:bg-foreground/5 disabled:cursor-not-allowed disabled:opacity-50"
>
  <RefreshCw
    className={checking ? "size-3.5 animate-spin" : "size-3.5"}
    aria-hidden="true"
  />
  {checking ? t.updater.checking : t.updater.checkNow}
</button>
```

- [ ] **Step 7: vérifier le vert et TypeScript**

```powershell
powershell.exe -NoProfile -Command "cd C:\dev\LogAssist; npx vitest run src/hooks/useUpdater.test.tsx src/components/settings/UpdaterPanel.test.tsx; npx tsc --noEmit"
```

- [ ] **Step 8: commit**

```bash
git add src/hooks/useUpdater.ts src/hooks/useUpdater.test.tsx src/components/settings/UpdaterPanel.tsx src/components/settings/UpdaterPanel.test.tsx
git commit -m "feat: affiche l'état de vérification de l'updater"
```

---

### Task 2: Version et notes v3.5.1

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json`
- Modify: `src-tauri/Cargo.toml`
- Modify: `src-tauri/Cargo.lock`
- Modify: `src-tauri/tauri.conf.json`
- Create: `.github/release-notes/v3.5.1.md`

- [ ] **Step 1: bump et synchronisation sous Windows**

```powershell
powershell.exe -NoProfile -Command "cd C:\dev\LogAssist; npm version 3.5.1 --no-git-tag-version; npm run sync:version; cd src-tauri; cargo check"
```

Attendu : `Compiling logassist v3.5.1`, sans erreur.

- [ ] **Step 2: vérifier les cinq sources de version**

Vérifier `3.5.1` dans `package.json`, `package-lock.json`, `Cargo.toml`, l’entrée
`logassist` de `Cargo.lock`, `tauri.conf.json` et le titre `LogAssist v3.5.1`.

- [ ] **Step 3: créer `.github/release-notes/v3.5.1.md`**

```markdown
# Un retour visuel pendant la vérification

LogAssist v3.5.1 affiche désormais l’état de la vérification manuelle des mises à jour. Cette petite évolution accompagne le premier test complet de l’updater livré avec v3.5.0.

## 🔄 Une vérification plus claire

- Le bouton affiche « Vérification… » pendant la requête
- L’icône tourne jusqu’à la réponse du serveur
- Le bouton reste désactivé pour éviter les doubles appels
- La vérification silencieuse au démarrage reste discrète

Tu vois immédiatement que LogAssist travaille, puis le panneau affiche la version disponible, l’état à jour ou le message d’erreur adapté.

## 🧪 Première mise à jour depuis LogAssist

- v3.5.0 détecte v3.5.1 via `latest.json`
- Le téléchargement passe par l’interface de l’application
- LogAssist vérifie la signature minisign avant l’installation
- La publication fournit les installateurs `.msi` et `.exe` signés

Cette release permet de valider pour la première fois le parcours complet, de la détection à l’installation.
```

- [ ] **Step 4: valider notes et versions**

```powershell
powershell.exe -NoProfile -Command "$env:LOGASSIST_RELEASE_TAG='v3.5.1'; $env:GITHUB_OUTPUT=Join-Path $env:TEMP 'logassist-v351-notes.txt'; Remove-Item $env:GITHUB_OUTPUT -ErrorAction SilentlyContinue; cd C:\dev\LogAssist; node scripts/load-release-notes.mjs"
powershell.exe -NoProfile -Command "cd C:\dev\LogAssist; npx vitest run src/syncVersion.test.ts src/lib/appVersion.test.ts src/releaseNotesWorkflow.test.ts"
```

- [ ] **Step 5: présenter les notes à l’utilisateur**

Ne pas créer le tag. Afficher le Markdown exact et obtenir son approbation.

- [ ] **Step 6: commit**

```bash
git add package.json package-lock.json src-tauri/Cargo.toml src-tauri/Cargo.lock src-tauri/tauri.conf.json .github/release-notes/v3.5.1.md
git commit -m "chore: prépare la release v3.5.1"
```

---

### Task 3: Gates, PR et merge (sans tag)

- [ ] **Step 1:** `npm run build` sous Windows ; tous les tests et Vite doivent réussir.
- [ ] **Step 2:** `cargo test` puis `cargo clippy -- -D warnings` sous Windows.
- [ ] **Step 3:** revoir le diff depuis `feat/m1-socle-chat` et corriger tout problème important.
- [ ] **Step 4:** pousser la branche et ouvrir une PR vers `feat/m1-socle-chat`.
- [ ] **Step 5:** attendre les deux jobs CI, merger et supprimer la branche.
- [ ] **Step 6:** vérifier que `v3.5.1` n’existe ni localement ni sur GitHub.

---

### Task 4: Publication et test end-to-end avec l’utilisateur

- [ ] **Step 1:** confirmer merge commit, version, notes, Secrets et tag absent.
- [ ] **Step 2:** après autorisation explicite, créer le tag annoté `v3.5.1` et pousser uniquement ce tag.
- [ ] **Step 3:** surveiller le workflow Release avec `gh run watch --exit-status`.
- [ ] **Step 4:** vérifier titre, notes, `.exe`, `.msi`, `.sig`, `latest.json`, version et signatures du manifeste.
- [ ] **Step 5:** dans LogAssist v3.5.0, détecter v3.5.1 et lancer l’installation depuis l’interface.
- [ ] **Step 6:** après relance, confirmer la version 3.5.1, « Vérification… » puis « LogAssist est à jour ».

---

## Self-review

- **Couverture spec :** état manuel et silencieux (Task 1), version/notes (Task 2), gates (Task 3), test signé réel (Task 4).
- **Types cohérents :** `UpdaterState` reçoit exactement `{ phase: "checking" }`, consommé par le hook et le panneau.
- **Sécurité :** aucune modification de clé, endpoint ou permission ; tag soumis à autorisation explicite.
- **Périmètre :** aucun historique, canal beta, timestamp ou correction globale d’accessibilité.
