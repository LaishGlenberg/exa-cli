# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- Opt-in integration tests for the live MCP tools and REST search/Agent list
  paths. They keep requests small and are run with `npm run test:integration`.

## [0.1.0] - 2026-09-16

Initial release.

### Added

- `search`, `fetch`, and `advanced-search` commands backed by the hosted Exa
  MCP server (`https://mcp.exa.ai/mcp`) through `@modelcontextprotocol/sdk`.
- `deep-search`, which calls the Exa REST API via `exa-js` (Deep Search is not
  exposed over MCP).
- `agent run`, `agent get`, `agent wait`, `agent list`, `agent events`, and
  `agent cancel` for Exa Agent runs.
- `tools`, which lists the tool schemas the MCP server advertises.
- `--json` on every command to print the raw response.
- API key inputs: `--api-key`, the `EXA_API_KEY` environment variable, a `.env`
  file in the working directory, and a saved key. Resolution order is flag,
  then environment, then saved key.
- API key management through `exa auth` (saves a key, prompting with hidden
  input when no key is given), `exa auth status`, and `exa auth logout`. The key
  is stored at `$XDG_CONFIG_HOME/exa-cli/config.json`, falling back to
  `~/.config/exa-cli/config.json`, with `0600` permissions.
- `EXA_CONFIG_DIR` to relocate the config file, and `EXA_MCP_URL` / `--mcp-url`
  to override the MCP server URL.

[Unreleased]: https://github.com/LaishGlenberg/exa-cli/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/LaishGlenberg/exa-cli/releases/tag/v0.1.0
