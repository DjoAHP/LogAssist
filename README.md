# LogAssist

Assistant IA de bureau (Windows) pour apprendre des logiciels via captures d'écran.

Stack : **Tauri 2 + React + TypeScript + Vite**, Tailwind CSS (préparation shadcn/ui).

## Développement

```bash
npm install
npm run tauri dev   # nécessite Rust (tauri) installé
npm run build       # build frontend seul (tsc + vite)
```

## Structure

- `src/` — frontend React/TypeScript
- `src-tauri/` — backend Tauri (Rust)
- `docs/` — design spec et plan d'implémentation
