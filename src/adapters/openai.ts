import { ToolDefinition, ExecuteResult } from "../types";
import { formatTools, OpenAIToolSpec } from "../formats";
import { PlatformApiError } from "../errors";

/**
 * OpenAI Agents / function-calling adapter (Phase 3, step 4).
 *
 * Mirrors adapters/claude.ts, adapted to OpenAI's shapes:
 *  - tool calls arrive as `message.tool_calls`, with `function.arguments`
 *    as a JSON *string* (not a parsed object like Claude's tool_use.input)
 *  - results are sent back as role:"tool" messages, not content blocks
 *  - the Chat Completions "tool" message has no is_error flag, so failures
 *    are conveyed as plain text content, same as a successful string result
 *
 *   const openai = await client.forOpenAI("github");
 *   const completion = await openaiClient.chat.completions.create({
 *     model: "gpt-4o",
 *     tools: openai.tools,
 *     messages,
 *   });
 *   const toolMessages = await openai.run(completion.choices[0].message);
 *   messages.push(completion.choices[0].message, ...toolMessages);
 */

export interface OpenAIToolCall {
  id: string;
  type: "function";
  function: {
    name: string;
    /** JSON-encoded arguments, exactly as OpenAI sends them. */
    arguments: string;
  };
}

export interface OpenAIToolResultMessage {
  role: "tool";
  tool_call_id: string;
  content: string;
}

export interface OpenAIGateway {
  /** Tool specs ready to pass directly as `tools` in a chat completion call. */
  tools: OpenAIToolSpec[];
  /**
   * Executes every tool call found in the input and returns the matching
   * role:"tool" messages, in the same order they were found.
   *
   * Accepts either an array of tool calls directly, or a full assistant
   * message object (anything with a `.tool_calls` array).
   */
  run(
    input: OpenAIToolCall[] | { tool_calls?: OpenAIToolCall[] | null }
  ): Promise<OpenAIToolResultMessage[]>;
  /** Execute a single tool call and get back one role:"tool" message. */
  runOne(call: OpenAIToolCall): Promise<OpenAIToolResultMessage>;
}

function stringifyOutput(output: unknown): string {
  if (typeof output === "string") return output;
  if (output === undefined) return "";
  try {
    return JSON.stringify(output, null, 2);
  } catch {
    return String(output);
  }
}

export function buildOpenAIGateway(
  flatTools: ToolDefinition[],
  callFn: (toolId: string, input: Record<string, unknown>) => Promise<ExecuteResult>
): OpenAIGateway {
  const tools = formatTools(flatTools, "openai");
  const byName = new Map(flatTools.map((t) => [t.name, t] as const));

  async function runOne(call: OpenAIToolCall): Promise<OpenAIToolResultMessage> {
    const tool = byName.get(call.function.name);

    if (!tool) {
      return {
        role: "tool",
        tool_call_id: call.id,
        content: `Unknown tool "${call.function.name}". It isn't available in this workspace — check client.use() was scoped correctly, or that the tool wasn't renamed/removed.`,
      };
    }

    let input: Record<string, unknown>;
    try {
      // OpenAI sends arguments as a JSON string; empty string means no args.
      input = call.function.arguments ? JSON.parse(call.function.arguments) : {};
    } catch {
      return {
        role: "tool",
        tool_call_id: call.id,
        content: `Could not parse arguments for "${call.function.name}": not valid JSON.`,
      };
    }

    try {
      const result = await callFn(tool.toolId, input);

      if (result.status === "error") {
        return {
          role: "tool",
          tool_call_id: call.id,
          content: result.error ?? "Tool execution failed with no error message.",
        };
      }

      return {
        role: "tool",
        tool_call_id: call.id,
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
        role: "tool",
        tool_call_id: call.id,
        content: message,
      };
    }
  }

  async function run(
    input: OpenAIToolCall[] | { tool_calls?: OpenAIToolCall[] | null }
  ): Promise<OpenAIToolResultMessage[]> {
    const calls = Array.isArray(input) ? input : input.tool_calls ?? [];
    return Promise.all(calls.map(runOne));
  }

  return { tools, run, runOne };
}
