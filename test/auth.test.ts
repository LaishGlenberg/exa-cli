import assert from "node:assert/strict";
import {
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, test } from "node:test";
import {
  clearApiKey,
  configDir,
  configPath,
  describeApiKeySource,
  maskApiKey,
  readConfig,
  resolveApiKey,
  saveApiKey,
} from "../src/auth.js";

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "exa-auth-"));
  process.env.EXA_CONFIG_DIR = dir;
  delete process.env.EXA_API_KEY;
  delete process.env.XDG_CONFIG_HOME;
});

afterEach(() => {
  delete process.env.EXA_CONFIG_DIR;
  delete process.env.EXA_API_KEY;
  delete process.env.XDG_CONFIG_HOME;
  rmSync(dir, { recursive: true, force: true });
});

describe("configDir", () => {
  test("honours EXA_CONFIG_DIR", () => {
    assert.equal(configDir(), dir);
  });

  test("falls back to XDG_CONFIG_HOME", () => {
    delete process.env.EXA_CONFIG_DIR;
    process.env.XDG_CONFIG_HOME = "/tmp/xdg-home";
    assert.equal(configDir(), join("/tmp/xdg-home", "exa-cli"));
  });
});

describe("saveApiKey", () => {
  test("writes the key to a 0600 file", () => {
    const path = saveApiKey("exa-secret");
    assert.equal(path, configPath());

    const mode = statSync(path).mode & 0o777;
    assert.equal(mode, 0o600);

    const parsed = JSON.parse(readFileSync(path, "utf8"));
    assert.equal(parsed.apiKey, "exa-secret");
  });

  test("preserves unrelated config fields", () => {
    writeFileSync(configPath(), JSON.stringify({ other: true }));
    saveApiKey("exa-secret");
    assert.deepEqual(readConfig(), { other: true, apiKey: "exa-secret" });
  });
});

describe("readConfig", () => {
  test("returns an empty object when the file does not exist", () => {
    assert.deepEqual(readConfig(), {});
  });

  test("returns an empty object for corrupt JSON instead of throwing", () => {
    writeFileSync(configPath(), "{ not json");
    assert.deepEqual(readConfig(), {});
  });
});

describe("clearApiKey", () => {
  test("removes the saved key", () => {
    saveApiKey("exa-secret");
    assert.equal(clearApiKey(), true);
    assert.equal(readConfig().apiKey, undefined);
  });

  test("returns false when nothing was saved", () => {
    assert.equal(clearApiKey(), false);
  });
});

describe("resolveApiKey", () => {
  test("applies flag > env > config precedence", () => {
    assert.deepEqual(resolveApiKey(), { source: "none" });

    saveApiKey("from-config");
    assert.deepEqual(resolveApiKey(), {
      apiKey: "from-config",
      source: "config",
    });

    process.env.EXA_API_KEY = "from-env";
    assert.deepEqual(resolveApiKey(), { apiKey: "from-env", source: "env" });

    assert.deepEqual(resolveApiKey("from-flag"), {
      apiKey: "from-flag",
      source: "flag",
    });
  });
});

describe("maskApiKey", () => {
  test("shows the first and last four characters of a long key", () => {
    assert.equal(maskApiKey("exa-abcdef1234567890"), "exa-…7890");
  });

  test("fully masks short keys", () => {
    assert.equal(maskApiKey("abcdefgh"), "********");
    assert.equal(maskApiKey("short"), "*****");
  });
});

describe("describeApiKeySource", () => {
  test("names the env source", () => {
    assert.match(describeApiKeySource("env"), /EXA_API_KEY/);
  });

  test("includes the config path for the config source", () => {
    assert.ok(describeApiKeySource("config").includes(configPath()));
  });
});
