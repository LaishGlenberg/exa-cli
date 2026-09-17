#!/usr/bin/env node
import "dotenv/config";
import { createInterface } from "node:readline";
import { Command, Option } from "commander";
import type { AgentEvent, AgentRun } from "exa-js";
import {
  clearApiKey,
  configPath,
  describeApiKeySource,
  maskApiKey,
  resolveApiKey as resolveStoredApiKey,
  saveApiKey,
} from "./auth.js";
import {
  cancelAgentRun,
  createAgentRun,
  getAgentRun,
  getAgentRunEvents,
  listAgentRuns,
  runAgent,
  streamAgentRun,
  waitForAgentRun,
  type AgentRunOptions,
  type AgentWaitOptions,
} from "./agent.js";
import { deepSearch } from "./deep-search.js";
import {
  callMcpTool,
  connectMcp,
  MCP_TOOLS,
  type McpConnectionOptions,
  type McpToolResult,
} from "./mcp.js";
import { VERSION } from "./version.js";

type JsonOpt = { json?: boolean };

interface CommonOptions extends JsonOpt {
  apiKey?: string;
  key?: boolean;
  mcpUrl?: string;
}

const program = new Command();

program
  .name("exa")
  .description(
    "Web search, page fetching, and deep research via the Exa MCP server and API.",
  )
  .version(VERSION);

/** Options shared by every command. */
function commonOptions(cmd: Command): Command {
  return cmd
    .option("--api-key <key>", "Exa API key (defaults to EXA_API_KEY)")
    .option(
      "--no-key",
      "Do not send an API key to the MCP server (use the free tier)",
    )
    .option("--mcp-url <url>", "Override the Exa MCP server URL")
    .option("--json", "Print the raw JSON response");
}

function resolveConnection(opts: CommonOptions): McpConnectionOptions {
  return {
    apiKey: resolveStoredApiKey(opts.apiKey).apiKey,
    includeApiKey: opts.key !== false,
    url: opts.mcpUrl,
  };
}

function resolveApiKey(opts: CommonOptions, command: string): string {
  const { apiKey } = resolveStoredApiKey(opts.apiKey);
  if (!apiKey) {
    throw new Error(
      `\`${command}\` requires an Exa API key. Run \`exa auth\` to save one, set EXA_API_KEY, or pass --api-key.`,
    );
  }
  return apiKey;
}

/** Drop undefined / null / empty-array entries before sending them to Exa. */
function compact(
  values: Record<string, unknown>,
): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(values).filter(([, value]) => {
      if (value === undefined || value === null) return false;
      if (Array.isArray(value) && value.length === 0) return false;
      return true;
    }),
  );
}

/** Repeatable + comma-separated string list parser. */
function collect(value: string, previous: string[] = []): string[] {
  return previous.concat(
    value
      .split(",")
      .map((part) => part.trim())
      .filter(Boolean),
  );
}

function listOption(flags: string, description: string): Option {
  return new Option(flags, description).argParser(collect);
}

function parseNumber(value: string): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    throw new Error(`Expected a number but got "${value}"`);
  }
  return parsed;
}

function onError(err: unknown): void {
  const message = err instanceof Error ? err.message : String(err);
  console.error(`Error: ${message}`);
  process.exitCode = 1;
}

function printToolResult(result: McpToolResult, json?: boolean): void {
  if (json) {
    console.log(JSON.stringify(result.raw, null, 2));
    return;
  }

  if (result.isError) {
    console.error(result.text || "Tool call failed");
    process.exitCode = 1;
    return;
  }

  console.log(result.text || "No results");
}

