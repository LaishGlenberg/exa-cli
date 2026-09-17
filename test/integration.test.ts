import "dotenv/config";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { fileURLToPath } from "node:url";

const projectRoot = fileURLToPath(new URL("..", import.meta.url));
const cliEntry = fileURLToPath(new URL("../src/cli.ts", import.meta.url));
const runIntegration = process.env.EXA_RUN_INTEGRATION === "1";
const apiKey = process.env.EXA_API_KEY;

let configDir: string;
let emptyEnvFile: string;

before(() => {
  configDir = mkdtempSync(join(tmpdir(), "exa-cli-integration-"));
  emptyEnvFile = join(configDir, "empty.env");
  writeFileSync(emptyEnvFile, "");
});

after(() => {
  rmSync(configDir, { recursive: true, force: true });
});

function runCli(args: string[], env: NodeJS.ProcessEnv = {}) {
  const cleanEnv = { ...process.env };
  delete cleanEnv.EXA_API_KEY;
  delete cleanEnv.EXA_CONFIG_DIR;
  delete cleanEnv.XDG_CONFIG_HOME;

  return spawnSync(process.execPath, ["--import", "tsx", cliEntry, ...args], {
    cwd: projectRoot,
    encoding: "utf8",
    timeout: 90_000,
    env: {
      ...cleanEnv,
      EXA_CONFIG_DIR: configDir,
      DOTENV_CONFIG_PATH: emptyEnvFile,
      ...env,
    },
  });
}

function jsonOutput(result: ReturnType<typeof runCli>): any {
  assert.equal(result.error, undefined, result.error?.message);
  assert.equal(result.status, 0, result.stderr);
  assert.notEqual(result.stdout.trim(), "", "CLI produced no JSON output");
  return JSON.parse(result.stdout);
}

function contentTexts(raw: unknown): string[] {
  if (raw === null || typeof raw !== "object") return [];
  const content = (raw as { content?: unknown }).content;
  if (!Array.isArray(content)) return [];

  return content.flatMap((block) => {
    if (
      block !== null &&
      typeof block === "object" &&
      (block as { type?: unknown }).type === "text" &&
      typeof (block as { text?: unknown }).text === "string"
    ) {
      return [(block as { text: string }).text];
    }
    return [];
  });
}

function networkTest(
  name: string,
  fn: () => void | Promise<void>,
  requiresApiKey = false,
): void {
  const skip = !runIntegration
    ? "Set EXA_RUN_INTEGRATION=1 to enable network tests"
    : requiresApiKey && !apiKey
      ? "Set EXA_API_KEY to enable REST API tests"
      : false;
  test(name, { skip }, fn);
}

networkTest("lists the tools exposed by the real MCP server", () => {
  const raw = jsonOutput(runCli(["tools", "--no-key", "--json"]));
  assert.ok(Array.isArray(raw));

  const names = raw.map((tool: { name?: unknown }) => tool.name);
  assert.ok(names.includes("web_search_exa"));
  assert.ok(names.includes("web_fetch_exa"));
  assert.ok(names.includes("web_search_advanced_exa"));
});

networkTest("searches through the real MCP server", () => {
  const raw = jsonOutput(
    runCli(["search", "Exa AI web search", "--no-key", "--num-results", "1", "--json"]),
  );

  assert.notEqual(raw.isError, true);
  assert.ok(contentTexts(raw).some((text) => text.length > 0));
});

networkTest("fetches a known page through the real MCP server", () => {
  const raw = jsonOutput(
    runCli([
      "fetch",
      "https://example.com",
      "--no-key",
      "--max-characters",
      "500",
      "--json",
    ]),
  );

  assert.notEqual(raw.isError, true);
  assert.match(contentTexts(raw).join("\n"), /Example Domain/);
});

networkTest("passes advanced search filters through the real MCP server", () => {
  const raw = jsonOutput(
    runCli([
      "advanced-search",
      "TypeScript handbook",
      "--no-key",
      "--num-results",
      "1",
      "--include-domain",
      "typescriptlang.org",
      "--json",
    ]),
  );

  assert.notEqual(raw.isError, true);
  assert.ok(contentTexts(raw).some((text) => text.length > 0));
});

networkTest(
  "runs a minimal deep search through the REST API",
  () => {
    const raw = jsonOutput(
      runCli(
        ["deep-search", "What is the purpose of example.com?", "--type", "deep-lite", "-n", "1"],
        { EXA_API_KEY: apiKey },
      ),
    );

    assert.ok(raw !== null && typeof raw === "object");
    assert.ok(Array.isArray(raw.results));
    assert.ok(raw.results.length <= 1);
  },
  true,
);

networkTest(
  "lists Agent runs without creating a billable run",
  () => {
    const raw = jsonOutput(
      runCli(["agent", "list", "--limit", "1", "--json"], {
        EXA_API_KEY: apiKey,
      }),
    );

    assert.ok(Array.isArray(raw));
    assert.ok(raw.length <= 1);
  },
  true,
);

