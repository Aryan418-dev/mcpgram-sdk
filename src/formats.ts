import { ToolDefinition } from "./types";

/**
 * Shared schema-translation layer (Phase 3, step 2).
 *
 * Every framework tool format is, underneath, the same three fields —
 * name, description, and a JSON Schema for the parameters — just with
 * different field names and wrapping. So there's exactly one real
 * transform here (normalizeSchema + the field mapping in formatTool);
 * everything else is a thin, format-specific shape on top of it.
 *
 * This module only converts *shapes*. It does not execute tools or
 * handle an agent's tool-call round-trip — that's the adapters built in
 * later Phase 3 steps (forClaude/forOpenAI etc. on Toolset, plus
 * language-specific packages for LangGraph/CrewAI).
 */

export type ToolFormat = "claude" | "openai" | "langchain" | "crewai";

export interface ClaudeToolSpec {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
}

export interface OpenAIToolSpec {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

/**
 * LangChain/LangGraph's plain JSON tool descriptor — the shape consumed
 * by StructuredTool-style construction (and the same shape
 * `convert_to_openai_tool` starts from on the Python side, before it gets
 * wrapped into the OpenAI shape). Kept separate from OpenAIToolSpec so a
 * future Python package can map this 1:1 without depending on OpenAI's
 * wrapper conventions.
 */
export interface LangChainToolSpec {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

/**
 * CrewAI's BaseTool-compatible descriptor. CrewAI tools are normally
 * pydantic-backed Python classes; args_schema here is the JSON-Schema
 * form a future Python adapter would use to generate that pydantic model
 * (e.g. via `pydantic.create_model` from the schema's properties).
 */
export interface CrewAIToolSpec {
  name: string;
  description: string;
  args_schema: Record<string, unknown>;
}

type FormatSpecMap = {
  claude: ClaudeToolSpec;
  openai: OpenAIToolSpec;
  langchain: LangChainToolSpec;
  crewai: CrewAIToolSpec;
};

/**
 * Defensively normalize a tool's JSON Schema before handing it to any
 * framework. Our own connector tool definitions always set these
 * correctly, but external MCP servers' schemas aren't guaranteed to —
 * and most frameworks (OpenAI/Claude included) require an object schema
 * with a `properties` key, even for zero-argument tools.
 */
function normalizeSchema(schema: Record<string, unknown> | undefined | null): Record<string, unknown> {
  const base = schema && typeof schema === "object" ? schema : {};
  return {
    type: "object",
    properties: {},
    ...base,
  };
}

/** Convert one tool definition into a single target framework's shape. */
export function formatTool<F extends ToolFormat>(tool: ToolDefinition, format: F): FormatSpecMap[F] {
  const schema = normalizeSchema(tool.inputSchema);

  switch (format) {
    case "claude":
      return {
        name: tool.name,
        description: tool.description,
        input_schema: schema,
      } as FormatSpecMap[F];

    case "openai":
      return {
        type: "function",
        function: {
          name: tool.name,
          description: tool.description,
          parameters: schema,
        },
      } as FormatSpecMap[F];

    case "langchain":
      return {
        name: tool.name,
        description: tool.description,
        parameters: schema,
      } as FormatSpecMap[F];

    case "crewai":
      return {
        name: tool.name,
        description: tool.description,
        args_schema: schema,
      } as FormatSpecMap[F];

    default: {
      const _exhaustive: never = format;
      throw new Error(`Unknown tool format: ${_exhaustive}`);
    }
  }
}

/** Convert a whole list of tool definitions (e.g. a Toolset's .tools) into a target framework's shape. */
export function formatTools<F extends ToolFormat>(tools: ToolDefinition[], format: F): FormatSpecMap[F][] {
  return tools.map((tool) => formatTool(tool, format));
}
