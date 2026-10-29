# LogAssist

Assistant IA de bureau (Windows) pour apprendre des logiciels via captures d'écran.

Stack : **Tauri 2 + React + TypeScript + Vite**, Tailwind CSS (préparation shadcn/ui).

## Développement

```bash
npm install
npm run tauri dev   # nécessite Rust (tauri) installé
npm run build       # build frontend seul (tsc + vite)
npm run tauri build  #Genere le .exe (src-tauri/target/release/bundle/nsis/LogAssist_x64-setup.exe)
```

## Structure

- `src/` — frontend React/TypeScript
- `src-tauri/` — backend Tauri (Rust)
- `docs/` — design spec et plan d'implémentation
