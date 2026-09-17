import { Exa } from "exa-js";
import type {
  AgentEvent,
  AgentRun,
  CreateAgentRunParams,
  ListAgentRunEventsResponse,
  ListAgentRunsResponse,
} from "exa-js";

/** Options for creating an Agent run, mirroring exa-js' CreateAgentRunParams. */
export interface AgentRunOptions {
  query: string;
  systemPrompt?: string;
  input?: Record<string, unknown>;
  outputSchema?: Record<string, unknown>;
  effort?: string;
  /** Maximum spend in USD (only accepted for `auto` / `max` effort). */
  budget?: number;
  previousRunId?: string;
  metadata?: Record<string, unknown>;
  /** Exa Connect data provider ids to enable. */
  dataSources?: string[];
}

export interface AgentWaitOptions {
  pollInterval?: number;
  timeoutMs?: number;
}

function getClient(apiKey: string): Exa {
  return new Exa(apiKey);
}

function buildParams(options: AgentRunOptions): CreateAgentRunParams {
  return {
    query: options.query,
    systemPrompt: options.systemPrompt,
    input: options.input,
    outputSchema: options.outputSchema,
    effort: options.effort as CreateAgentRunParams["effort"],
    budget:
      options.budget !== undefined
        ? { maxCostDollars: options.budget }
        : undefined,
    previousRunId: options.previousRunId,
    metadata: options.metadata,
    dataSources: options.dataSources?.map((provider) => ({ provider })),
  };
}

export async function createAgentRun(
  apiKey: string,
  options: AgentRunOptions,
): Promise<AgentRun> {
  return getClient(apiKey).agent.runs.create(buildParams(options));
}

export async function runAgent(
  apiKey: string,
  options: AgentRunOptions,
  waitOptions?: AgentWaitOptions,
): Promise<AgentRun> {
  return getClient(apiKey).agent.runs.createAndWait(
    buildParams(options),
    waitOptions,
  );
}

export async function streamAgentRun(
  apiKey: string,
  options: AgentRunOptions,
): Promise<AsyncGenerator<AgentEvent>> {
  return getClient(apiKey).agent.runs.create({
    ...buildParams(options),
    stream: true,
  });
}

export async function getAgentRun(
  apiKey: string,
  runId: string,
): Promise<AgentRun> {
  return getClient(apiKey).agent.runs.get(runId);
}

export async function waitForAgentRun(
  apiKey: string,
  runId: string,
  waitOptions?: AgentWaitOptions,
): Promise<AgentRun> {
  return getClient(apiKey).agent.runs.pollUntilFinished(runId, waitOptions);
}

export async function cancelAgentRun(
  apiKey: string,
  runId: string,
): Promise<AgentRun> {
  return getClient(apiKey).agent.runs.cancel(runId);
}

export async function listAgentRuns(
  apiKey: string,
  options: { limit?: number; cursor?: string; all?: boolean },
): Promise<AgentRun[]> {
  const runs = getClient(apiKey).agent.runs;

  if (options.all) {
    return runs.getAll({ limit: options.limit, cursor: options.cursor });
  }

  const response: ListAgentRunsResponse = await runs.list({
    limit: options.limit,
    cursor: options.cursor,
  });
  return response.data;
}

export async function getAgentRunEvents(
  apiKey: string,
  runId: string,
  options: { limit?: number; cursor?: string },
): Promise<ListAgentRunEventsResponse> {
  return getClient(apiKey).agent.runs.events.list(runId, options);
}
