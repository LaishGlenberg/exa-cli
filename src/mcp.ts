import { Client } from "@modelcontextprotocol/sdk/client";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

export const EXA_CLI_VERSION = "0.1.0";
export const DEFAULT_MCP_URL = "https://mcp.exa.ai/mcp";

/** Tool names exposed by the hosted Exa MCP server. */
export const MCP_TOOLS = [
  "web_search_exa",
  "web_search_advanced_exa",
  "web_fetch_exa",
] as const;

export interface McpConnectionOptions {
  /** Exa API key to send to the MCP server. */
  apiKey?: string;
  /** Set to false to omit the API key and use the free tier. Default: true. */
  includeApiKey?: boolean;
  /** Override the MCP server URL. Defaults to DEFAULT_MCP_URL / EXA_MCP_URL. */
  url?: string;
}

export interface McpSession {
  client: Client;
  close(): Promise<void>;
}

/**
 * Opens a Streamable HTTP connection to the Exa MCP server and performs the
 * MCP initialize handshake. The `tools` query parameter tells the server which
 * tools to expose, and the API key is passed as the `exaApiKey` query param.
 */
export async function connectMcp(
  tools: readonly string[],
  options: McpConnectionOptions = {},
): Promise<McpSession> {
  const url = new URL(
    options.url ?? process.env.EXA_MCP_URL ?? DEFAULT_MCP_URL,
  );

  if (tools.length > 0) {
    url.searchParams.set("tools", tools.join(","));
  }

  if (options.includeApiKey !== false && options.apiKey) {
    url.searchParams.set("exaApiKey", options.apiKey);
  }

  const transport = new StreamableHTTPClientTransport(url);
  const client = new Client(
    { name: "exa-cli", version: EXA_CLI_VERSION },
    { capabilities: {} },
  );

  await client.connect(transport);

  return {
    client,
    close: async () => {
      await client.close();
    },
  };
}

export interface McpToolResult {
  text: string;
  isError: boolean;
  raw: unknown;
}

/** Pull the concatenated text blocks out of an MCP tool result. */
export function extractText(content: unknown): string {
  if (!Array.isArray(content)) return "";

  return content
    .filter(
      (block): block is { type: string; text?: string } =>
        typeof block === "object" && block !== null && "type" in block,
    )
    .filter((block) => block.type === "text" && typeof block.text === "string")
    .map((block) => block.text as string)
    .join("\n");
}

/**
 * Connects, calls a single MCP tool, and disconnects. A fresh connection per
 * invocation keeps the CLI stateless.
 */
export async function callMcpTool(
  toolName: string,
  args: Record<string, unknown>,
  options: McpConnectionOptions = {},
): Promise<McpToolResult> {
  const session = await connectMcp([toolName], options);

  try {
    const result = await session.client.callTool({
      name: toolName,
      arguments: args,
    });

    return {
      text: extractText(result.content),
      isError: Boolean(result.isError),
      raw: result,
    };
  } finally {
    await session.close().catch(() => {});
  }
}
