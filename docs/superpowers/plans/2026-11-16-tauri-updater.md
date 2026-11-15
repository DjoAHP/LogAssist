# Updater Tauri — Plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task (mode demandé par l'utilisateur : exécution inline avec ARRÊT après chaque tâche + estimation d'effort de la tâche suivante). Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Mise à jour automatique de LogAssist via `tauri-plugin-updater` + GitHub Releases (vérification au démarrage + bouton réglages, bannière header, release CI signée sur tag).

**Architecture:** Un seul moteur `useUpdater` possédé par `App.tsx` (états idle/available/downloading/ready/upToDate/error) consommé par deux vues pures : bannière header + panneau réglages. Le réseau, la vérification de signature et l'installation sont délégués au plugin officiel Rust. Publication : workflow `release.yml` avec `tauri-apps/tauri-action`, signature via secrets GitHub.

**Tech Stack:** Tauri v2 (`tauri-plugin-updater`, `tauri-plugin-process`), React 19 + TS strict, vitest, GitHub Actions (runner windows-latest).

**Spec source:** `docs/superpowers/specs/2026-11-16-tauri-updater-design.md`

**Environment rules (LogAssist):**
- Éditer/git sous WSL ; `npm install`, `npm run build`, `cargo *` via `powershell.exe -NoProfile -Command "cd C:\dev\LogAssist; ..."`
- Tests hook = `// @vitest-environment jsdom` + `renderHook` (pattern `useGithubConnectorStatus.test.tsx`)
- Bouton `bg-brand-from` ⇒ toujours `text-brand-foreground`
- Zéro `console.log` hors logger (guard test) ; toute chaîne UI dans `src/i18n/fr.ts`
- `docs/` est gitignoré : `git add -f` pour le plan

---

### Task 1: Config Tauri + dépendances (JS + Rust)

**Files:**
- Modify: `src-tauri/tauri.conf.json`
- Modify: `src-tauri/capabilities/default.json`
- Modify: `src-tauri/src/lib.rs`
- Modify: `src-tauri/Cargo.toml`
- Modify: `package.json` (via npm install)

- [ ] **Step 1: tauri.conf.json — updater + artefacts**

Ajouter `"createUpdaterArtifacts": true` dans `bundle` :

```json
  "bundle": {
    "active": true,
    "targets": "all",
    "createUpdaterArtifacts": true,
```

