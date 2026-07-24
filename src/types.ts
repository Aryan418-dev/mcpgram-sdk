/**
 * Shared types for the MCPGRAM SDK. These mirror the JSON shapes returned
 * by GET /api/v1/tools and POST /api/v1/execute — see mcpgram-dashboard's
 * app/api/v1/tools/route.ts and app/api/v1/execute/route.ts for the
 * server-side source of truth.
 */

export interface ToolDefinition {
  toolId: string;
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

export interface ExecuteResult {
  status: "success" | "error" | null;
  output: unknown;
  error: string | null;
}

/**
 * The result of `client.use(name)` — a bundle of tools belonging to one or
 * more matching connectors/MCP servers, plus a convenience `call()` that
 * resolves a tool by name or ID within this bundle.
 */
export interface Toolset {
  /** The name that was passed to use(). */
  query: string;
  /** Every tool found across all matching servers. */
  tools: ToolDefinition[];
  /** Call a tool in this toolset by its name or tool_id. */
  call(toolNameOrId: string, input?: Record<string, unknown>): Promise<ExecuteResult>;
  /** Scope this toolset down to just what Claude needs — see adapters/claude.ts. */
  forClaude(): import("./adapters/claude").ClaudeGateway;
  /** Scope this toolset down to just what OpenAI Agents/Chat Completions needs — see adapters/openai.ts. */
  forOpenAI(): import("./adapters/openai").OpenAIGateway;
}

export interface PlatformOptions {
  /** An API key created from a workspace's API Keys page in the MCPGRAM dashboard. */
  apiKey: string;
  /**
   * The base URL of your MCPGRAM deployment, e.g. "https://yourapp.vercel.app".
   * Required for now — there's no default until MCPGRAM has a fixed public
   * production domain. This will get a default value in a future release.
   */
  baseUrl: string;
}
