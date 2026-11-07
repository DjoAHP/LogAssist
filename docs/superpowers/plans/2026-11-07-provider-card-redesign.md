# Provider Card Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remplacer les cartes fournisseur 16:9 par des cartes « console fournisseur » presque carrées, accessibles et organisées selon la référence validée.

**Architecture:** `SettingsDialog` conserve les opérations asynchrones et transmet données, états et callbacks à un nouveau composant muet `ProviderCard`. Un sous-composant interne `ProviderAction` rend les trois cellules d’action et leurs retours d’état sans dépendre de SQLite, des secrets ou des fournisseurs IA.

**Tech Stack:** React 19, TypeScript strict, Tailwind CSS 3, Lucide React, Vitest 5, React Testing Library.

---

## Structure des fichiers

- Créer `src/components/settings/ProviderCard.tsx` : contrat, structure visuelle,
  actions, états asynchrones et accessibilité d’une carte.
- Créer `src/components/settings/ProviderCard.test.tsx` : tests unitaires du
  composant de présentation.
- Modifier `src/components/settings/SettingsDialog.tsx` : remplacer le JSX des
  anciennes cartes par `ProviderCard` et passer la galerie à trois colonnes.
- Modifier `src/components/settings/SettingsDialog.test.tsx` : vérifier
  l’intégration sans dupliquer les tests visuels du composant.
- Ne pas modifier `src/i18n/fr.ts` : les libellés et messages requis existent.
- Ne pas modifier `src/index.css` : les variables de marque et les thèmes
  existent ; les styles locaux utilisent Tailwind.

## Règles d’exécution

- Travailler dans `/mnt/c/dev/LogAssist/.worktrees/redesign-cartes-fournisseurs`.
- Ne pas lancer `npm install` depuis WSL.
- Exécuter Vitest et TypeScript depuis WSL.
- Exécuter le build final depuis PowerShell Windows.
- Ne modifier ni la logique de secrets ni les fonctions `test`, `fetchModels`
  et `removeProvider` de `SettingsDialog`.

---

### Task 1: Créer la carte et son contrat de présentation

**Files:**
- Create: `src/components/settings/ProviderCard.test.tsx`
- Create: `src/components/settings/ProviderCard.tsx`

- [ ] **Step 1: Écrire les tests rouges de structure et de délégation**

Créer `src/components/settings/ProviderCard.test.tsx` :

```tsx
// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest"
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react"
import { t } from "@/i18n/fr"
import { type ProviderRow } from "@/lib/db/providers"
import { ProviderCard, type ProviderCardProps } from "./ProviderCard"

const provider: ProviderRow = {
  id: "provider-1",
  name: "Ollama local avec un nom long",
  api_family: "openai",
  base_url: "http://localhost:11434/v1",
  created_at: "2026-11-07",
}

afterEach(cleanup)

function renderCard(overrides: Partial<ProviderCardProps> = {}) {
  const props: ProviderCardProps = {
    provider,
    modelCount: 3,
    connectionStatus: { state: "idle" },
    fetchStatus: undefined,
    onTest: vi.fn(),
    onFetchModels: vi.fn(),
    onEdit: vi.fn(),
    onDelete: vi.fn(),
    onBrowseModels: vi.fn(),
    ...overrides,
  }

  return { props, ...render(<ProviderCard {...props} />) }
}

describe("ProviderCard — structure", () => {
  it("affiche l’identité et le compteur sans intégrer la liste des modèles", () => {
    renderCard()

    const card = screen.getByTestId("provider-card")
    expect(within(card).getByText(provider.name)).not.toBeNull()
    expect(within(card).getByText(provider.base_url)).not.toBeNull()
    expect(within(card).getByRole("button", {
      name: `${t.settings.browseModels} (3)`,
    })).not.toBeNull()
    expect(card.querySelector("ul")).toBeNull()
  })

  it("expose l’URL complète et des boutons explicites", () => {
    renderCard()

    const url = screen.getByText(provider.base_url)
    expect(url.getAttribute("title")).toBe(provider.base_url)

    const card = screen.getByTestId("provider-card")
    expect(within(card).getByRole("button", { name: t.settings.test }).getAttribute("type")).toBe("button")
    expect(within(card).getByRole("button", { name: t.settings.fetchModels }).getAttribute("type")).toBe("button")
    expect(within(card).getByRole("button", { name: t.settings.edit }).getAttribute("type")).toBe("button")
    expect(within(card).getByRole("button", { name: t.settings.delete }).getAttribute("type")).toBe("button")
  })
})

describe("ProviderCard — interactions", () => {
  it("délègue chaque commande au callback correspondant", () => {
    const { props } = renderCard()
    const card = screen.getByTestId("provider-card")

    fireEvent.click(within(card).getByRole("button", { name: t.settings.test }))
    fireEvent.click(within(card).getByRole("button", { name: t.settings.fetchModels }))
    fireEvent.click(within(card).getByRole("button", { name: t.settings.edit }))
    fireEvent.click(within(card).getByRole("button", { name: t.settings.delete }))
    fireEvent.click(within(card).getByRole("button", {
      name: `${t.settings.browseModels} (3)`,
    }))

    expect(props.onTest).toHaveBeenCalledOnce()
    expect(props.onFetchModels).toHaveBeenCalledOnce()
    expect(props.onEdit).toHaveBeenCalledOnce()
    expect(props.onDelete).toHaveBeenCalledOnce()
    expect(props.onBrowseModels).toHaveBeenCalledOnce()
  })
})
```

