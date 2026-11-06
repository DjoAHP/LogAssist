# Chat UI — Palier 2A Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rendre l’amélioration du chat immédiatement visible avec une présentation hybride fidèle à LogAssist et un auto-scroll qui respecte la lecture de l’utilisateur.

**Architecture:** La proximité du bas est calculée par une fonction pure. `ChatView` suit le flux seulement si l’utilisateur est près du bas et affiche un bouton de retour lorsque du contenu arrive pendant une lecture plus haute.

**Tech Stack:** React 19, TypeScript strict, Tailwind CSS 3, Vitest 5, Testing Library.

---

## Périmètre

Inclus : largeur de lecture bornée, bulle utilisateur conservée, réponse assistant ouverte avec filet cyan, auto-scroll respectueux, bouton de retour, réduction des animations.

Reporté au palier 2B : Régénérer, Continuer, Retenter, édition, branches et nouveau composeur.

Interdit : nouvelle palette, orange, modification de `useChat`, SQLite, fournisseurs, MCP, Rust ou ajout de dépendance.

## Fichiers

- Create: `src/lib/chat/scrollPolicy.ts`
- Create: `src/lib/chat/scrollPolicy.test.ts`
- Modify: `src/components/chat/ChatView.tsx`
- Modify: `src/components/chat/ChatView.test.tsx`
- Modify: `src/App.tsx`
- Modify: `src/i18n/fr.ts`

---

### Task 1: Politique de proximité du bas

**Files:**
- Create: `src/lib/chat/scrollPolicy.ts`
- Create: `src/lib/chat/scrollPolicy.test.ts`

- [ ] **Step 1: Écrire les tests rouges**

```ts
import { describe, expect, it } from "vitest"
import { CHAT_BOTTOM_THRESHOLD, isNearChatBottom } from "./scrollPolicy"

describe("isNearChatBottom", () => {
  it("suit le bas exact", () => {
    expect(isNearChatBottom({ scrollTop: 700, clientHeight: 300, scrollHeight: 1_000 })).toBe(true)
  })

  it("inclut exactement le seuil", () => {
    expect(isNearChatBottom({
      scrollTop: 700 - CHAT_BOTTOM_THRESHOLD,
      clientHeight: 300,
      scrollHeight: 1_000,
    })).toBe(true)
  })

  it("fige au-delà du seuil", () => {
    expect(isNearChatBottom({
      scrollTop: 699 - CHAT_BOTTOM_THRESHOLD,
      clientHeight: 300,
      scrollHeight: 1_000,
    })).toBe(false)
  })

  it("suit un contenu plus court que le conteneur", () => {
    expect(isNearChatBottom({ scrollTop: 0, clientHeight: 500, scrollHeight: 300 })).toBe(true)
  })
})
```

- [ ] **Step 2: Constater l’échec**

```bash
npx vitest run src/lib/chat/scrollPolicy.test.ts
```

Expected: FAIL, module absent.

- [ ] **Step 3: Implémenter**

```ts
export const CHAT_BOTTOM_THRESHOLD = 80

interface ScrollMetrics {
  scrollTop: number
  clientHeight: number
  scrollHeight: number
}

export function isNearChatBottom(metrics: ScrollMetrics): boolean {
  const remaining = metrics.scrollHeight - metrics.clientHeight - metrics.scrollTop
  return remaining <= CHAT_BOTTOM_THRESHOLD
}
```

- [ ] **Step 4: Vérifier et committer**

```bash
npx vitest run src/lib/chat/scrollPolicy.test.ts
npx tsc --noEmit
git add src/lib/chat/scrollPolicy.ts src/lib/chat/scrollPolicy.test.ts
git commit -m "feat: ajoute la politique de scroll du chat"
```

---

### Task 2: Respecter la position de lecture

**Files:**
- Modify: `src/components/chat/ChatView.tsx`
- Modify: `src/components/chat/ChatView.test.tsx`
- Modify: `src/App.tsx`
- Modify: `src/i18n/fr.ts`

- [ ] **Step 1: Ajouter le helper de test**

```ts
function setScrollMetrics(
  element: HTMLElement,
  metrics: { scrollTop: number; clientHeight: number; scrollHeight: number },
): void {
  Object.defineProperties(element, {
    scrollTop: { configurable: true, writable: true, value: metrics.scrollTop },
    clientHeight: { configurable: true, value: metrics.clientHeight },
    scrollHeight: { configurable: true, value: metrics.scrollHeight },
  })
}
```

- [ ] **Step 2: Tester le suivi près du bas**