Ajouter la section `plugins` en fin de fichier (après l'accolade fermante de `bundle`) :

```json
  "plugins": {
    "updater": {
      "pubkey": "REPLACE_WITH_MINISIGN_PUBKEY",
      "endpoints": [
        "https://github.com/DjoAHP/LogAssist/releases/latest/download/latest.json"
      ]
    }
  }
```

⚠️ Le placeholder `REPLACE_WITH_MINISIGN_PUBKEY` est remplacé en Task 7 (génération des clés avec l'utilisateur). Il ne casse ni le build ni les tests : le check ne s'exécute qu'en prod et la vérification de signature n'a lieu qu'à l'installation d'un paquet signé.

- [ ] **Step 2: capabilities — permissions updater + restart**

Dans `src-tauri/capabilities/default.json`, après `"dialog:allow-save",` ajouter :

```json
    "updater:default",
    "process:allow-restart",
```

- [ ] **Step 3: lib.rs — registration des plugins**

Dans la chaîne du builder, après `.plugin(tauri_plugin_fs::init())` ajouter :

```rust
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
```

- [ ] **Step 4: Cargo.toml — crates**

Après la ligne `tauri-plugin-fs = "2"` ajouter :

```toml
tauri-plugin-updater = "2"
tauri-plugin-process = "2"
```

- [ ] **Step 5: npm install (côté Windows, obligatoire)**

```powershell
powershell.exe -NoProfile -Command "cd C:\dev\LogAssist; npm install @tauri-apps/plugin-updater @tauri-apps/plugin-process"
```

Attendu : installation OK, `package.json`/`package-lock.json` mis à jour. **Jamais depuis WSL** (règle binaire natif).

- [ ] **Step 6: vérification compilation Rust**

```powershell
powershell.exe -NoProfile -Command "cd C:\dev\LogAssist\src-tauri; cargo check 2>&1 | Select-Object -Last 3"
```

Attendu : `Finished dev profile`. Si l'app tourne et verrouille un artefact, `cargo check` reste OK (ne lie pas l'exe).

- [ ] **Step 7: Commit**

```bash
git add src-tauri/tauri.conf.json src-tauri/capabilities/default.json src-tauri/src/lib.rs src-tauri/Cargo.toml src-tauri/Cargo.lock package.json package-lock.json
git commit -m "feat: config updater Tauri (plugin, permissions, artefacts signés)"
```

---

### Task 2: i18n + hook `useUpdater` (TDD)

**Files:**
- Modify: `src/i18n/fr.ts`
- Create: `src/hooks/useUpdater.ts`
- Test: `src/hooks/useUpdater.test.tsx`

- [ ] **Step 1: i18n**

Dans `src/i18n/fr.ts`, remplacer :

```ts
    categories: { lock: "Mot de passe", connectors: "Connecteurs" },
```

par :

```ts
    categories: { lock: "Mot de passe", connectors: "Connecteurs", updates: "Mises à jour" },
```

puis ajouter la section (juste après le bloc `generalSettings`) :

```ts
  updater: {
    checkNow: "Vérifier les mises à jour",
    checking: "Vérification…",
    upToDate: "LogAssist est à jour.",
    available: "LogAssist v{version} est disponible",
    install: "Installer",
    downloading: "Téléchargement de la mise à jour…",
    readyToInstall: "Mise à jour prête — redémarrage en cours",
    checkFailed: "Vérification impossible. Réessayez plus tard.",
    installFailed: "L'installation a échoué. Réessayez plus tard.",
    currentVersion: "Version installée : {version}",
    dismiss: "Masquer",
  },
```

- [ ] **Step 2: test rouge — `src/hooks/useUpdater.test.tsx`**

```tsx
// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const mockCheck = vi.hoisted(() => vi.fn())
const mockRelaunch = vi.hoisted(() => vi.fn())

vi.mock("@tauri-apps/plugin-updater", () => ({ check: mockCheck }))
vi.mock("@tauri-apps/plugin-process", () => ({ relaunch: mockRelaunch }))

import { useUpdater } from "@/hooks/useUpdater"

function makeUpdate(version: string) {
  return { version, downloadAndInstall: vi.fn() }
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.useFakeTimers()
  vi.stubEnv("PROD", true)
})

afterEach(() => {
  vi.unstubAllEnvs()
  vi.useRealTimers()
})

describe("useUpdater", () => {
  it("au démarrage, vérifie après le délai de grâce et reste discret sans mise à jour", async () => {
    mockCheck.mockResolvedValue(null)
    const { result } = renderHook(() => useUpdater({ graceDelayMs: 0 }))

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })
    expect(mockCheck).toHaveBeenCalledTimes(1)
    expect(result.current.state).toEqual({ phase: "idle" })
  })

  it("au démarrage, expose une mise à jour disponible", async () => {
    mockCheck.mockResolvedValue(makeUpdate("3.5.0"))
    const { result } = renderHook(() => useUpdater({ graceDelayMs: 0 }))

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })
    expect(result.current.state).toEqual({ phase: "available", version: "3.5.0" })
  })

  it("ne vérifie pas avant la fin du délai de grâce", async () => {
    mockCheck.mockResolvedValue(null)
    renderHook(() => useUpdater({ graceDelayMs: 15_000 }))

    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000)
    })
    expect(mockCheck).not.toHaveBeenCalled()
  })

  it("un check silencieux en échec n'alerte pas", async () => {
    mockCheck.mockRejectedValue(new Error("offline"))
    const { result } = renderHook(() => useUpdater({ graceDelayMs: 0 }))

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })
    expect(result.current.state).toEqual({ phase: "idle" })
  })

  it("checkNow sans mise à jour affiche 'à jour'", async () => {
    mockCheck.mockResolvedValue(null)
    const { result } = renderHook(() => useUpdater({ graceDelayMs: 60_000 }))

    await act(async () => {
      await result.current.checkNow()
    })
    expect(result.current.state).toEqual({ phase: "upToDate" })
  })

  it("checkNow en échec expose l'erreur", async () => {
    mockCheck.mockRejectedValue(new Error("offline"))
    const { result } = renderHook(() => useUpdater({ graceDelayMs: 60_000 }))

    await act(async () => {
      await result.current.checkNow()
    })
    expect(result.current.state).toEqual({ phase: "error" })
  })

  it("install télécharge avec progression puis passe en ready et relance", async () => {
    const update = makeUpdate("3.5.0")
    update.downloadAndInstall.mockImplementation(async (onEvent?: (e: unknown) => void) => {
      onEvent?.({ event: "Started", data: { contentLength: 10 } })
      onEvent?.({ event: "Progress", data: { chunkLength: 5 } })
      onEvent?.({ event: "Progress", data: { chunkLength: 5 } })
      onEvent?.({ event: "Finished" })
    })
    mockCheck.mockResolvedValue(update)
    const { result } = renderHook(() => useUpdater({ graceDelayMs: 0 }))

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })
    expect(result.current.state).toEqual({ phase: "available", version: "3.5.0" })

    await act(async () => {
      await result.current.install()
    })
    expect(mockRelaunch).toHaveBeenCalledTimes(1)
    expect(result.current.state).toEqual({ phase: "ready", version: "3.5.0" })
  })

  it("install en échec expose l'erreur", async () => {
    const update = makeUpdate("3.5.0")
    update.downloadAndInstall.mockRejectedValue(new Error("signature invalide"))
    mockCheck.mockResolvedValue(update)
    const { result } = renderHook(() => useUpdater({ graceDelayMs: 0 }))

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })
    await act(async () => {
      await result.current.install()
    })
    expect(mockRelaunch).not.toHaveBeenCalled()
    expect(result.current.state).toEqual({ phase: "error" })
  })

  it("en développement, aucun appel au plugin", async () => {
    vi.stubEnv("PROD", false)
    renderHook(() => useUpdater({ graceDelayMs: 0 }))

    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000)
    })
    expect(mockCheck).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 3: lancer le test — attendu ROUGE**

```powershell
powershell.exe -NoProfile -Command "cd C:\dev\LogAssist; npx vitest run src/hooks/useUpdater.test.tsx 2>&1 | Select-String 'Test Files|Tests '"
```

Attendu : FAIL (`Cannot find module '@/hooks/useUpdater'`).

- [ ] **Step 4: implémentation — `src/hooks/useUpdater.ts`**

```ts
// Moteur updater : point UNIQUE de gestion des mises à jour.
// App.tsx possède le hook ; bannière header et panneau réglages sont des
// consommateurs de l'état (jamais de seconde instance = jamais de check
// concurrent). Le réseau, la vérification de signature et l'installation
// appartiennent au plugin Rust — le hook ne fait que l'orchestrer.
// Invariant Windows : downloadAndInstall quitte l'app après le lancement
// de l'installateur ; le relance() qui suit n'est atteint que sur
// macOS/Linux (hors périmètre, conservé pour la correction de l'état).
import { useCallback, useEffect, useRef, useState } from "react"
import { check, type DownloadEvent, type Update } from "@tauri-apps/plugin-updater"
import { relaunch } from "@tauri-apps/plugin-process"

export type UpdaterState =
  | { phase: "idle" }
  | { phase: "available"; version: string }
  | { phase: "downloading"; version: string; received: number; total: number | null }
  | { phase: "ready"; version: string }
  | { phase: "upToDate" }
  | { phase: "error" }

const GRACE_DELAY_MS = 15_000

export function useUpdater(options?: { graceDelayMs?: number }) {
  const [state, setState] = useState<UpdaterState>({ phase: "idle" })
  const updateRef = useRef<Update | null>(null)
  const busyRef = useRef(false)
  const mountedRef = useRef(true)

  // Lu par rendu (pas au niveau module) pour rester testable via vi.stubEnv.
  const enabled = import.meta.env.PROD

  const runCheck = useCallback(
    async (silent: boolean): Promise<void> => {
      if (!enabled || busyRef.current) return
      busyRef.current = true
      try {
        const update = await check()
        updateRef.current = update
        if (!mountedRef.current) return
        if (update) {
          setState({ phase: "available", version: update.version })
        } else if (!silent) {
          setState({ phase: "upToDate" })
        }
      } catch {
        if (mountedRef.current) setState(silent ? { phase: "idle" } : { phase: "error" })
      } finally {
        busyRef.current = false
      }
    },
    [enabled],
  )

  const checkNow = useCallback(() => runCheck(false), [runCheck])

  const install = useCallback(async (): Promise<void> => {
    const update = updateRef.current
    if (!update || busyRef.current) return
    busyRef.current = true
    setState((prev) =>
      prev.phase === "available"
        ? { phase: "downloading", version: prev.version, received: 0, total: null }
        : prev,
    )
    try {
      await update.downloadAndInstall((event: DownloadEvent) => {
        if (!mountedRef.current) return
        setState((prev) => {
          if (prev.phase !== "downloading") return prev
          if (event.event === "Started") {
            return { ...prev, total: event.data.contentLength ?? null }
          }
          if (event.event === "Progress") {
            return { ...prev, received: prev.received + event.data.chunkLength }
          }
          return prev
        })
      })
      if (!mountedRef.current) return
      setState({ phase: "ready", version: update.version })
      await relaunch()
    } catch {
      if (mountedRef.current) setState({ phase: "error" })
    } finally {
      busyRef.current = false
    }
  }, [])

  useEffect(() => {
    mountedRef.current = true
    if (!enabled) return
    const timer = setTimeout(() => {
      void runCheck(true)
    }, options?.graceDelayMs ?? GRACE_DELAY_MS)
    return () => {
      mountedRef.current = false
      clearTimeout(timer)
    }
  }, [enabled, runCheck, options?.graceDelayMs])

  return { state, checkNow, install }
}
```

- [ ] **Step 5: test vert**

Même commande que Step 3. Attendu : 9/9 pass.

- [ ] **Step 6: Commit**

```bash
git add src/i18n/fr.ts src/hooks/useUpdater.ts src/hooks/useUpdater.test.tsx
git commit -m "feat: hook useUpdater (check démarrage + manuel, progression, relance)"
```

---

### Task 3: Bannière header + intégration App

**Files:**
- Create: `src/components/settings/UpdateBanner.tsx`
- Test: `src/components/settings/UpdateBanner.test.tsx`
- Modify: `src/App.tsx`

- [ ] **Step 1: test rouge — `src/components/settings/UpdateBanner.test.tsx`**

```tsx
// @vitest-environment jsdom
import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it, vi } from "vitest"
import { UpdateBanner } from "./UpdateBanner"