- [ ] **Step 2: Exécuter le test et constater l’échec attendu**

Run:

```bash
npm test -- src/components/settings/ProviderCard.test.tsx
```

Expected: FAIL avec une erreur indiquant que `./ProviderCard` n’existe pas.

- [ ] **Step 3: Créer le contrat et la structure statique minimale**

Créer `src/components/settings/ProviderCard.tsx` :

```tsx
import { CloudDownload, RadioTower, Trash2, Wrench, type LucideIcon } from "lucide-react"
import { t } from "@/i18n/fr"
import { type ProviderRow } from "@/lib/db/providers"

export type ProviderConnectionStatus =
  | { state: "idle" }
  | { state: "testing" }
  | { state: "ok" }
  | { state: "fail"; message: string }

export type ProviderFetchStatus =
  | { state: "fetching" }
  | { state: "ok"; added: number }
  | { state: "fail"; message: string }

export interface ProviderCardProps {
  provider: ProviderRow
  modelCount: number
  connectionStatus: ProviderConnectionStatus
  fetchStatus: ProviderFetchStatus | undefined
  onTest: () => void
  onFetchModels: () => void
  onEdit: () => void
  onDelete: () => void
  onBrowseModels: () => void
}

interface ProviderActionProps {
  action: string
  label: string
  Icon: LucideIcon
  onClick: () => void
}

function ProviderAction({ action, label, Icon, onClick }: ProviderActionProps) {
  return (
    <button
      type="button"
      data-action={action}
      aria-label={label}
      onClick={onClick}
      className="group/action flex min-h-32 min-w-0 flex-col items-center justify-center gap-2 rounded-lg px-2 py-3 text-center outline-none transition-colors hover:bg-foreground/5 focus-visible:ring-2 focus-visible:ring-brand-to motion-reduce:transition-none"
    >
      <Icon aria-hidden="true" className="size-7 text-muted-foreground transition-colors group-hover/action:text-brand-to motion-reduce:transition-none" />
      <span className="text-xs font-medium leading-tight">{label}</span>
    </button>
  )
}

export function ProviderCard(props: ProviderCardProps) {
  return (
    <article
      data-testid="provider-card"
      className="group relative flex min-h-80 flex-col overflow-hidden rounded-xl border border-border bg-background p-4 shadow-sm transition-[border-color,box-shadow] duration-200 hover:border-brand-to hover:shadow-[0_18px_48px_-32px_rgba(39,200,214,0.65)] motion-reduce:transition-none"
    >
      <span aria-hidden="true" className="absolute inset-x-8 top-0 h-px bg-gradient-to-r from-transparent via-brand-to to-transparent opacity-70" />

      <header className="flex items-start gap-3 pb-4">
        <div className="min-w-0 flex-1">
          <h3 className="truncate text-base font-semibold" title={props.provider.name}>
            {props.provider.name}
          </h3>
          <p
            className="mt-1 truncate text-xs text-muted-foreground"
            title={props.provider.base_url}
            aria-label={props.provider.base_url}
          >
            {props.provider.base_url}
          </p>
        </div>
        <button
          type="button"
          data-action="delete-provider"
          aria-label={t.settings.delete}
          onClick={props.onDelete}
          className="shrink-0 rounded-lg p-2 text-muted-foreground outline-none transition-colors hover:bg-destructive/10 hover:text-destructive focus-visible:ring-2 focus-visible:ring-destructive motion-reduce:transition-none"
        >
          <Trash2 aria-hidden="true" className="size-4" />
        </button>
      </header>

      <div aria-hidden="true" className="h-px bg-gradient-to-r from-transparent via-border to-transparent" />

      <div className="grid flex-1 grid-cols-3 gap-1 py-4">
        <ProviderAction action="test-connection" label={t.settings.test} Icon={RadioTower} onClick={props.onTest} />
        <ProviderAction action="fetch-models" label={t.settings.fetchModels} Icon={CloudDownload} onClick={props.onFetchModels} />
        <ProviderAction action="edit-provider" label={t.settings.edit} Icon={Wrench} onClick={props.onEdit} />
      </div>

      <button
        type="button"
        data-action="browse-models"
        aria-label={`${t.settings.browseModels} (${props.modelCount})`}
        onClick={props.onBrowseModels}
        className="flex w-full items-center justify-center gap-1.5 rounded-lg border border-border px-3 py-2.5 text-sm font-medium outline-none transition-colors hover:border-brand-to hover:text-brand-to focus-visible:ring-2 focus-visible:ring-brand-to motion-reduce:transition-none"
      >
        <span>{t.settings.browseModels}</span>
        <span aria-hidden="true" className="text-muted-foreground">({props.modelCount})</span>
      </button>
    </article>
  )
}
```