Rendre `ChatView` avec `conversationId="conv-1"`, remplacer `scrollTo` par `vi.fn()`, définir un bas à `1_100`, puis rerender avec un delta. Attendre :

```ts
expect(scrollTo).toHaveBeenCalledWith({ top: 1_100, behavior: "auto" })
expect(screen.queryByRole("button", {
  name: "Revenir en bas de la conversation",
})).toBeNull()
```

- [ ] **Step 3: Tester la lecture figée**

Définir `scrollTop: 100`, `clientHeight: 300`, `scrollHeight: 1_000`, déclencher `fireEvent.scroll(log)`, vider le mock, puis rerender avec un delta. Attendre :

```ts
expect(scrollTo).not.toHaveBeenCalled()
expect(screen.getByRole("button", {
  name: "Revenir en bas de la conversation",
})).toBeTruthy()
```

- [ ] **Step 4: Tester le retour et reduced-motion**

Avec `matchMedia.matches=false`, cliquer le bouton et attendre `behavior: "smooth"`. Avec `matches=true`, attendre `behavior: "auto"`. Dans les deux cas le bouton disparaît.

- [ ] **Step 5: Tester le changement de conversation**

Après une lecture figée dans `conv-1`, rerender avec `conversationId="conv-2"`. Attendre disparition du bouton et scroll automatique au nouveau bas.

- [ ] **Step 6: Confirmer les échecs**

```bash
npx vitest run src/components/chat/ChatView.test.tsx
```

Expected: FAIL car `ChatView` utilise encore `scrollIntoView`.

- [ ] **Step 7: Ajouter l’i18n**

```ts
newResponse: "Nouvelle réponse",
backToBottom: "Revenir en bas de la conversation",
```

- [ ] **Step 8: Ajouter l’état de scroll dans `ChatView`**

Ajouter `conversationId?: string | null` aux props, importer `isNearChatBottom`, puis :

```ts
const scrollRef = useRef<HTMLDivElement>(null)
const shouldFollowRef = useRef(true)
const [hasUnreadContent, setHasUnreadContent] = useState(false)

const scrollToBottom = (behavior: ScrollBehavior): void => {
  const element = scrollRef.current
  if (!element) return
  element.scrollTo({ top: element.scrollHeight, behavior })
}

const onScroll = (): void => {
  const element = scrollRef.current
  if (!element) return
  const follows = isNearChatBottom(element)
  shouldFollowRef.current = follows
  if (follows) setHasUnreadContent(false)
}

const jumpToBottom = (): void => {
  shouldFollowRef.current = true
  setHasUnreadContent(false)
  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches
  scrollToBottom(reduced ? "auto" : "smooth")
}
```

- [ ] **Step 9: Remplacer le scroll forcé**

Retirer `bottomRef`, la sentinelle et `scrollIntoView`. Ajouter :

```ts
useEffect(() => {
  if (shouldFollowRef.current) scrollToBottom("auto")
  else if (vm.length > 0) setHasUnreadContent(true)
}, [vm.length, last?.content])

useEffect(() => {
  shouldFollowRef.current = true
  setHasUnreadContent(false)
  const frame = requestAnimationFrame(() => scrollToBottom("auto"))
  return () => cancelAnimationFrame(frame)
}, [conversationId])
```

- [ ] **Step 10: Adapter le JSX**

La zone scrollable reçoit `ref={scrollRef}`, `onScroll={onScroll}`, `role="log"`, `h-full overflow-y-auto`. Les messages vivent dans :

```tsx
<div className="mx-auto w-full max-w-5xl space-y-4">
  {/* états et messages existants */}
</div>
```

Dans une enveloppe `relative flex-1 overflow-hidden`, ajouter :

```tsx
{hasUnreadContent && (
  <button
    type="button"
    onClick={jumpToBottom}
    aria-label={t.chat.backToBottom}
    className="absolute bottom-3 left-1/2 -translate-x-1/2 rounded-full border border-[var(--brand-to)] bg-background/95 px-3 py-1.5 text-xs text-foreground shadow-lg hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand-to)]"
  >
    ↓ {t.chat.newResponse}
  </button>
)}
```

- [ ] **Step 11: Transmettre `activeId`**

Dans `App.tsx`, passer à `ChatView` :

```tsx
conversationId={activeId}
```

- [ ] **Step 12: Vérifier et committer**

```bash
npx vitest run src/components/chat/ChatView.test.tsx src/App.test.tsx src/lib/chat/scrollPolicy.test.ts
npx tsc --noEmit
git add src/components/chat/ChatView.tsx src/components/chat/ChatView.test.tsx src/App.tsx src/i18n/fr.ts
git commit -m "feat: respecte la lecture pendant le streaming"
```

