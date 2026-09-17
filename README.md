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

The fastest way to get started is to save your key once:

```bash
# Interactive: prompts for the key with hidden input
exa auth

# Non-interactive: pass the key directly
exa auth exa-abc123...
```

This writes the key to your user config directory — `$XDG_CONFIG_HOME/exa-cli/config.json`,
falling back to `~/.config/exa-cli/config.json` — with `0600` permissions.
Set `EXA_CONFIG_DIR` to override the location.

Inspect or remove the saved key at any time:

```bash
exa auth status   # shows the active key (masked) and where it comes from
exa auth logout   # removes the saved key
```

The key can also come from the environment, which is ideal for CI:

```bash
export EXA_API_KEY="your-key"
```

…or from a `.env` file in the current working directory (loaded at startup via
`dotenv`; the file is gitignored).

Precedence, highest first:

1. `--api-key <key>` flag
2. `EXA_API_KEY` environment variable (including values loaded from `.env`)
3. the key saved by `exa auth`

The key is sent to the MCP server as the `exaApiKey` query parameter. Pass
`--no-key` to omit it and use the free tier. `deep-search` and every `agent ...`
command **always** require a key (they use the REST API); the MCP-backed
`search` / `fetch` / `advanced-search` commands work without one.

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
exa deep-search "state of open-source MCP servers" \
  --type deep-reasoning --additional-query "MCP server ecosystem"

# Exa Agent (requires an API key)
exa agent run "Find the three largest MCP server projects" \
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
| `auth [api-key]`  | —       | Save the API key (prompts with hidden input if omitted) |
| `auth status`     | —       | Show the active key (masked) and its source          |
| `auth logout`     | —       | Remove the saved API key                             |

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
| `--api-key <key>`    | Exa API key (defaults to `EXA_API_KEY` / `exa auth`)     |
| `--no-key`           | Do not send a key to the MCP server (free tier)         |
| `--mcp-url <url>`    | Override the MCP server URL (or set `EXA_MCP_URL`)      |
| `--json`             | Print the raw JSON response                             |

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

The package is published as `@lglen/exa-cli`. `prepublishOnly` compiles `src/`
to `dist/` before packing, and `files: ["dist"]` ensures only the compiled
output ships. Verify the tarball before publishing:

```bash
npm pack --dry-run                 # inspect what will be published
npm publish                        # access is set to public via publishConfig
```

To test a real global install without publishing:

```bash
npm pack
npm install -g ./lglen-exa-cli-<version>.tgz
exa --version
```