Les deux propriétés d’état font partie du contrat, mais cette version ne les
rend pas encore. Les tests de la tâche suivante piloteront cet ajout.

- [ ] **Step 4: Exécuter le test unitaire et obtenir le vert**

Run:

```bash
npm test -- src/components/settings/ProviderCard.test.tsx
```

Expected: PASS, 3 tests passants.

- [ ] **Step 5: Vérifier TypeScript**

Run:

```bash
npx tsc --noEmit
```

Expected: exit code 0.

- [ ] **Step 6: Committer la carte statique**

```bash
git add src/components/settings/ProviderCard.tsx src/components/settings/ProviderCard.test.tsx
git commit -m "feat: créer la carte fournisseur"
```

---

### Task 2: Afficher les états dans chaque action

**Files:**
- Modify: `src/components/settings/ProviderCard.test.tsx`
- Modify: `src/components/settings/ProviderCard.tsx`

- [ ] **Step 1: Ajouter les tests rouges des états asynchrones**

Ajouter ce bloc à `src/components/settings/ProviderCard.test.tsx` :

```tsx
describe("ProviderCard — états des actions", () => {
  it("désactive et annonce uniquement le test pendant la connexion", () => {
    renderCard({ connectionStatus: { state: "testing" } })

    const testButton = screen.getByRole("button", { name: t.settings.test }) as HTMLButtonElement
    const fetchButton = screen.getByRole("button", { name: t.settings.fetchModels }) as HTMLButtonElement
    const status = screen.getByTestId("test-connection-status")

    expect(testButton.disabled).toBe(true)
    expect(testButton.getAttribute("aria-busy")).toBe("true")
    expect(fetchButton.disabled).toBe(false)
    expect(status.textContent).toBe(t.settings.testing)
    expect(status.getAttribute("aria-live")).toBe("polite")
  })

  it("affiche le succès de connexion dans la cellule de test", () => {
    renderCard({ connectionStatus: { state: "ok" } })

    const status = screen.getByTestId("test-connection-status")
    expect(status.textContent).toBe(t.settings.ok)
    expect(status.closest('[data-state="success"]')).not.toBeNull()
  })

  it("affiche l’échec de récupération sans désactiver les autres actions", () => {
    renderCard({ fetchStatus: { state: "fail", message: t.settings.noKey } })

    const status = screen.getByTestId("fetch-models-status")
    const testButton = screen.getByRole("button", { name: t.settings.test }) as HTMLButtonElement

    expect(status.textContent).toContain(t.settings.fetchFail)
    expect(status.textContent).toContain(t.settings.noKey)
    expect(status.closest('[data-state="error"]')).not.toBeNull()
    expect(testButton.disabled).toBe(false)
  })

  it("annonce le nombre de modèles récupérés", () => {
    renderCard({ fetchStatus: { state: "ok", added: 2 } })

    expect(screen.getByTestId("fetch-models-status").textContent)
      .toBe(`2 ${t.settings.fetchOkAdded}`)
  })
})
```

