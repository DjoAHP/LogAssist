# Chat Spacing and Background Adjustment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Redonner aux réponses assistant le voile translucide des questions et rapprocher les échanges des bords du chat.

**Architecture:** Correction locale de classes Tailwind dans `ChatView`. Aucun état, comportement, moteur ou stockage n’est modifié.

**Tech Stack:** React 19, TypeScript, Tailwind CSS 3, Vitest, Testing Library.

---

### Task 1: Ajuster le fond et la largeur du chat

**Files:**
- Modify: `src/components/chat/ChatView.tsx`
- Test: `src/components/chat/ChatView.test.tsx`

- [ ] **Step 1: Écrire les tests rouges**

```ts
const assistantBubble = screen.getByTestId("message-assistant")
expect(assistantBubble.className).toContain("bg-foreground/5")
expect(assistantBubble.className).not.toContain("bg-transparent")
expect(assistantBubble.className).toContain("border-l-[var(--brand-to)]")

const log = screen.getByRole("log")
const content = log.firstElementChild as HTMLElement
expect(content.className).toContain("max-w-[90rem]")
expect(content.className).not.toContain("max-w-5xl")
```

Conserver les assertions existantes : question `bg-foreground/5`, erreur `bg-destructive/10`, aucun filet cyan sur erreur.

- [ ] **Step 2: Confirmer l’échec**

```bash
npx vitest run src/components/chat/ChatView.test.tsx
```

Expected: FAIL sur `bg-transparent` et `max-w-5xl`.

- [ ] **Step 3: Appliquer les classes validées**

Conteneur central :

```tsx
className="mx-auto w-full max-w-[90rem] space-y-4"
```

Assistant normal :

```ts
"w-full max-w-[56rem] border-l-2 border-l-[var(--brand-to)] bg-foreground/5 px-4 py-2"
```

Ne modifier aucune autre classe ou logique.

- [ ] **Step 4: Vérifier**

```bash
npx vitest run src/components/chat/ChatView.test.tsx src/brand-color.guard.test.ts
npx tsc --noEmit
git diff --check
```

Expected: tous les tests passent, sans changement hors deux classes et tests associés.

- [ ] **Step 5: Committer**

```bash
git add src/components/chat/ChatView.tsx src/components/chat/ChatView.test.tsx
git commit -m "fix: ajuste le fond et les marges du chat"
```

---

## Définition de terminé

- Réponses assistant en `bg-foreground/5`.
- Filet cyan conservé.
- Zone centrale en `max-w-[90rem]`.
- Auto-scroll inchangé.
- Tests ChatView, couleurs et TypeScript verts.