const available = { phase: "available", version: "3.5.0" } as const

describe("UpdateBanner", () => {
  it("n'affiche rien quand il n'y a rien à signaler", () => {
    const states = [
      { phase: "idle" },
      { phase: "upToDate" },
      { phase: "error" },
    ] as const
    for (const state of states) {
      const { unmount } = render(<UpdateBanner state={state} onInstall={vi.fn()} />)
      expect(screen.queryByTestId("update-banner")).not.toBeInTheDocument()
      unmount()
    }
  })

  it("annonce la version disponible avec un bouton d'installation", async () => {
    const onInstall = vi.fn()
    render(<UpdateBanner state={available} onInstall={onInstall} />)

    expect(screen.getByTestId("update-banner")).toHaveTextContent("LogAssist v3.5.0 est disponible")
    await userEvent.click(screen.getByRole("button", { name: "Installer" }))
    expect(onInstall).toHaveBeenCalledTimes(1)
  })

  it("signale le téléchargement en cours sans bouton d'installation", () => {
    render(
      <UpdateBanner
        state={{ phase: "downloading", version: "3.5.0", received: 10, total: 20 }}
        onInstall={vi.fn()}
      />,
    )
    expect(screen.getByTestId("update-banner")).toHaveTextContent("Téléchargement de la mise à jour…")
    expect(screen.queryByRole("button", { name: "Installer" })).not.toBeInTheDocument()
  })

  it("peut être masquée", async () => {
    render(<UpdateBanner state={available} onInstall={vi.fn()} />)
    await userEvent.click(screen.getByRole("button", { name: "Masquer" }))
    expect(screen.queryByTestId("update-banner")).not.toBeInTheDocument()
  })
})
```

- [ ] **Step 2: rouge attendu** — `npx vitest run src/components/settings/UpdateBanner.test.tsx` (module absent).

- [ ] **Step 3: composant — `src/components/settings/UpdateBanner.tsx`**

```tsx
// Bannière discrète de mise à jour, montée dans le header de App.
// Vue pure : l'état vient du moteur useUpdater possédé par App.tsx.
// Accent de marque : bg-brand-from exige text-brand-foreground (texte noir).
import { useState } from "react"
import { Download } from "lucide-react"
import { t } from "@/i18n/fr"
import type { UpdaterState } from "@/hooks/useUpdater"