---

### Task 3: Appliquer la présentation hybride A

**Files:**
- Modify: `src/components/chat/ChatView.tsx`
- Modify: `src/components/chat/ChatView.test.tsx`

- [ ] **Step 1: Écrire les tests rouges de morphologie**

Rendre un message user et un assistant puis vérifier :

```ts
const userBubble = screen.getByTestId("message-user")
expect(userBubble.className).toContain("rounded-lg")
expect(userBubble.className).toContain("border")
expect(userBubble.className).toContain("bg-foreground/5")

const assistantBubble = screen.getByTestId("message-assistant")
expect(assistantBubble.className).toContain("border-l-2")
expect(assistantBubble.className).toContain("border-l-[var(--brand-to)]")
expect(assistantBubble.className).toContain("bg-transparent")
```

Ajouter un test assistant en erreur qui attend `border-destructive` et `bg-destructive/10`.

- [ ] **Step 2: Ajouter les identifiants de rôle**

```tsx
data-testid={`message-${m.role}`}
```

- [ ] **Step 3: Définir les classes par rôle**

```ts
const bubbleClass = m.apiError
  ? "max-w-[88%] rounded-lg border border-destructive bg-destructive/10 px-3 py-2"
  : isUser
    ? "max-w-[80%] rounded-lg border border-border bg-foreground/5 px-3 py-2"
    : "w-full max-w-[56rem] border-l-2 border-l-[var(--brand-to)] bg-transparent px-4 py-2"
```

Utiliser :

```tsx
<div data-testid={`message-${m.role}`} className={`text-sm ${bubbleClass}`}>
```

Ne modifier aucun enfant Markdown, source, image, erreur, métrique ou bouton.

- [ ] **Step 4: Vérifier les tests et la palette**

```bash
npx vitest run src/components/chat/ChatView.test.tsx src/brand-color.guard.test.ts
npx tsc --noEmit
```

Expected: PASS sans nouvelle couleur hors variables de marque.

- [ ] **Step 5: Committer**

```bash
git add src/components/chat/ChatView.tsx src/components/chat/ChatView.test.tsx
git commit -m "feat: ouvre la surface de lecture assistant"
```

---

### Task 4: Vérifier le palier 2A

**Files:**
- Verify: files changed by Tasks 1-3

- [ ] **Step 1: Exécuter les suites ciblées**

```bash
npx vitest run src/lib/chat/scrollPolicy.test.ts src/components/chat/ChatView.test.tsx src/App.test.tsx src/components/chat/InputBar.test.tsx src/hooks/useChat.test.tsx src/brand-color.guard.test.ts src/console-log.guard.test.ts
```

Expected: PASS.

- [ ] **Step 2: Exécuter le build WSL**

```bash
npm run build
```

Expected: TypeScript, tous les tests et Vite passent. Ne pas lancer `npm install` depuis WSL.

- [ ] **Step 3: Vérifier le périmètre Git**

```bash
git diff --name-only 96f481e..HEAD
git diff 96f481e..HEAD -- src/hooks/useChat.ts src/lib/db src/lib/ai src/lib/mcp src-tauri src/index.css tailwind.config.js
```

Expected: le premier diff contient uniquement plan, `App.tsx`, `ChatView.tsx/test`, `fr.ts`, `scrollPolicy.ts/test`; le second diff est vide.

- [ ] **Step 4: Exécuter le build Windows**

```powershell
Set-Location "C:\dev\LogAssist\.worktrees\chat-engine-palier-1"
npm run build
```

Expected: TypeScript, tests et Vite passent depuis le worktree Windows.

- [ ] **Step 5: Valider manuellement dans Tauri**

```powershell
npm run tauri dev
```

Vérifier :

1. messages user inchangés ;
2. assistants plus ouverts avec filet cyan discret ;
3. suivi automatique tant que la vue reste au bas ;
4. aucun déplacement après remontée ;
5. bouton « Nouvelle réponse » fonctionnel ;
6. changement de conversation réactive le suivi ;
7. thèmes clair et sombre lisibles ;
8. Markdown, code, images, sources et métriques inchangés.

Ne pas commencer le palier 2B dans ce plan.

---

## Définition de terminé

- Différence visible immédiate mais fidèle à LogAssist.
- Cyan existant utilisé comme accent secondaire uniquement.
- Lecture jamais forcée pendant le streaming.
- Bouton de retour visible seulement si du contenu arrive hors du bas.
- Changement de conversation réinitialise le suivi.
- Aucun changement moteur, persistance, fournisseur, MCP ou image.
- Tests ciblés, suite complète et build Windows passent.
