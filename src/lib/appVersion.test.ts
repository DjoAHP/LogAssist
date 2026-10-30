import { describe, expect, it } from "vitest";
import { appVersion } from "./appVersion";

describe("appVersion", () => {
  it("est injecté par Vite au format semver", () => {
    // Garde-fou : si la macro __APP_VERSION__ n'est pas définie
    // (vite.config.ts), la constante vaut "unknown" et ce test est rouge.
    expect(appVersion).toMatch(/^\d+\.\d+\.\d+(-[\w.]+)?$/);
  });
});
