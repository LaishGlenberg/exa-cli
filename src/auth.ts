import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

/**
 * Persistent CLI config. Stored as JSON so future settings can be added
 * without breaking existing files.
 */
export interface ExaConfig {
  apiKey?: string;
}

/**
 * Where credentials live. Honours `EXA_CONFIG_DIR`, then `XDG_CONFIG_HOME`,
 * and falls back to `~/.config/exa-cli`.
 */
export function configDir(): string {
  if (process.env.EXA_CONFIG_DIR) return process.env.EXA_CONFIG_DIR;
  if (process.env.XDG_CONFIG_HOME) {
    return join(process.env.XDG_CONFIG_HOME, "exa-cli");
  }
  return join(homedir(), ".config", "exa-cli");
}

export function configPath(): string {
  return join(configDir(), "config.json");
}

export function readConfig(): ExaConfig {
  const path = configPath();
  if (!existsSync(path)) return {};

  try {
    const parsed: unknown = JSON.parse(readFileSync(path, "utf8"));
    if (parsed !== null && typeof parsed === "object") {
      return parsed as ExaConfig;
    }
  } catch {
    // A corrupt config should not make every command fail; treat it as empty.
    return {};
  }
  return {};
}

function writeConfig(config: ExaConfig): string {
  const dir = configDir();
  mkdirSync(dir, { recursive: true, mode: 0o700 });

  const path = configPath();
  writeFileSync(path, `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600 });
  // `mode` is ignored when the file already exists, so enforce it explicitly.
  chmodSync(path, 0o600);
  return path;
}

/** Persists an API key and returns the file it was written to. */
export function saveApiKey(apiKey: string): string {
  const config = readConfig();
  config.apiKey = apiKey;
  return writeConfig(config);
}

/** Removes a saved API key. Returns false if there was nothing to remove. */
export function clearApiKey(): boolean {
  const config = readConfig();
  if (!config.apiKey) return false;
  delete config.apiKey;
  writeConfig(config);
  return true;
}

export type ApiKeySource = "flag" | "env" | "config" | "none";

export interface ResolvedApiKey {
  apiKey?: string;
  source: ApiKeySource;
}

/**
 * Resolves the API key with the documented precedence:
 * `--api-key` flag > `EXA_API_KEY` env var (including a `.env` file, which
 * dotenv loads into the environment) > saved config file.
 */
export function resolveApiKey(flag?: string): ResolvedApiKey {
  if (flag) return { apiKey: flag, source: "flag" };
  if (process.env.EXA_API_KEY) {
    return { apiKey: process.env.EXA_API_KEY, source: "env" };
  }

  const stored = readConfig().apiKey;
  if (stored) return { apiKey: stored, source: "config" };

  return { source: "none" };
}

/** Masks a key for display, e.g. `exa-1234…cdef`. */
export function maskApiKey(apiKey: string): string {
  if (apiKey.length <= 8) return "*".repeat(apiKey.length);
  return `${apiKey.slice(0, 4)}…${apiKey.slice(-4)}`;
}

export function describeApiKeySource(source: ApiKeySource): string {
  switch (source) {
    case "flag":
      return "--api-key flag";
    case "env":
      return "EXA_API_KEY environment variable (or .env)";
    case "config":
      return `config file (${configPath()})`;
    case "none":
      return "not configured";
  }
}
