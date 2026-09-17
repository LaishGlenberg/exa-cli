# exa-cli

Command-line access to Exa web search, page fetching, and deep research. Typescript CLI using the modelcontextprotocol sdk, provides a more streamlined way for agents to do web search.

- **`search` / `fetch` / `advanced-search`** call the hosted Exa MCP server at
  `https://mcp.exa.ai/mcp` through the official
  [`@modelcontextprotocol/sdk`](https://github.com/modelcontextprotocol/typescript-sdk).
- **`deep-search`** calls the Exa REST API through `exa-js` (Deep Search is not
  exposed over MCP).
- **`agent ...`** drives Exa Agent runs (`exa.agent.runs`) through the REST API.

## Install

```bash
npm install -g @lglen/exa-cli
```

Local:

```bash
npm install
npm run build
npm link        # optional: exposes the `exa` binary globally
```

Try it without installing the binary via `npm run dev -- <args>` or with
`npx tsx src/cli.ts <args>`.

## Auth

The CLI loads environment variables from a `.env` file in the current working
directory at startup (via `dotenv/config`). The simplest setup is:

```bash
echo 'EXA_API_KEY="your-key"' > .env
```

A `.env` file is gitignored, so your key stays local. You can also set the key in
the environment instead:

```bash
export EXA_API_KEY="your-key"
```

Precedence is `--api-key <key>` > existing environment variable > `.env` file —
`dotenv` does not overwrite variables that are already set.

The key is sent to the MCP server as the `exaApiKey` query parameter (exactly how
`pi-exa` does it). Pass `--api-key <key>` to override, or `--no-key` to omit the
key and use the free tier.

`deep-search` **always** requires a key (REST API); the MCP-backed commands work
without one.

## Usage

```bash
# Web search
exa search "how pi extensions register tools" -n 5
exa search "recent TypeScript release" --objective "find the official changelog"

# Fetch full markdown for one or more URLs
exa fetch https://example.com https://arxiv.org/abs/2401.00001 --max-characters 5000

# Advanced search with filters (repeatable flags and comma lists both work)
exa advanced-search "vector database benchmarks" \
  --category news \
  --include-domain arxiv.org --include-domain github.com \
  --start-published-date 2025-01-01 \
  --highlights --summary

# Deep research (requires an API key)
EXA_API_KEY=... exa deep-search "state of open-source MCP servers" \
  --type deep-reasoning --additional-query "MCP server ecosystem"

# Exa Agent (requires an API key)
EXA_API_KEY=... exa agent run "Find the three largest MCP server projects" \
  --effort medium --system-prompt "Prefer primary sources"

# Stream agent events, or manage existing runs
exa agent run "Summarize the Exa changelog" --stream
exa agent list --limit 10
exa agent get <runId>
exa agent events <runId>
exa agent cancel <runId>

# Inspect the tools the MCP server advertises
exa tools
```

Every command accepts `--json` to print the raw response:

```bash
exa search "exa mcp" -n 1 --json | jq '.content[0].text'
```

## Commands

| Command           | Backend | Description                                          |
| ----------------- | ------- | ---------------------------------------------------- |
| `search`          | MCP     | `web_search_exa` — general web search                |
| `fetch`           | MCP     | `web_fetch_exa` — clean markdown for known URLs      |
| `advanced-search` | MCP     | `web_search_advanced_exa` — all Exa search filters   |
| `deep-search`     | REST    | `exa.search()` with `deep*` types (API key required) |
| `agent run`       | REST    | Create an Exa Agent run (API key required)           |
| `agent get`       | REST    | Fetch an Agent run by ID                             |
| `agent wait`      | REST    | Poll an existing run until it finishes               |
| `agent list`      | REST    | List recent Agent runs                               |
| `agent events`    | REST    | List stored events for a run                         |
| `agent cancel`    | REST    | Cancel a queued or running run                       |
| `tools`           | MCP     | List the MCP server's tool schemas                   |

### Agent options

`agent run` supports `--system-prompt`, `--effort`, `--budget` (USD, for
`auto`/`max`), `--previous-run-id`, `--input`, `--output-schema`, `--metadata`,
`--data-source` (repeatable), `--stream`, `--no-wait`, `--poll-interval`, and
`--timeout`. Passing `--json` prints the full run object, including `usage` and
`costDollars`. Without `--json`, the run's text output goes to stdout and a
one-line usage/cost summary goes to stderr.

## Global flags

| Flag                 | Description                                             |
| -------------------- | ------------------------------------------------------- |
| `--api-key <key>`    | Exa API key (defaults to `EXA_API_KEY` / `.env`)         |
| `--no-key`           | Do not send a key to the MCP server (free tier)         |
| `--mcp-url <url>`    | Override the MCP server URL (or set `EXA_MCP_URL`)      || `--json`             | Print the raw JSON response                             |

## How it maps to `pi-exa`

`src/mcp.ts` is a stripped-down version of pi-exa's `exa_mcp.ts`: it builds the
same `StreamableHTTPClientTransport` URL, sets the `tools` query parameter to only
the tool being invoked, and passes the key via `exaApiKey`. Tool arguments are
sent with `client.callTool({ name, arguments })` and the text content blocks are
joined for display.

`src/deep-search.ts` mirrors pi-exa's `deep_search_exa` tool, which uses `exa-js`
against the Exa REST API rather than MCP.

`src/agent.ts` wraps `exa.agent.runs` from `exa-js` (`run`, `get`, `wait`,
`list`, `events`, `cancel`).

> **Note:** the SDK's `exports` map omits `.js` extensions on wildcard subpaths,
> which Node's native ESM resolver cannot handle. That is why the transport is
> imported as `@modelcontextprotocol/sdk/client/streamableHttp.js`.

## Development

```bash
npm run dev -- search "..."   # run from source with tsx
npm run check                # typecheck only
npm run build                # compile to dist/
```