interface Props {
  state: UpdaterState
  onInstall: () => void
}

function describe(state: UpdaterState): string {
  switch (state.phase) {
    case "available":
      return t.updater.available.replace("{version}", state.version)
    case "downloading":
      return t.updater.downloading
    case "ready":
      return t.updater.readyToInstall
    default:
      return ""
  }
}

export function UpdateBanner({ state, onInstall }: Props) {
  const [dismissed, setDismissed] = useState(false)
  if (dismissed) return null
  const label = describe(state)
  if (!label) return null
  return (
    <div
      data-testid="update-banner"
      className="flex items-center gap-2 rounded-md border border-border bg-foreground/5 px-2.5 py-1.5"
    >
      <span className="text-xs text-muted-foreground">{label}</span>
      {state.phase === "available" && (
        <button
          onClick={onInstall}
          className="flex items-center gap-1 rounded-md bg-brand-from px-2 py-0.5 text-xs font-medium text-brand-foreground hover:opacity-90"
        >
          <Download className="size-3" aria-hidden="true" />
          {t.updater.install}
        </button>
      )}
      <button
        aria-label={t.updater.dismiss}
        title={t.updater.dismiss}
        onClick={() => setDismissed(true)}
        className="rounded-md px-1 text-xs text-muted-foreground hover:text-foreground"
      >
        ×
      </button>
    </div>
  )
}
```

- [ ] **Step 4: vert** — même commande, 4/4 pass.

- [ ] **Step 5: intégration App.tsx**

Imports (après `import { useGithubConnectorStatus } from "@/hooks/useGithubConnectorStatus"`) :

```tsx
import { useUpdater } from "@/hooks/useUpdater"
import { UpdateBanner } from "@/components/settings/UpdateBanner"
```

Déclaration du moteur — localiser via `grep -n "useGithubConnectorStatus(" src/App.tsx` et ajouter sous l'appel :

```tsx
  const updater = useUpdater()
