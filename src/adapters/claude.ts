import { ToolDefinition, ExecuteResult } from "../types";
import { formatTools, ClaudeToolSpec } from "../formats";
import { PlatformApiError } from "../errors";

/**
 * Claude adapter (Phase 3, step 3).
 *
 * Turns a flat tool list into everything needed to hand tools to Claude
 * and execute whatever it calls back:
 *
 *   const claude = await client.forClaude("github");
 *   const msg = await anthropic.messages.create({
 *     model: "claude-sonnet-5",
 *     tools: claude.tools,
 *     messages: [{ role: "user", content: "List my repos" }],
 *   });
 *   const results = await claude.run(msg); // executes any tool_use blocks
 *   // results is ready to send back as the next user message's content,
 *   // alongside msg.content if you want the assistant turn preserved too.
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
  /** Tool specs ready to pass directly as `tools` in messages.create(). */
  tools: ClaudeToolSpec[];
  /**
   * Executes every tool_use block found in the input and returns the
   * matching tool_result blocks, in the same order they were found.
   *
   * Accepts either an array of tool_use blocks directly, or a full
   * Claude response object (anything with a `.content` array) — in
   * the latter case, non-tool_use content blocks are ignored.
   */
  run(input: ClaudeToolUseBlock[] | { content: unknown[] }): Promise<ClaudeToolResultBlock[]>;
  /** Execute a single tool_use block and get back one tool_result block. */
  runOne(block: ClaudeToolUseBlock): Promise<ClaudeToolResultBlock>;
}

function isToolUseBlock(block: unknown): block is ClaudeToolUseBlock {
  return (
    typeof block === "object" &&
    block !== null &&
    (block as { type?: unknown }).type === "tool_use" &&
    typeof (block as { id?: unknown }).id === "string" &&
    typeof (block as { name?: unknown }).name === "string"
  );
}

function extractToolUseBlocks(content: unknown[]): ClaudeToolUseBlock[] {
  return content.filter(isToolUseBlock);
}

/**
 * Claude's tool_result content must be a string. Objects/arrays get
 * JSON-stringified; strings pass through untouched; everything else
 * (numbers, booleans, null) gets coerced.
 */
function stringifyOutput(output: unknown): string {
  if (typeof output === "string") return output;
  if (output === undefined) return "";
  try {
    return JSON.stringify(output, null, 2);
  } catch {
    return String(output);
  }
}

export function buildClaudeGateway(
  flatTools: ToolDefinition[],
  callFn: (toolId: string, input: Record<string, unknown>) => Promise<ExecuteResult>
): ClaudeGateway {
  const tools = formatTools(flatTools, "claude");
  const byName = new Map(flatTools.map((t) => [t.name, t] as const));

  async function runOne(block: ClaudeToolUseBlock): Promise<ClaudeToolResultBlock> {
    const tool = byName.get(block.name);

    if (!tool) {
      return {
        type: "tool_result",
        tool_use_id: block.id,
        content: `Unknown tool "${block.name}". It isn't available in this workspace — check client.use() was scoped correctly, or that the tool wasn't renamed/removed.`,
        is_error: true,
      };
    }

    try {
      const result = await callFn(tool.toolId, block.input ?? {});

      if (result.status === "error") {
        return {
          type: "tool_result",
          tool_use_id: block.id,
          content: result.error ?? "Tool execution failed with no error message.",
          is_error: true,
        };
      }

      return {
        type: "tool_result",
        tool_use_id: block.id,
        content: stringifyOutput(result.output),
      };
    } catch (err) {
      const message =
        err instanceof PlatformApiError
          ? err.message
          : err instanceof Error
            ? err.message
            : "Tool execution failed.";
      return {
        type: "tool_result",
        tool_use_id: block.id,
        content: message,
        is_error: true,
      };
    }
  }

  async function run(
    input: ClaudeToolUseBlock[] | { content: unknown[] }
  ): Promise<ClaudeToolResultBlock[]> {
    const blocks = Array.isArray(input) ? input : extractToolUseBlocks(input.content);
    return Promise.all(blocks.map(runOne));
  }

  return { tools, run, runOne };
}
