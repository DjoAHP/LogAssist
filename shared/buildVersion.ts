// Source unique de vérité pour la version : package.json.
// Consommé par vite.config.ts (runtime UI) et vitest.config.ts (tests),
// injecté au compile-time via la macro __APP_VERSION__ (declare dans vite-env.d.ts).
import fs from "node:fs";
import path from "node:path";

const pkg = JSON.parse(
  fs.readFileSync(path.resolve(import.meta.dirname, "../package.json"), "utf-8"),
) as { version: string };

export const appVersion: string = pkg.version;

export const versionDefine = {
  __APP_VERSION__: JSON.stringify(appVersion),
};
