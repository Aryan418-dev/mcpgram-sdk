import { ExecuteResult, PlatformOptions, ToolDefinition, Toolset } from "./types";
import { PlatformApiError } from "./errors";

interface ToolsApiServer {
  server_id: string;
  name: string;
  status: string;
  tools: Array<{
    tool_id: string;
    name: string;
    description: string;
    input_schema: Record<string, unknown>;
  }>;
}

/**
 * The MCPGRAM client. Wraps the workspace's API key and the two public
 * endpoints every native connector and external MCP server is exposed
 * through uniformly:
 *
 *   GET  /api/v1/tools?server=<name>   — discover tools (client.use)
 *   POST /api/v1/execute                — run a tool (client.call)
 *
 * Usage:
 *   const client = new Platform({ apiKey: "mcpg_live_...", baseUrl: "https://..." });
 *   const github = await client.use("github");
 *   const result = await github.call("github_list_repos", { per_page: 10 });
 */
export class Platform {
  private readonly apiKey: string;
  private readonly baseUrl: string;

  constructor(options: PlatformOptions) {
    if (!options?.apiKey) {
      throw new Error(
        "Platform requires an apiKey. Create one from your workspace's API Keys page in the MCPGRAM dashboard."
      );
    }
    if (!options?.baseUrl) {
      throw new Error(
        "Platform requires a baseUrl (e.g. the URL of your MCPGRAM deployment). There's no default yet."
      );
    }
    this.apiKey = options.apiKey;
    this.baseUrl = options.baseUrl.replace(/\/$/, "");
  }

  private async request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const res = await fetch(`${this.baseUrl}${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        "Content-Type": "application/json",
        ...(init.headers ?? {}),
      },
    });

    const json = await res.json().catch(() => null);

    // 502 is a deliberate "tool ran but failed" response shape from
    // /api/v1/execute, not a transport-level failure — let it through so
    // call() can return it as a normal ExecuteResult instead of throwing.
    if (!res.ok && res.status !== 502) {
      const retryAfterHeader = res.headers.get("retry-after");
      throw new PlatformApiError(
        json?.error ?? `Request to ${path} failed with status ${res.status}`,
        res.status,
        json,
        retryAfterHeader ? Number(retryAfterHeader) * 1000 : undefined
      );
    }

    return json as T;
  }

  /**
   * Resolve tools for a connector or MCP server by name (case-insensitive
   * substring match against the server's display name — e.g. "github"
   * matches the native connector "GitHub (native)", or any external MCP
   * server you've named yourself).
   *
   * Throws if nothing matches. If multiple servers match, their tools are
   * merged into one Toolset (call() still routes each tool to its own
   * server under the hood).
   */
  async use(name: string): Promise<Toolset> {
    const json = await this.request<{ servers: ToolsApiServer[] }>(
      `/api/v1/tools?server=${encodeURIComponent(name)}`
    );

    const servers = json.servers ?? [];
    if (servers.length === 0) {
      throw new Error(
        `No connected server or connector matches "${name}". Check the name against your workspace's dashboard.`
      );
    }

    const flatTools = servers.flatMap((server) =>
      server.tools.map((t) => ({
        toolId: t.tool_id,
        name: t.name,
        description: t.description,
        inputSchema: t.input_schema,
      }))
    );

    return {
      query: name,
      tools: flatTools,
      call: (toolNameOrId: string, input: Record<string, unknown> = {}) => {
        const match = flatTools.find((t) => t.toolId === toolNameOrId || t.name === toolNameOrId);
        if (!match) {
          const available = flatTools.map((t) => t.name).join(", ") || "(none)";
          throw new Error(`Tool "${toolNameOrId}" not found in "${name}". Available tools: ${available}`);
        }
        return this.call(match.toolId, input);
      },
    };
  }

  /** Directly execute a known tool_id (bypasses use() when you already have the ID). */
  async call(toolId: string, input: Record<string, unknown> = {}): Promise<ExecuteResult> {
    return this.request<ExecuteResult>("/api/v1/execute", {
      method: "POST",
      body: JSON.stringify({ tool_id: toolId, input }),
    });
  }
}

export type { ToolDefinition, ExecuteResult, Toolset, PlatformOptions };
export { PlatformApiError };