```

Montage dans le header : le groupe gauche devient :

```tsx
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2.5">
              <span className="brand-mark" aria-hidden="true">
                <img src={logoSrc} alt="" className="size-full object-contain" />
              </span>
              <div>
                <h1 className="text-base font-semibold">{t.app.title}</h1>
                <p className="text-xs text-muted-foreground">{t.app.subtitle}</p>
              </div>
            </div>
            <UpdateBanner state={updater.state} onInstall={() => void updater.install()} />
          </div>
```

- [ ] **Step 6: Commit**

```bash
git add src/components/settings/UpdateBanner.tsx src/components/settings/UpdateBanner.test.tsx src/App.tsx
git commit -m "feat: bannière de mise à jour dans le header"
```

---

### Task 4: Panneau réglages « Mises à jour »

**Files:**
- Create: `src/components/settings/UpdaterPanel.tsx`
- Test: `src/components/settings/UpdaterPanel.test.tsx`
- Modify: `src/components/settings/GeneralSettingsDialog.tsx` (+ son test)

- [ ] **Step 1: test rouge — `src/components/settings/UpdaterPanel.test.tsx`**

```tsx
// @vitest-environment jsdom
import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it, vi } from "vitest"
import { UpdaterPanel } from "./UpdaterPanel"

const noop = () => undefined

