import { Exa, type BaseSearchOptions, type DeepSearchType } from "exa-js";

export interface DeepSearchOptions {
  query: string;
  numResults?: number;
  type?: string;
  category?: string;
  additionalQueries?: string[];
}

/**
 * Deep Search runs against the Exa REST API (not the MCP server), mirroring
 * pi-exa's deep_search_exa tool.
 */
export async function deepSearch(
  apiKey: string,
  options: DeepSearchOptions,
): Promise<unknown> {
  const exa = new Exa(apiKey);

  return exa.search(options.query, {
    outputSchema: { type: "text" },
    contents: { highlights: true },
    type: (options.type ?? "deep") as DeepSearchType,
    numResults: options.numResults ?? 10,
    category: options.category as BaseSearchOptions["category"],
    additionalQueries: options.additionalQueries,
  });
}