- [ ] **Step 2: Exécuter les tests et constater les échecs attendus**

Run:

```bash
npm test -- src/components/settings/ProviderCard.test.tsx
```

Expected: FAIL, car les zones de statut n’existent pas et les boutons ne
reflètent pas encore les états.

- [ ] **Step 3: Ajouter le rendu final des états**

Dans `src/components/settings/ProviderCard.tsx`, ajouter `CircleAlert`,
`CircleCheck` et `LoaderCircle` aux imports Lucide. Remplacer
`ProviderActionProps` et `ProviderAction` par :

```tsx
type ActionTone = "idle" | "loading" | "success" | "error"

interface ActionFeedback {
  text: string
  tone: ActionTone
}

interface ProviderActionProps {
  action: string
  statusId: string
  label: string
  Icon: LucideIcon
  feedback: ActionFeedback
  disabled: boolean
  onClick: () => void
}

const statusToneClass: Record<ActionTone, string> = {
  idle: "text-muted-foreground",
  loading: "text-muted-foreground",
  success: "text-green-600 dark:text-green-400",
  error: "text-destructive",
}

function ProviderAction({
  action,
  statusId,
  label,
  Icon,
  feedback,
  disabled,
  onClick,
}: ProviderActionProps) {
  const loading = feedback.tone === "loading"
  const StateIcon = loading
    ? LoaderCircle
    : feedback.tone === "success"
      ? CircleCheck
      : feedback.tone === "error"
        ? CircleAlert
        : Icon

  return (
    <div
      data-state={feedback.tone}
      className="relative min-w-0 rounded-lg transition-colors hover:bg-foreground/5 focus-within:ring-2 focus-within:ring-brand-to motion-reduce:transition-none"
    >
      <button
        type="button"
        data-action={action}
        aria-label={label}
        aria-busy={loading}
        aria-describedby={feedback.text ? statusId : undefined}
        disabled={disabled}
        onClick={onClick}
        className="group/action flex min-h-40 w-full flex-col items-center px-2 pb-16 pt-4 text-center outline-none disabled:cursor-wait disabled:opacity-70"
      >
        <StateIcon
          aria-hidden="true"
          className={`size-7 transition-colors motion-reduce:transition-none ${
            loading
              ? "animate-spin text-brand-to motion-reduce:animate-none"
              : feedback.tone === "idle"
                ? "text-muted-foreground group-hover/action:text-brand-to"
                : statusToneClass[feedback.tone]
          }`}
        />
        <span className="mt-2 text-xs font-medium leading-tight">{label}</span>
      </button>
      <span
        id={statusId}
        data-testid={`${action}-status`}
        aria-live="polite"
        className={`pointer-events-none absolute inset-x-1 bottom-3 min-h-12 text-center text-[10px] leading-tight ${statusToneClass[feedback.tone]}`}
      >
        {feedback.text}
      </span>
    </div>
  )
}
```

Ajouter ensuite ces fonctions avant `ProviderCard` :

```tsx
function connectionFeedback(status: ProviderConnectionStatus): ActionFeedback {
  switch (status.state) {
    case "testing":
      return { text: t.settings.testing, tone: "loading" }
    case "ok":
      return { text: t.settings.ok, tone: "success" }
    case "fail":
      return { text: `${t.settings.fail} — ${status.message}`, tone: "error" }
    case "idle":
      return { text: "", tone: "idle" }
  }
}

function fetchFeedback(status: ProviderFetchStatus | undefined): ActionFeedback {
  if (!status) return { text: "", tone: "idle" }
  switch (status.state) {
    case "fetching":
      return { text: t.settings.fetchingModels, tone: "loading" }
    case "ok":
      return { text: `${status.added} ${t.settings.fetchOkAdded}`, tone: "success" }
    case "fail":
      return { text: `${t.settings.fetchFail} — ${status.message}`, tone: "error" }
  }
}
```

Au début de `ProviderCard`, calculer les retours et leurs identifiants :

```tsx
const connection = connectionFeedback(props.connectionStatus)
const fetch = fetchFeedback(props.fetchStatus)
const testStatusId = `${props.provider.id}-test-status`
const fetchStatusId = `${props.provider.id}-fetch-status`
```

