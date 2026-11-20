/// <reference types="vite/client" />

// Version du package.json injectée par vite.config.ts au compile-time.
declare const __APP_VERSION__: string;

// Édition compilée : définie par `.env.portable`, absente en dev et en test.
interface ImportMetaEnv {
  readonly VITE_EDITION?: "desktop" | "portable"
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
