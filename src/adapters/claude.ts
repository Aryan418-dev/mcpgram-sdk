import { ExecuteResult, ToolDefinition } from "../types";
import { formatTool } from "../formats";
import type { ClaudeToolSpec } from "../formats";

/**
 * Claude adapter (Phase 3, step 3).
 *
 * Handles the two things a Claude integration actually needs beyond raw
 * schema translation (step 2):
 *   1. tools ready to drop into `messages.create({ tools })`
 *   2. the round-trip — given the tool_use blocks Claude's response comes
 *      back with, execute each and shape the tool_result blocks to send
 *      back as the next message's content.
 */

export interface ClaudeToolUseBlock {
  type: "tool_use";
  id: string;
  name: string;
  input: Record<string, unknown>;
}

export interface ClaudeToolResultBlock {
  type: "tool_result";
  tool_use_id: string;
  content: string;
  is_error?: boolean;
}

export interface ClaudeGateway {
  /** Ready to pass directly as the `tools` param of messages.create(). */
  tools: ClaudeToolSpec[];
  /**
   * Executes every tool_use block from a Claude response and returns the
   * tool_result blocks for the next message. Blocks run concurrently;
   * an unknown tool name or an execution failure produces an
   * is_error: true result for that block instead of throwing, so one bad
   * call doesn't take down the others.
   */
  run(toolUseBlocks: ClaudeToolUseBlock[]): Promise<ClaudeToolResultBlock[]>;
  /** Convenience: pulls tool_use blocks out of a full message.content array. */
  extractToolUse(content: Array<{ type: string; [key: string]: unknown }>): ClaudeToolUseBlock[];
}

function stringifyOutput(value: unknown): string {
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

/**
 * Builds a Claude-ready gateway from a flat tool list plus a call
 * function. Internal building block used by Platform.forClaude() and
 * Toolset.forClaude(); exported directly in case you've sourced a tool
 * list some other way.
 */
export function buildClaudeGateway(
  tools: ToolDefinition[],
  callFn: (toolId: string, input: Record<string, unknown>) => Promise<ExecuteResult>
): ClaudeGateway {
  const byName = new Map(tools.map((t) => [t.name, t]));

  return {
    tools: tools.map((t) => formatTool(t, "claude")),

    extractToolUse: (content) => content.filter((b): b is ClaudeToolUseBlock => b.type === "tool_use"),

    run: (toolUseBlocks) =>
      Promise.all(
        toolUseBlocks.map(async (block): Promise<ClaudeToolResultBlock> => {
          const tool = byName.get(block.name);
          if (!tool) {
            return {
              type: "tool_result",
              tool_use_id: block.id,
              content: `Unknown tool: "${block.name}". This gateway only knows about: ${[...byName.keys()].join(", ") || "(none)"}`,
              is_error: true,
            };
          }
          try {
            const result = await callFn(tool.toolId, block.input ?? {});
            return {
              type: "tool_result",
              tool_use_id: block.id,
              content: stringifyOutput(result.status === "success" ? result.output : result.error),
              is_error: result.status !== "success",
            };
          } catch (err: any) {
            return {
              type: "tool_result",
              tool_use_id: block.id,
              content: err?.message ?? "Tool execution failed",
              is_error: true,
            };
          }
        })
      ),
  };
}