Remplacer les trois appels à `ProviderAction` par :

```tsx
<ProviderAction
  action="test-connection"
  statusId={testStatusId}
  label={t.settings.test}
  Icon={RadioTower}
  feedback={connection}
  disabled={props.connectionStatus.state === "testing"}
  onClick={props.onTest}
/>
<ProviderAction
  action="fetch-models"
  statusId={fetchStatusId}
  label={t.settings.fetchModels}
  Icon={CloudDownload}
  feedback={fetch}
  disabled={props.fetchStatus?.state === "fetching"}
  onClick={props.onFetchModels}
/>
<ProviderAction
  action="edit-provider"
  statusId={`${props.provider.id}-edit-status`}
  label={t.settings.edit}
  Icon={Wrench}
  feedback={{ text: "", tone: "idle" }}
  disabled={false}
  onClick={props.onEdit}
/>
```

- [ ] **Step 4: Exécuter les tests unitaires et obtenir le vert**

Run:

```bash
npm test -- src/components/settings/ProviderCard.test.tsx
```

Expected: PASS, 7 tests passants.

- [ ] **Step 5: Vérifier TypeScript**

Run:

```bash
npx tsc --noEmit
```

Expected: exit code 0.

- [ ] **Step 6: Committer les états d’action**

```bash
git add src/components/settings/ProviderCard.tsx src/components/settings/ProviderCard.test.tsx
git commit -m "feat: afficher les états des actions fournisseur"
```

---

### Task 3: Intégrer la carte dans la galerie

**Files:**
- Modify: `src/components/settings/SettingsDialog.test.tsx`
- Modify: `src/components/settings/SettingsDialog.tsx:1-18,243-365`

- [ ] **Step 1: Écrire le test rouge de la nouvelle composition**

Ajouter ce bloc avant les tests de récupération dans
`src/components/settings/SettingsDialog.test.tsx` :

```tsx
describe("SettingsDialog — cartes fournisseur", () => {
  it("présente les commandes sans afficher la liste des modèles dans la carte", async () => {
    renderDialog()

    const providerName = await screen.findByText("OpenRouter")
    const card = providerName.closest('[data-testid="provider-card"]') as HTMLElement

    expect(within(card).getByRole("button", { name: t.settings.test })).not.toBeNull()
    expect(within(card).getByRole("button", { name: t.settings.fetchModels })).not.toBeNull()
    expect(within(card).getByRole("button", { name: t.settings.edit })).not.toBeNull()
    expect(within(card).getByRole("button", {
      name: `${t.settings.browseModels} (1)`,
    })).not.toBeNull()
    expect(within(card).queryByText("existing/model")).toBeNull()
  })
})
```

- [ ] **Step 2: Exécuter le test d’intégration et constater l’échec attendu**

Run:

```bash
npm test -- src/components/settings/SettingsDialog.test.tsx
```

Expected: FAIL sur `existing/model`, encore rendu dans l’ancienne carte.

- [ ] **Step 3: Importer le composant et partager ses types d’état**

Dans `src/components/settings/SettingsDialog.tsx`, remplacer l’import Lucide par :

```tsx
import { Plus, Search, X } from "lucide-react"
```

Ajouter :

```tsx
import {
  ProviderCard,
  type ProviderConnectionStatus,
  type ProviderFetchStatus,
} from "./ProviderCard"
```

Supprimer les déclarations locales `TestStatus` et `FetchStatus`, puis remplacer
les deux états concernés par :

```tsx
const [testStatus, setTestStatus] = useState<Record<string, ProviderConnectionStatus>>({})
const [fetchStatus, setFetchStatus] = useState<Record<string, ProviderFetchStatus | undefined>>({})
```

- [ ] **Step 4: Remplacer la grille et le JSX de l’ancienne carte**

Remplacer le bloc de galerie actuel par :