function parseJson(value: string): Record<string, unknown> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch (err) {
    throw new Error(
      `Invalid JSON: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Expected a JSON object");
  }
  return parsed as Record<string, unknown>;
}

function formatAgentUsage(run: AgentRun): string | undefined {
  const usage = run.usage;
  const cost = run.costDollars;
  const parts: string[] = [];

  if (usage?.searches !== undefined) parts.push(`${usage.searches} searches`);
  if (usage?.agentComputeUnits !== undefined) {
    parts.push(`${usage.agentComputeUnits} ACU`);
  }
  if (usage?.emails) parts.push(`${usage.emails} emails`);
  if (usage?.phoneNumbers) parts.push(`${usage.phoneNumbers} phone numbers`);
  if (usage?.dataSources) {
    for (const [provider, count] of Object.entries(usage.dataSources)) {
      parts.push(`${count} ${provider}`);
    }
  }
  if (cost?.total !== undefined) parts.push(`$${cost.total}`);

  return parts.length > 0 ? parts.join(", ") : undefined;
}

function printAgentRun(run: AgentRun, json?: boolean): void {
  if (json) {
    console.log(JSON.stringify(run, null, 2));
    return;
  }

  if (run.status === "failed" && run.error) {
    console.error(
      `Agent run failed: ${run.error.message ?? JSON.stringify(run.error)}`,
    );
    process.exitCode = 1;
  }

  if (run.output?.text) console.log(run.output.text);
  if (run.output?.structured) {
    console.log(JSON.stringify(run.output.structured, null, 2));
  }
  if (!run.output?.text && !run.output?.structured && !run.error) {
    console.log(`${run.status} (${run.id})`);
  }

  const usage = formatAgentUsage(run);
  if (usage) console.error(`usage: ${usage}`);
}

function printAgentEvent(event: AgentEvent, json?: boolean): void {
  if (json) {
    console.log(JSON.stringify(event));
    return;
  }

  const data = event.data as Record<string, unknown>;
  const text = [data.text, data.delta, data.content].find(
    (value): value is string => typeof value === "string",
  );

  if (text !== undefined) {
    process.stdout.write(text);
    return;
  }

  console.log(`[${event.event}] ${JSON.stringify(data)}`);
}

// ---------------------------------------------------------------------------
// search
// ---------------------------------------------------------------------------

interface SearchOptions extends CommonOptions {
  objective?: string;
  numResults?: number;
}

commonOptions(
  program
    .command("search")
    .description(
      "Search the web for a topic and return clean result content.",
    )
    .argument("<query>", "Natural-language search query")
    .option(
      "--objective <text>",
      "Goal for this search turn (defaults to the query)",
    )
    .option("-n, --num-results <n>", "Number of results (default 10)", parseNumber),
).action(async (query: string, opts: SearchOptions) => {
  try {
    const result = await callMcpTool(
      "web_search_exa",
      compact({
        query,
        objective: opts.objective ?? query,
        numResults: opts.numResults,
      }),
      resolveConnection(opts),
    );
    printToolResult(result, opts.json);
  } catch (err) {
    onError(err);
  }
});

// ---------------------------------------------------------------------------
// fetch
// ---------------------------------------------------------------------------

interface FetchOptions extends CommonOptions {
  maxCharacters?: number;
}

commonOptions(
  program
    .command("fetch")
    .description("Fetch full clean markdown content from one or more URLs.")
    .argument("<urls...>", "URLs to read")
    .option(
      "--max-characters <n>",
      "Maximum characters to extract per page (default 3000)",
      parseNumber,
    ),
).action(async (urls: string[], opts: FetchOptions) => {
  try {
    const result = await callMcpTool(
      "web_fetch_exa",
      compact({ urls, maxCharacters: opts.maxCharacters }),
      resolveConnection(opts),
    );
    printToolResult(result, opts.json);
  } catch (err) {
    onError(err);
  }
});

// ---------------------------------------------------------------------------
// advanced-search
// ---------------------------------------------------------------------------

interface AdvancedSearchOptions extends CommonOptions {
  numResults?: number;
  type?: string;
  category?: string;
  includeDomain?: string[];
  excludeDomain?: string[];
  startPublishedDate?: string;
  endPublishedDate?: string;
  startCrawlDate?: string;
  endCrawlDate?: string;
  includeText?: string[];
  excludeText?: string[];
  userLocation?: string;
  moderation?: boolean;
  additionalQuery?: string[];
  textMaxCharacters?: number;
  contextMaxCharacters?: number;
  summary?: boolean;
  summaryQuery?: string;
  highlights?: boolean;
  highlightsMaxCharacters?: number;
  highlightsQuery?: string;
  maxAgeHours?: number;
  livecrawlTimeout?: number;
  subpages?: number;
  subpageTarget?: string[];
}

commonOptions(
  program
    .command("advanced-search")
    .description("Web search with full control over filters and content options.")
    .argument("<query>", "Search query")
    .option("-n, --num-results <n>", "Number of results (1-100)", parseNumber)
    .addOption(
      new Option("--type <type>", "Search type").choices([
        "auto",
        "fast",
        "instant",
      ]),
    )
    .addOption(
      new Option("--category <category>", "Filter results to a category").choices(
        [
          "company",
          "publication",
          "news",
          "pdf",
          "github",
          "personal site",
          "people",
          "financial report",
        ],
      ),
    )
    .addOption(listOption("--include-domain <domain>", "Only include this domain (repeatable)"))
    .addOption(listOption("--exclude-domain <domain>", "Exclude this domain (repeatable)"))
    .option("--start-published-date <date>", "Published after (YYYY-MM-DD)")
    .option("--end-published-date <date>", "Published before (YYYY-MM-DD)")
    .option("--start-crawl-date <date>", "Crawled after (YYYY-MM-DD)")
    .option("--end-crawl-date <date>", "Crawled before (YYYY-MM-DD)")
    .addOption(listOption("--include-text <text>", "Require this text in results (repeatable)"))
    .addOption(listOption("--exclude-text <text>", "Exclude this text from results (repeatable)"))
    .option("--user-location <code>", "ISO country code for geo-targeting")
    .option("--moderation", "Filter out unsafe content")
    .addOption(listOption("--additional-query <query>", "Extra query variation (repeatable)"))
    .option("--text-max-characters <n>", "Max characters per result", parseNumber)
    .option("--context-max-characters <n>", "Max characters of context", parseNumber)
    .option("--summary", "Enable summary generation")
    .option("--summary-query <query>", "Focus query for summaries")
    .option("--highlights", "Enable highlights extraction")
    .option("--highlights-max-characters <n>", "Max total highlight characters", parseNumber)
    .option("--highlights-query <query>", "Query for highlight relevance")
    .option("--max-age-hours <n>", "Max age of cached content in hours", parseNumber)
    .option("--livecrawl-timeout <n>", "Live fetch timeout in ms", parseNumber)
    .option("--subpages <n>", "Subpages to crawl per result", parseNumber)
    .addOption(listOption("--subpage-target <target>", "Subpage selection keyword (repeatable)"))
).action(async (query: string, opts: AdvancedSearchOptions) => {
  try {
    const result = await callMcpTool(
      "web_search_advanced_exa",
      compact({
        query,
        numResults: opts.numResults,
        type: opts.type,
        category: opts.category,
        includeDomains: opts.includeDomain,
        excludeDomains: opts.excludeDomain,
        startPublishedDate: opts.startPublishedDate,
        endPublishedDate: opts.endPublishedDate,
        startCrawlDate: opts.startCrawlDate,
        endCrawlDate: opts.endCrawlDate,
        includeText: opts.includeText,
        excludeText: opts.excludeText,
        userLocation: opts.userLocation,
        moderation: opts.moderation,
        additionalQueries: opts.additionalQuery,
        textMaxCharacters: opts.textMaxCharacters,
        contextMaxCharacters: opts.contextMaxCharacters,
        enableSummary: opts.summary,
        summaryQuery: opts.summaryQuery,
        enableHighlights: opts.highlights,
        highlightsMaxCharacters: opts.highlightsMaxCharacters,
        highlightsQuery: opts.highlightsQuery,
        maxAgeHours: opts.maxAgeHours,
        livecrawlTimeout: opts.livecrawlTimeout,
        subpages: opts.subpages,
        subpageTarget: opts.subpageTarget,
      }),
      resolveConnection(opts),
    );
    printToolResult(result, opts.json);
  } catch (err) {
    onError(err);
  }
});

// ---------------------------------------------------------------------------
// deep-search
// ---------------------------------------------------------------------------

interface DeepSearchCliOptions extends CommonOptions {
  numResults?: number;
  type?: string;
  category?: string;
  additionalQuery?: string[];
}

commonOptions(
  program
    .command("deep-search")
    .description(
      "Deep research via the Exa API (requires an Exa API key).",
    )
    .argument("<query>", "Natural-language research question")
    .option("-n, --num-results <n>", "Number of results (default 10)", parseNumber)
    .addOption(
      new Option("--type <type>", "Deep search effort").choices([
        "deep-lite",
        "deep",
        "deep-reasoning",
      ]),
    )
    .addOption(
      new Option("--category <category>", "Category filter").choices([
        "company",
        "research paper",
        "news",
        "pdf",
        "personal site",
        "financial report",
        "people",
      ]),
    )
    .addOption(
      listOption(
        "--additional-query <query>",
        "Alternative query variation (repeatable)",
      ),
    ),
).action(async (query: string, opts: DeepSearchCliOptions) => {
  try {
    const apiKey = resolveApiKey(opts, "deep-search");
    const result = await deepSearch(apiKey, {
      query,
      numResults: opts.numResults,
      type: opts.type,
      category: opts.category,
      additionalQueries: opts.additionalQuery,
    });
    console.log(JSON.stringify(result, null, 2));
  } catch (err) {
    onError(err);
  }
});

// ---------------------------------------------------------------------------
// agent
// ---------------------------------------------------------------------------

const agentCommand = program
  .command("agent")
  .description("Run and manage Exa Agent tasks (requires an Exa API key).");

interface AgentRunCliOptions extends CommonOptions {
  systemPrompt?: string;
  input?: Record<string, unknown>;
  outputSchema?: Record<string, unknown>;
  effort?: string;
  budget?: number;
  previousRunId?: string;
  metadata?: Record<string, unknown>;
  dataSource?: string[];
  stream?: boolean;
  wait?: boolean;
  pollInterval?: number;
  timeout?: number;
}

commonOptions(
  agentCommand
    .command("run")
    .description("Create an Agent run and wait for the result.")
    .argument("<query>", "Natural-language task for the agent")
    .option("--system-prompt <text>", "System prompt for the run")
    .addOption(
      new Option("--effort <effort>", "Effort level").choices([
        "minimal",
        "low",
        "medium",
        "high",
        "xhigh",
        "auto",
        "max",
      ]),
    )
    .option(
      "--budget <usd>",
      "Maximum spend in USD (auto/max effort only)",
      parseNumber,
    )
    .option("--previous-run-id <id>", "Continue from a previous run")
    .addOption(
      new Option("--input <json>", "JSON input object").argParser(parseJson),
    )
    .addOption(
      new Option(
        "--output-schema <json>",
        "JSON schema for structured output",
      ).argParser(parseJson),
    )
    .addOption(
      new Option("--metadata <json>", "JSON metadata object").argParser(
        parseJson,
      ),
    )
    .addOption(
      listOption(
        "--data-source <provider>",
        "Exa Connect provider to enable (repeatable)",
      ),
    )
    .option("--stream", "Stream events as they arrive")
    .option("--no-wait", "Create the run and return immediately")
    .option("--poll-interval <ms>", "Poll interval while waiting", parseNumber)
    .option("--timeout <ms>", "Polling timeout", parseNumber),
).action(async (query: string, opts: AgentRunCliOptions) => {
  try {
    const apiKey = resolveApiKey(opts, "agent run");
    const runOptions: AgentRunOptions = {
      query,
      systemPrompt: opts.systemPrompt,
      input: opts.input,
      outputSchema: opts.outputSchema,
      effort: opts.effort,
      budget: opts.budget,
      previousRunId: opts.previousRunId,
      metadata: opts.metadata,
      dataSources: opts.dataSource,
    };

    if (opts.stream) {
      const events = await streamAgentRun(apiKey, runOptions);
      for await (const event of events) {
        printAgentEvent(event, opts.json);
      }
      if (!opts.json) process.stdout.write("\n");
      return;
    }

    if (opts.wait === false) {
      printAgentRun(await createAgentRun(apiKey, runOptions), opts.json);
      return;
    }

    const waitOptions: AgentWaitOptions = {
      pollInterval: opts.pollInterval,
      timeoutMs: opts.timeout,
    };
    printAgentRun(await runAgent(apiKey, runOptions, waitOptions), opts.json);
  } catch (err) {
    onError(err);
  }
});

commonOptions(
  agentCommand
    .command("get")
    .description("Get an Agent run by ID.")
    .argument("<runId>", "Agent run ID"),
).action(async (runId: string, opts: CommonOptions) => {
  try {
    const apiKey = resolveApiKey(opts, "agent get");
    printAgentRun(await getAgentRun(apiKey, runId), opts.json);
  } catch (err) {
    onError(err);
  }
});

commonOptions(
  agentCommand
    .command("wait")
    .description("Wait for an existing Agent run to finish.")
    .argument("<runId>", "Agent run ID")
    .option("--poll-interval <ms>", "Poll interval while waiting", parseNumber)
    .option("--timeout <ms>", "Polling timeout", parseNumber),
).action(
  async (
    runId: string,
    opts: CommonOptions & { pollInterval?: number; timeout?: number },
  ) => {
    try {
      const apiKey = resolveApiKey(opts, "agent wait");
      printAgentRun(
        await waitForAgentRun(apiKey, runId, {
          pollInterval: opts.pollInterval,
          timeoutMs: opts.timeout,
        }),
        opts.json,
      );
    } catch (err) {
      onError(err);
    }
  },
);

commonOptions(
  agentCommand
    .command("cancel")
    .description("Cancel a queued or running Agent run.")
    .argument("<runId>", "Agent run ID"),
).action(async (runId: string, opts: CommonOptions) => {
  try {
    const apiKey = resolveApiKey(opts, "agent cancel");
    printAgentRun(await cancelAgentRun(apiKey, runId), opts.json);
  } catch (err) {
    onError(err);
  }
});

commonOptions(
  agentCommand
    .command("list")
    .description("List recent Agent runs.")
    .option("--limit <n>", "Number of runs per page", parseNumber)
    .option("--cursor <cursor>", "Pagination cursor")
    .option("--all", "Fetch every page of runs"),
).action(
  async (
    opts: CommonOptions & { limit?: number; cursor?: string; all?: boolean },
  ) => {
    try {
      const apiKey = resolveApiKey(opts, "agent list");
      const runs = await listAgentRuns(apiKey, {
        limit: opts.limit,
        cursor: opts.cursor,
        all: opts.all,
      });

      if (opts.json) {
        console.log(JSON.stringify(runs, null, 2));
        return;
      }

      for (const run of runs) {
        console.log(`${run.id}\t${run.status}\t${run.createdAt ?? ""}`);
      }
    } catch (err) {
      onError(err);
    }
  },
);

commonOptions(
  agentCommand
    .command("events")
    .description("List stored events for an Agent run.")
    .argument("<runId>", "Agent run ID")
    .option("--limit <n>", "Number of events per page", parseNumber)
    .option("--cursor <cursor>", "Pagination cursor"),
).action(
  async (
    runId: string,
    opts: CommonOptions & { limit?: number; cursor?: string },
  ) => {
    try {
      const apiKey = resolveApiKey(opts, "agent events");
      const response = await getAgentRunEvents(apiKey, runId, {
        limit: opts.limit,
        cursor: opts.cursor,
      });

      if (opts.json) {
        console.log(JSON.stringify(response, null, 2));
        return;
      }

      for (const event of response.data) {
        console.log(JSON.stringify(event));
      }
    } catch (err) {
      onError(err);
    }
  },
);

// ---------------------------------------------------------------------------
// auth
// ---------------------------------------------------------------------------

/** Reads a line from the terminal without echoing the typed characters. */
function promptHidden(question: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const isTty = Boolean(process.stdin.isTTY);
    const rl = createInterface({
      input: process.stdin,
      output: process.stderr,
      terminal: isTty,
    });

    let settled = false;
    const finish = (action: () => void) => {
      if (settled) return;
      settled = true;
      rl.close();
      action();
    };

    if (isTty) {
      const writer = rl as unknown as { _writeToOutput?: (s: string) => void };
      const original = writer._writeToOutput?.bind(rl);
      writer._writeToOutput = (string: string) => {
        // Swallow the typed characters, but let the trailing newline through.
        if (string.includes("\n") || string.includes("\r")) original?.(string);
      };
      process.stderr.write(question);
    }

    rl.question("", (answer) => {
      if (isTty) process.stderr.write("\n");
      finish(() => resolve(answer.trim()));
    });
    rl.once("SIGINT", () => finish(() => reject(new Error("Cancelled."))));
    // Without this, a closed stdin (e.g. `< /dev/null`) leaves the promise
    // pending and the process exits successfully without saving anything.
    rl.once("close", () => {
      if (!settled) reject(new Error("No API key provided."));
    });
  });
}

function storeApiKey(apiKey: string): void {
  console.log(`Saved Exa API key to ${saveApiKey(apiKey)}`);
}

const authCommand = program
  .command("auth")
  .description("Save or inspect the Exa API key used by the CLI.")
  .argument("[api-key]", "Exa API key to save (prompts if omitted)")
  .action(async (apiKey?: string) => {
    try {
      const key = apiKey?.trim() || (await promptHidden("Exa API key: "));
      if (!key) {
        onError(new Error("No API key provided."));
        return;
      }
      storeApiKey(key);
    } catch (err) {
      onError(err);
    }
  });

authCommand
  .command("status")
  .description("Show which API key the CLI will use and where it comes from.")
  .action(() => {
    const { apiKey, source } = resolveStoredApiKey();
    if (!apiKey) {
      console.log("No Exa API key configured.");
      console.log("Run `exa auth` to save one, or set EXA_API_KEY.");
      return;
    }
    console.log(`API key: ${maskApiKey(apiKey)}`);
    console.log(`Source:  ${describeApiKeySource(source)}`);
  });

authCommand
  .command("logout")
  .description("Remove the API key saved by `exa auth`.")
  .action(() => {
    if (clearApiKey()) {
      console.log(`Removed saved API key from ${configPath()}`);
    } else {
      console.log("No saved API key to remove.");
    }
  });

// ---------------------------------------------------------------------------
// tools
// ---------------------------------------------------------------------------

commonOptions(
  program
    .command("tools")
    .description("List the tools exposed by the Exa MCP server."),
).action(async (opts: CommonOptions) => {
  let session: Awaited<ReturnType<typeof connectMcp>> | undefined;
  try {
    session = await connectMcp(MCP_TOOLS, resolveConnection(opts));
    const { tools } = await session.client.listTools();

    if (opts.json) {
      console.log(JSON.stringify(tools, null, 2));
      return;
    }

    for (const tool of tools) {
      console.log(tool.name);
      if (tool.description) {
        console.log(`  ${tool.description.split("\n")[0]}`);
      }
    }
  } catch (err) {
    onError(err);
  } finally {
    await session?.close().catch(() => {});
  }
});

program.parseAsync(process.argv).catch(onError);
