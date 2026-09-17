import { readFileSync } from "node:fs";

/**
 * Reads the version from package.json at runtime.
 *
 * `import.meta.url` points at `src/version.ts` in development and
 * `dist/version.js` once compiled, so `../package.json` resolves to the
 * package root in both cases (and after a global install).
 */
function readVersion(): string {
  try {
    const pkg = JSON.parse(
      readFileSync(new URL("../package.json", import.meta.url), "utf8"),
    ) as { version?: string };
    return pkg.version ?? "0.0.0";
  } catch {
    return "0.0.0";
  }
}

export const VERSION = readVersion();