```tsx
<div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
  <button
    type="button"
    onClick={() => setEditing("new")}
    className="flex min-h-80 flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed border-border bg-background/50 p-5 outline-none transition-[border-color,background-color] hover:border-brand-to hover:bg-foreground/5 focus-visible:ring-2 focus-visible:ring-brand-to motion-reduce:transition-none"
  >
    <Plus aria-hidden="true" className="size-7 text-muted-foreground" />
    <span className="text-center text-sm font-medium text-muted-foreground">
      {t.settings.addProvider}
    </span>
  </button>

  {rows.length === 0 && (
    <p className="col-span-full text-center text-sm text-muted-foreground">
      {t.settings.noProviders}
    </p>
  )}

  {rows.length > 0 && filteredRows.length === 0 && (
    <p className="col-span-full text-center text-sm text-muted-foreground">
      {t.settings.noProviderResults}
    </p>
  )}

  {filteredRows.map((provider) => (
    <ProviderCard
      key={provider.id}
      provider={provider}
      modelCount={(models[provider.id] ?? []).length}
      connectionStatus={testStatus[provider.id] ?? { state: "idle" }}
      fetchStatus={fetchStatus[provider.id]}
      onTest={() => void test(provider)}
      onFetchModels={() => void fetchModels(provider)}
      onEdit={() => setEditing(provider)}
      onDelete={() => void removeProvider(provider).catch((error) =>
        logSettingsError("settings.removeProvider", error))}
      onBrowseModels={() => setBrowsing(provider)}
    />
  ))}
</div>
```

Ce remplacement retire la liste intégrée, les anciens boutons et leurs blocs de
statut. `ProviderCard` les rend à partir des mêmes états et callbacks.

- [ ] **Step 5: Exécuter les tests ciblés**

Run:

```bash
npm test -- src/components/settings/ProviderCard.test.tsx src/components/settings/SettingsDialog.test.tsx
```

Expected: PASS pour les deux fichiers. Les tests existants de connexion,
récupération, suppression et parcours restent verts.

- [ ] **Step 6: Vérifier TypeScript**

Run:

```bash
npx tsc --noEmit
```

Expected: exit code 0, aucun import ou type inutilisé.

- [ ] **Step 7: Committer l’intégration**

```bash
git add src/components/settings/SettingsDialog.tsx src/components/settings/SettingsDialog.test.tsx
git commit -m "style: intégrer les nouvelles cartes fournisseur"
```

---

### Task 4: Vérifier le rendu et les garde-fous du projet

**Files:**
- Verify: `src/components/settings/ProviderCard.tsx`
- Verify: `src/components/settings/SettingsDialog.tsx`

- [ ] **Step 1: Exécuter la suite TypeScript complète**

Run:

```bash
npm test
```

Expected: 44 fichiers de tests passants, au moins 507 tests passants, zéro
échec. Le nombre exact peut être supérieur si un test de régression pertinent a
été ajouté pendant l’exécution.

- [ ] **Step 2: Vérifier les espaces et l’état Git**

Run:

```bash
git diff --check
git status --short
```

Expected: `git diff --check` ne produit aucune sortie et `git status --short`
ne montre aucun changement après les commits précédents.

- [ ] **Step 3: Exécuter le build dans Windows**

Depuis PowerShell Windows :

```powershell
Set-Location C:\dev\LogAssist\.worktrees\redesign-cartes-fournisseurs
npm run build
```

Expected: TypeScript, Vitest et Vite terminent avec un exit code 0. Ne pas
lancer `npm install` depuis WSL si une dépendance manque.

- [ ] **Step 4: Contrôler visuellement la galerie dans les deux thèmes**

Depuis PowerShell Windows :

```powershell
Set-Location C:\dev\LogAssist\.worktrees\redesign-cartes-fournisseurs
npm run dev
```

Ouvrir les réglages et vérifier :

1. trois cartes par ligne dans la largeur standard du dialogue ;
2. deux colonnes quand la fenêtre rétrécit, puis une colonne ;
3. nom et URL tronqués sans déplacer la poubelle ;
4. ligne de séparation et trois cellules de largeur identique ;
5. chargement, succès et erreur dans la cellule concernée ;
6. compteur mis à jour après récupération ;
7. bouton `Parcourir les modèles` ouvrant toujours la modale ;
8. focus visible sur chaque contrôle au clavier ;
9. contraste lisible en thème clair et sombre ;
10. aucune variation de hauteur quand un statut apparaît.

---

## Résultat attendu

La galerie présente des cartes presque carrées, trois par ligne, avec une
hiérarchie identique à la référence validée. `SettingsDialog` garde la logique
métier et `ProviderCard` concentre la présentation. Les actions conservent leurs
comportements, leurs erreurs filtrées et leur accessibilité dans les thèmes clair
et sombre.
