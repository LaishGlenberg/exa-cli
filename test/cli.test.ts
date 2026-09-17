import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, test } from "node:test";
import { fileURLToPath } from "node:url";

const projectRoot = fileURLToPath(new URL("..", import.meta.url));
const cliEntry = fileURLToPath(new URL("../src/cli.ts", import.meta.url));
const pkg = JSON.parse(
  readFileSync(join(projectRoot, "package.json"), "utf8"),
) as { version: string };

let dir: string;
let emptyEnvFile: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "exa-cli-"));
  // dotenv would otherwise load the repo's real .env, which contains a key.
  emptyEnvFile = join(dir, "empty.env");
  writeFileSync(emptyEnvFile, "");
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

/** Runs the real entry point in a child process with a clean env. */
function runCli(args: string[], env: NodeJS.ProcessEnv = {}) {
  const base = { ...process.env };
  delete base.EXA_API_KEY;
  delete base.EXA_CONFIG_DIR;
  delete base.XDG_CONFIG_HOME;

  return spawnSync(process.execPath, ["--import", "tsx", cliEntry, ...args], {
    cwd: projectRoot,
    encoding: "utf8",
    env: {
      ...base,
      EXA_CONFIG_DIR: dir,
      DOTENV_CONFIG_PATH: emptyEnvFile,
      ...env,
    },
  });
}

describe("exa --version", () => {
  test("prints the version from package.json", () => {
    const result = runCli(["--version"]);
    assert.equal(result.status, 0);
    assert.equal(result.stdout.trim(), pkg.version);
  });
});

describe("exa auth", () => {
  test("saves a key and status reports it masked", () => {
    const save = runCli(["auth", "exa-abcdef1234567890"]);
    assert.equal(save.status, 0);
    assert.match(save.stdout, /Saved Exa API key/);

    const status = runCli(["auth", "status"]);
    assert.equal(status.status, 0);
    assert.match(status.stdout, /exa-…7890/);
    assert.doesNotMatch(status.stdout, /abcdef/);
    assert.match(status.stdout, /config file/);
  });

  test("status reports no key when nothing is configured", () => {
    const status = runCli(["auth", "status"]);
    assert.equal(status.status, 0);
    assert.match(status.stdout, /No Exa API key configured/);
  });

  test("EXA_API_KEY outranks the saved key", () => {
    runCli(["auth", "exa-saved1234567890"]);
    const status = runCli(["auth", "status"], {
      EXA_API_KEY: "exa-envkey1234567890",
    });
    assert.match(status.stdout, /EXA_API_KEY/);
    assert.match(status.stdout, /exa-…7890/);
  });

  test("logout removes the saved key", () => {
    runCli(["auth", "exa-saved1234567890"]);
    const logout = runCli(["auth", "logout"]);
    assert.equal(logout.status, 0);
    assert.match(logout.stdout, /Removed saved API key/);

    const status = runCli(["auth", "status"]);
    assert.match(status.stdout, /No Exa API key configured/);
  });
});

describe("missing credentials", () => {
  test("key-required commands exit 1 with guidance", () => {
    const result = runCli(["deep-search", "hello"]);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /requires an Exa API key/);
    assert.match(result.stderr, /exa auth/);
  });
});
