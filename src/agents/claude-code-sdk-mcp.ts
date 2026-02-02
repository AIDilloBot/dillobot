/**
 * MCP Server adapter for exposing OpenClaw tools to the Claude Code SDK.
 *
 * This creates an in-process MCP server that makes OpenClaw's custom tools
 * (cron, message, sessions, etc.) available alongside Claude Code's built-in tools.
 */

import { z } from "zod";
import type { AnyAgentTool } from "./tools/common.js";

// Type for SDK MCP tool definition
type SdkMcpToolDefinition = {
  name: string;
  description: string;
  inputSchema: z.ZodType<Record<string, unknown>>;
  handler: (
    args: Record<string, unknown>,
    extra: unknown,
  ) => Promise<{
    content: Array<{ type: "text"; text: string }>;
    isError?: boolean;
  }>;
};

// Type for the MCP server config returned by createSdkMcpServer
export type McpSdkServerConfigWithInstance = {
  type: "sdk";
  name: string;
  instance: unknown;
};

// Type for createSdkMcpServer options
type CreateSdkMcpServerOptions = {
  name: string;
  version?: string;
  tools?: SdkMcpToolDefinition[];
};

// Type for the createSdkMcpServer function
type CreateSdkMcpServerFn = (options: CreateSdkMcpServerOptions) => McpSdkServerConfigWithInstance;

// Dynamic import for the SDK's createSdkMcpServer
let createSdkMcpServerFn: CreateSdkMcpServerFn | undefined = undefined;

async function loadCreateSdkMcpServer(): Promise<CreateSdkMcpServerFn | undefined> {
  if (!createSdkMcpServerFn) {
    const sdk = await import("@anthropic-ai/claude-agent-sdk");
    if (sdk.createSdkMcpServer) {
      createSdkMcpServerFn = sdk.createSdkMcpServer as CreateSdkMcpServerFn;
    }
  }
  return createSdkMcpServerFn;
}

/**
 * Convert a TypeBox/JSON Schema to a Zod schema.
 *
 * This is a simplified converter that handles the common cases in OpenClaw tools.
 * For complex schemas, it falls back to accepting any object.
 */
function jsonSchemaToZod(schema: Record<string, unknown>): z.ZodType<Record<string, unknown>> {
  if (!schema || typeof schema !== "object") {
    return z.record(z.string(), z.unknown());
  }

  const properties = (schema.properties as Record<string, Record<string, unknown>>) || {};
  const required = (schema.required as string[]) || [];

  const zodShape: Record<string, z.ZodTypeAny> = {};

  for (const [key, propSchema] of Object.entries(properties)) {
    let zodType: z.ZodTypeAny;

    const type = propSchema.type as string | undefined;
    const enumValues = propSchema.enum as string[] | undefined;

    if (enumValues && Array.isArray(enumValues) && enumValues.length > 0) {
      // Enum type
      zodType = z.enum(enumValues as [string, ...string[]]);
    } else if (type === "string") {
      zodType = z.string();
    } else if (type === "number" || type === "integer") {
      zodType = z.number();
    } else if (type === "boolean") {
      zodType = z.boolean();
    } else if (type === "array") {
      zodType = z.array(z.unknown());
    } else if (type === "object") {
      zodType = z.record(z.string(), z.unknown());
    } else {
      zodType = z.unknown();
    }

    // Make optional if not required
    if (!required.includes(key)) {
      zodType = zodType.optional();
    }

    zodShape[key] = zodType;
  }

  // Return a permissive object schema that allows additional properties
  return z.object(zodShape).passthrough();
}

/**
 * Convert an OpenClaw tool to an SDK MCP tool definition.
 */
function convertToSdkMcpTool(tool: AnyAgentTool): SdkMcpToolDefinition {
  // Convert TypeBox schema to Zod
  const inputSchema = jsonSchemaToZod(tool.parameters as Record<string, unknown>);

  return {
    name: tool.name,
    description: tool.description || `OpenClaw tool: ${tool.name}`,
    inputSchema,
    handler: async (args: Record<string, unknown>) => {
      try {
        // Call the OpenClaw tool's execute function
        // The signature is (toolCallId, args) or (toolCallId, args, signal, onUpdate)
        const toolCallId = `sdk-mcp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        const result = await tool.execute(toolCallId, args, undefined as never, undefined as never);

        // Format result for MCP
        let resultText: string;
        if (typeof result === "string") {
          resultText = result;
        } else if (result && typeof result === "object") {
          if ("text" in result && typeof result.text === "string") {
            resultText = result.text;
          } else if ("content" in result) {
            // Handle structured content
            const content = result.content;
            if (Array.isArray(content)) {
              resultText = content
                .filter((c): c is { type: "text"; text: string } => c.type === "text")
                .map((c) => c.text)
                .join("\n");
            } else if (typeof content === "string") {
              resultText = content;
            } else {
              resultText = JSON.stringify(content, null, 2);
            }
          } else {
            resultText = JSON.stringify(result, null, 2);
          }
        } else {
          resultText = String(result);
        }

        return {
          content: [{ type: "text" as const, text: resultText }],
          isError: false,
        };
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        return {
          content: [{ type: "text" as const, text: `Error: ${errorMessage}` }],
          isError: true,
        };
      }
    },
  };
}

/**
 * Create an SDK MCP server that exposes OpenClaw tools.
 *
 * @param tools - Array of OpenClaw tools to expose
 * @returns MCP server config to pass to SDK query options
 */
export async function createOpenClawMcpServer(
  tools: AnyAgentTool[],
): Promise<McpSdkServerConfigWithInstance | null> {
  try {
    const createServer = await loadCreateSdkMcpServer();
    if (!createServer) {
      return null;
    }

    // Convert OpenClaw tools to SDK MCP tools
    const sdkTools = tools.map(convertToSdkMcpTool);

    // Create the MCP server
    return createServer({
      name: "openclaw-tools",
      version: "1.0.0",
      tools: sdkTools,
    });
  } catch (error) {
    console.warn("Failed to create OpenClaw MCP server:", error);
    return null;
  }
}

/**
 * Get the names of OpenClaw tools (for logging/debugging).
 */
export function getOpenClawToolNames(tools: AnyAgentTool[]): string[] {
  return tools.map((t) => t.name);
}