describe("UpdaterPanel", () => {
  it("affiche la version installée et un bouton de vérification", async () => {
    const onCheck = vi.fn()
    render(<UpdaterPanel state={{ phase: "idle" }} onCheck={onCheck} onInstall={noop} />)

    expect(screen.getByText(/^Version installée : /)).toBeInTheDocument()
    await userEvent.click(screen.getByRole("button", { name: "Vérifier les mises à jour" }))
    expect(onCheck).toHaveBeenCalledTimes(1)
  })

  it("affiche 'à jour' après un check sans mise à jour", () => {
    render(<UpdaterPanel state={{ phase: "upToDate" }} onCheck={noop} onInstall={noop} />)
    expect(screen.getByText("LogAssist est à jour.")).toBeInTheDocument()
  })

  it("affiche l'erreur de vérification", () => {
    render(<UpdaterPanel state={{ phase: "error" }} onCheck={noop} onInstall={noop} />)
    expect(screen.getByText("Vérification impossible. Réessayez plus tard.")).toBeInTheDocument()
  })

  it("annonce la mise à jour disponible et permet d'installer", async () => {
    const onInstall = vi.fn()
    render(
      <UpdaterPanel state={{ phase: "available", version: "3.5.0" }} onCheck={noop} onInstall={onInstall} />,
    )
    expect(screen.getByText("LogAssist v3.5.0 est disponible")).toBeInTheDocument()
    await userEvent.click(screen.getByRole("button", { name: "Installer" }))
    expect(onInstall).toHaveBeenCalledTimes(1)
  })

  it("désactive la vérification pendant le téléchargement", () => {
    render(
      <UpdaterPanel
        state={{ phase: "downloading", version: "3.5.0", received: 0, total: null }}
        onCheck={noop}
        onInstall={noop}
      />,
    )
    expect(screen.getByRole("button", { name: "Vérifier les mises à jour" })).toBeDisabled()
    expect(screen.getByText("Téléchargement de la mise à jour…")).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: rouge attendu** — module absent.

- [ ] **Step 3: composant — `src/components/settings/UpdaterPanel.tsx`**

```tsx
// Panneau « Mises à jour » des paramètres généraux.
// Consommateur du moteur useUpdater (App.tsx) : aucune logique réseau ici.
import { RefreshCw } from "lucide-react"
import { t } from "@/i18n/fr"
import type { UpdaterState } from "@/hooks/useUpdater"

interface Props {
  state: UpdaterState
  onCheck: () => void
  onInstall: () => void
}

function statusLine(state: UpdaterState): string | null {
  switch (state.phase) {
    case "upToDate":
      return t.updater.upToDate
    case "available":
      return t.updater.available.replace("{version}", state.version)
    case "downloading":
      return t.updater.downloading
    case "ready":
      return t.updater.readyToInstall
    case "error":
      return t.updater.checkFailed
    default:
      return null
  }
}

export function UpdaterPanel({ state, onCheck, onInstall }: Props) {
  const status = statusLine(state)
  return (
    <section aria-label={t.generalSettings.categories.updates} className="space-y-3">
      <h3 className="text-sm font-semibold">{t.generalSettings.categories.updates}</h3>
      <p className="text-xs text-muted-foreground">
        {t.updater.currentVersion.replace("{version}", __APP_VERSION__)}
      </p>
      {status !== null && (
        <p role="status" className="text-sm">
          {status}
        </p>
      )}
      <div className="flex items-center gap-2">
        <button
          onClick={onCheck}
          disabled={state.phase === "downloading"}
          className="flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-sm hover:bg-foreground/5 disabled:opacity-50"
        >
          <RefreshCw className="size-3.5" aria-hidden="true" />
          {t.updater.checkNow}
        </button>
        {state.phase === "available" && (
          <button
            onClick={onInstall}
            className="rounded-md bg-brand-from px-3 py-1.5 text-sm font-medium text-brand-foreground hover:opacity-90"
          >
            {t.updater.install}
          </button>
        )}
      </div>
    </section>
  )
}
```

- [ ] **Step 4: vert** — 5/5 pass.

- [ ] **Step 5: intégration GeneralSettingsDialog**

Type de catégorie :

```tsx
type Category = "lock" | "connectors" | "updates"
```

Table des catégories (icône lucide `RefreshCw`, cohérente) :

```tsx
import { KeyRound, Plug, RefreshCw, X, type LucideIcon } from "lucide-react"
import { UpdaterPanel } from "./UpdaterPanel"
import type { UpdaterState } from "@/hooks/useUpdater"

const CATEGORIES: { id: Category; label: string; icon: LucideIcon }[] = [
  { id: "lock", label: t.generalSettings.categories.lock, icon: KeyRound },
  { id: "connectors", label: t.generalSettings.categories.connectors, icon: Plug },
  { id: "updates", label: t.generalSettings.categories.updates, icon: RefreshCw },
]
```

Props + rendu du panneau :

```tsx
interface Props {
  onClose: () => void
  updater?: { state: UpdaterState; onCheck: () => void; onInstall: () => void }
}

// Dans le panneau, après la ligne connectors :
{tab === "updates" && (
  <UpdaterPanel
    state={updater?.state ?? { phase: "idle" }}
    onCheck={updater?.onCheck ?? noop}
    onInstall={updater?.onInstall ?? noop}
  />
)}
```

(avec `const noop = () => undefined` au niveau module).

- [ ] **Step 6: test de la modale** — lire `src/components/settings/GeneralSettingsDialog.test.tsx`, réutiliser ses mocks existants (plugin-sql / useGithubConnectorStatus) et ajouter :

```tsx
  it("expose la catégorie Mises à jour et déclenche la vérification", async () => {
    const onCheck = vi.fn()
    render(
      <GeneralSettingsDialog
        onClose={noop}
        updater={{ state: { phase: "idle" }, onCheck, onInstall: noop }}
      />,
    )
    await userEvent.click(screen.getByRole("button", { name: "Mises à jour" }))
    expect(screen.getByRole("button", { name: "Vérifier les mises à jour" })).toBeInTheDocument()
    await userEvent.click(screen.getByRole("button", { name: "Vérifier les mises à jour" }))
    expect(onCheck).toHaveBeenCalledTimes(1)
  })
```

- [ ] **Step 7: intégration App.tsx** — dans l'invocation de `GeneralSettingsDialog`, ajouter :

```tsx
          updater={{
            state: updater.state,
            onCheck: () => void updater.checkNow(),
            onInstall: () => void updater.install(),
          }}
```

- [ ] **Step 8: vert global du fichier** — `npx vitest run src/components/settings/` attendu pass.

- [ ] **Step 9: Commit**

```bash
git add src/components/settings/UpdaterPanel.tsx src/components/settings/UpdaterPanel.test.tsx src/components/settings/GeneralSettingsDialog.tsx src/components/settings/GeneralSettingsDialog.test.tsx src/App.tsx
git commit -m "feat: panneau Mises à jour dans les paramètres généraux"
```

---

### Task 5: Workflow de release + hygiène Git

**Files:**
- Create: `.github/workflows/release.yml`
- Modify: `.gitignore`

- [ ] **Step 1: release.yml**

```yaml
# Publication d'une release LogAssist : build Windows, signature updater,
# latest.json et Release GitHub. Déclencheur : tag v* (git tag vX.Y.Z + push).
# La clé privée minisign vit exclusivement dans les Secrets GitHub.
name: Release

on:
  push:
    tags: ["v*"]

permissions:
  contents: write

concurrency:
  group: release-${{ github.ref }}
  cancel-in-progress: true

jobs:
  publish:
    name: Build + signature + publication
    runs-on: windows-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 24
          cache: npm
      - name: Installation des dépendances (npm ci)
        run: npm ci
      - uses: dtolnay/rust-toolchain@stable
      - uses: Swatinem/rust-cache@v2
        with:
          workspaces: src-tauri
      - name: Vérifie l'alignement tag / version de l'app
        shell: pwsh
        run: |
          $tag = "${{ github.ref_name }}".TrimStart('v')
          $conf = Get-Content src-tauri/tauri.conf.json | ConvertFrom-Json
          if ($tag -ne $conf.version) {
            throw "Tag v$tag différent de la version de l'app $($conf.version) — lancez npm run sync:version avant de taguer."
          }
      - uses: tauri-apps/tauri-action@v0
        env:
          TAURI_SIGNING_PRIVATE_KEY: ${{ secrets.TAURI_SIGNING_PRIVATE_KEY }}
          TAURI_SIGNING_PRIVATE_KEY_PASSWORD: ${{ secrets.TAURI_SIGNING_PRIVATE_KEY_PASSWORD }}
        with:
          tagName: ${{ github.ref_name }}
          releaseName: 'LogAssist v__VERSION__'
          releaseBody: 'Voir les notes de publication sur feat/m1-socle-chat.'
          releaseDraft: false
          prerelease: false
```

- [ ] **Step 2: .gitignore** — ajouter en fin de fichier :

```
# Signature updater — la clé privée ne doit JAMAIS être commitée
secrets/
*.key
```

- [ ] **Step 3: Commit**

```bash
git add .github/workflows/release.yml .gitignore
git commit -m "ci: release automatique signée sur tag (tauri-action)"
```

---

### Task 6: Gates complètes + PR + merge

- [ ] **Step 1: gate TypeScript** — `npm run build` (Windows). Attendu : tous les tests pass, build Vite OK.
- [ ] **Step 2: gate Rust** — `cargo test --lib` + `cargo clippy -- -D warnings` (Windows). Attendu : pass. (`cargo test` complet si l'app est fermée.)
- [ ] **Step 3: Push + PR** — `gh pr create --base feat/m1-socle-chat` avec résumé + plan de test.
- [ ] **Step 4: CI verte** — `gh pr checks <n> --watch`.
- [ ] **Step 5: Merge** — `gh pr merge --merge --delete-branch`, puis `git pull origin feat/m1-socle-chat`.

---

### Task 7: (avec l'utilisateur) Clés, secrets, release de validation

- [ ] **Step 1:** Générer la paire minisign : `npm run tauri signer generate -w ~/.tauri/logassist.key` (mot de passe à choisir avec l'utilisateur).
- [ ] **Step 2:** Remplacer `REPLACE_WITH_MINISIGN_PUBKEY` dans `tauri.conf.json` par la clé publique (commit).
- [ ] **Step 3:** Configurer les Secrets GitHub `TAURI_SIGNING_PRIVATE_KEY` (contenu du fichier clé) et `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`.
- [ ] **Step 4:** Copie de secours dans `C:\dev\secrets\` (hors dépôt) + note de sauvegarde.
- [ ] **Step 5:** Release de validation : fermer LogAssist → `npm run build` local OU taguer `v3.4.1` pour la CI → vérifier `latest.json` + `.sig` dans la Release → installer, puis vérifier qu'une release suivante déclenche la bannière.

---

## Self-review (effectuée)

- **Spec couverte** : sections 4.3–4.6 → Tasks 1–5 ; section 6 (tests) → tests de chaque task ; section 8 ordre respecté ; Authenticode/macOS/Linux hors périmètre (aucune task).
- **Types cohérents** : `UpdaterState` (6 phases), `useUpdater()` retourne `{ state, checkNow, install }` — identiques dans Task 2/3/4 ; props `UpdateBanner { state, onInstall }` / `UpdaterPanel { state, onCheck, onInstall }`.
- **Aucun placeholder de code** ; seul `REPLACE_WITH_MINISIGN_PUBKEY` est assumé (Task 7, utilisateur).
- **i18n** : toutes les chaînes du plan existent dans la section `updater` ajoutée en Task 2 (dismiss/install/checkNow/vérifiées par les tests des Tasks 3–4).
