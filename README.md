# @mcpgram/sdk

Official JS/TS SDK for **MCPGRAM** — one client for both native connectors (GitHub, Slack, Notion, Google Drive) and external MCP servers, built for AI agents to call.

This is the SDK core (Phase 3, step 1). Framework-specific adapters (Claude, OpenAI Agents, LangGraph, CrewAI, OpenClaw) are built on top of this and land in later steps.

## Install

```bash
npm install @mcpgram/sdk
```

(Not yet published to npm — this repo currently ships source only. Publishing happens once the SDK is feature-complete.)

## Usage

```ts
import { Platform } from "@mcpgram/sdk";

const client = new Platform({
  apiKey: process.env.MCPGRAM_API_KEY!, // from your workspace's API Keys page
  baseUrl: "https://your-mcpgram-deployment.example.com",
});

// Resolve tools for a connector or MCP server by name
const github = await client.use("github");

console.log(github.tools); // [{ toolId, name, description, inputSchema }, ...]

// Call a tool by name (or by tool_id directly)
const result = await github.call("github_list_repos", { per_page: 10 });

if (result.status === "success") {
  console.log(result.output);
} else {
  console.error(result.error);
}

// Or skip use() entirely if you already have a tool_id:
const result2 = await client.call("a1b2c3d4-...", { per_page: 10 });
```

## How `use(name)` matching works

`name` is matched case-insensitively as a substring against each server's display name in your workspace — e.g. `"github"` matches the native connector stored as `"GitHub (native)"`, or matches whatever name you gave an external MCP server. If more than one server matches, their tools are merged into a single `Toolset`; `call()` still routes each tool to its correct underlying server.

## Error handling

- Network/auth/discovery errors (bad API key, unknown tool name, rate limits) throw a `PlatformApiError` with `.status`, `.body`, and (for 429s) `.retryAfterMs`.
- A tool that *ran* but failed (e.g. the underlying GitHub API call errored) does **not** throw — it resolves normally as `{ status: "error", error: "...", output: null }`, since that's an outcome an agent should branch on, not an exception.

## Status

This package mirrors `mcpgram-dashboard`'s `/api/v1/tools` and `/api/v1/execute` endpoints. See that repo for the server-side source of truth on request/response shapes.
