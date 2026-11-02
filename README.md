# LogAssist

![Capture d'écran de l'application](src/assets/capture_ecran_interface.png)

Assistant IA de bureau (Windows) pour apprendre des logiciels par conversation persistée.

**Stack** : **Tauri 2 + React 19 + TypeScript + Vite**, Tailwind CSS, SQLite (`tauri-plugin-sql`), Credential Manager Windows.

---

## Fonctionnalités principales

- **Conversations persistées** (SQLite) avec export Markdown
- **Fournisseurs LLM configurables** (OpenAI-compatible : OpenRouter, OpenAI, Gemini, NVIDIA NIM…)
- **Clé API stockée dans le Credential Manager Windows** (jamais en clair dans la DB/logs)
- **System prompt modulaire** + base de connaissances (.md) par conversation
- **Parcourt des modèles** : modal unifié (recherche, ajout textuel, activation par clic)
- **Dark / Light mode** (toggle header, défaut dark, persistance `localStorage`)
- **Fenêtre maximisée au lancement** (Windows)

---

## Développement

```bash
# Dépendances (depuis PowerShell pour binaires Windows natifs)
npm install

# Dev : Rust + Vite + fenêtre Tauri (HMR)
npm run tauri dev

# Build frontend seul (tsc + vitest + vite)
npm run build

# Build complet + installeur .exe/.msi (nécessite Rust toolchain Windows)
npm run tauri build
```

> ⚠️ **Règle critique** : `npm install` et `tauri build` **depuis PowerShell Windows** (pas WSL). Les binaires natifs Windows (`@tauri-apps/cli-win32-x64-msvc`, `keyring`, etc.) ne s'installent correctement que sous Windows.

---

## Structure

```
src/                    # Frontend React/TypeScript
├── components/         # UI (chat/, settings/, sidebar/)
├── hooks/              # useChat (streaming + persist), useConversations
├── lib/
│   ├── ai/             # IProvider, openai-compat, sse.ts, errors.ts, factory
│   ├── db/             # SQLite repos (migrations, providers, messages, conversations…)
│   ├── secrets/        # Credential Manager (invoke Rust)
│   ├── prompts/        # System prompt + knowledge base
│   └── i18n/fr.ts      # Toutes les chaînes UI (0 littéral en dur)
└── *.test.ts(x)        # Vitest (lib sans DOM, composants jsdom)

src-tauri/              # Backend Tauri (Rust)
├── src/commands/       # Commandes Tauri (secrets, etc.)
├── capabilities/       # Permissions (sql, opener, http, dialog, fs)
├── tauri.conf.json     # Config fenêtre, CSP, icônes, bundle
├── icons/              # Icônes générées depuis logo3.png (script generate-icons.js)
└── Cargo.toml
```

---

## Fonctionnalités v2.1.2

| Fonctionnalité | État | Détails |
|----------------|------|---------|
| **Dark / Light mode** | ✅ | Toggle header (🌙/☀️), défaut dark, `localStorage` |
| **Fenêtre maximisée** | ✅ | `maximized: true` dans `tauri.conf.json` |
| **Icônes unifiées** | ✅ | Générées depuis `logo3.png` (script `scripts/generate-icons.js`) |
| **Parcourt modèles** | ✅ | Modal (recherche + ajout textuel + clic = activation) |
| **Suppression provider avec confirmation** | ✅ | Dialogue natif Windows (`@tauri-apps/plugin-dialog`) |

---

## Scripts utiles

```bash
npm run dev           # Vite seul (http://localhost:1420)
npm run test          # npx vitest run
npm run sync:version  # Sync version package.json / Cargo.toml / tauri.conf.json
```

---

## Build release (Windows)

```powershell
# Depuis PowerShell (pas WSL)
cd C:\dev\LogAssist
npm run tauri build
# → src-tauri/target/release/bundle/msi/LogAssist_2.1.2_x64_en-US.msi
# → src-tauri/target/release/bundle/nsis/LogAssist_2.1.2_x64-setup.exe
```

---

## Tests

```bash
npm run test          # 152 tests (unitaires + composants jsdom)
# gated dans npm run build
```

---

## Règles critiques

- **Zéro `console.log`** hors `src/lib/logger.ts` (garde-fou `console-log.guard.test.ts`)
- **SQL 100 % paramétré** (`?` binds) — jamais de concaténation
- **Aucun `innerHTML` / `dangerouslySetInnerHTML`** — contenu LLM échappé par React
- **Clé API** : uniquement dans Credential Manager (`secretRefFor()`), jamais en DB/logs
- **TDD** : test d'abord (rouge), puis implémentation (vert), puis refactor
- **Commits conventionnels** : `feat:`, `fix:`, `chore:`