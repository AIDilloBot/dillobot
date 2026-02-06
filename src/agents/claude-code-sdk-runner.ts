/**
 * DilloBot Claude Code SDK Runner
 *
 * Provides native integration with Claude Agent SDK for using
 * Claude Code subscription as the LLM provider.
 */

import type { OpenClawConfig } from "../config/config.js";

// Dynamic import for the Claude Agent SDK
let sdkModule: typeof import("@anthropic-ai/claude-agent-sdk") | null = null;

async function loadSdk() {
  if (!sdkModule) {
    sdkModule = await import("@anthropic-ai/claude-agent-sdk");
  }
  return sdkModule;
}

/**
 * Parameters for running Claude Code SDK agent.
 */
export interface ClaudeCodeSdkRunParams {
  sessionId: string;
  sessionKey?: string;
  sessionFile: string;
  workspaceDir: string;
  config?: OpenClawConfig;
  prompt: string;
  model?: string;
  timeoutMs: number;
  runId: string;
  extraSystemPrompt?: string;
  ownerNumbers?: string[];
  abortSignal?: AbortSignal;
  // Streaming callbacks
  onPartialReply?: (payload: { text?: string }) => Promise<void>;
  onToolResult?: (payload: { text?: string }) => void;
  onAgentEvent?: (event: unknown) => void;
}

/**
 * Result from Claude Code SDK agent run.
 */
export interface ClaudeCodeSdkRunResult {
  ok: boolean;
  reply?: string;
  error?: string;
  tokensUsed?: {
    input: number;
    output: number;
  };
  aborted?: boolean;
}

/**
 * Check if Claude Code SDK provider is selected.
 */
export function isClaudeCodeSdkProvider(provider: string, _config?: OpenClawConfig): boolean {
  const normalized = provider.trim().toLowerCase();
  return (
    normalized === "claude-code-agent" ||
    normalized === "claude-code-sdk" ||
    normalized === "claude-code" ||
    normalized === "dillobot"
  );
}

/**
 * Run agent using Claude Agent SDK.
 *
 * This function provides native integration with Claude Code's subscription
 * authentication, bypassing the need for API keys.
 *
 * @param params Run parameters
 * @returns Run result
 */
export async function runClaudeCodeSdkAgent(
  params: ClaudeCodeSdkRunParams,
): Promise<ClaudeCodeSdkRunResult> {
  try {
    const sdk = await loadSdk();

    // Create abort controller
    const abortController = new AbortController();

    // Link to the provided abort signal if present
    if (params.abortSignal) {
      params.abortSignal.addEventListener("abort", () => {
        abortController.abort();
      });
    }

    // Set up timeout
    const timeoutId = setTimeout(() => {
      abortController.abort();
    }, params.timeoutMs);

    try {
      // Build system prompt configuration
      // Use Claude Code preset with DilloBot context appended
      const systemPromptConfig = params.extraSystemPrompt
        ? {
            type: "preset" as const,
            preset: "claude_code" as const,
            append: params.extraSystemPrompt,
          }
        : undefined;

      // Run the query using Claude Agent SDK
      const queryIterator = sdk.query({
        prompt: params.prompt,
        options: {
          abortController,
          cwd: params.workspaceDir,
          model: params.model ?? "claude-opus-4-6",
          // Use default tools
          tools: { type: "preset", preset: "claude_code" },
          // Allow all tools automatically for bot usage
          permissionMode: "bypassPermissions",
          // Pass system prompt with DilloBot context
          ...(systemPromptConfig && { systemPrompt: systemPromptConfig }),
          // Disable interactive mode
          maxTurns: 10,
        },
      });

      let fullReply = "";
      let inputTokens = 0;
      let outputTokens = 0;

      // Iterate over the query messages
      for await (const message of queryIterator) {
        // Handle different message types
        if (message.type === "assistant") {
          // Assistant message with text content
          const betaMessage = message.message;
          if (betaMessage?.content) {
            for (const block of betaMessage.content) {
              if ("text" in block && typeof block.text === "string") {
                fullReply += block.text;
                // Call streaming callback
                await params.onPartialReply?.({ text: block.text });
              }
            }
          }
        } else if (message.type === "result") {
          // Final result - check if success or error
          if (message.subtype === "success") {
            // SDKResultSuccess has result and usage
            const successMsg = message as {
              result: string;
              usage: { input_tokens: number; output_tokens: number };
            };
            fullReply = successMsg.result ?? fullReply;
            if (successMsg.usage) {
              inputTokens = successMsg.usage.input_tokens ?? 0;
              outputTokens = successMsg.usage.output_tokens ?? 0;
            }
          } else {
            // SDKResultError
            const errorMsg = message as { errors?: string[] };
            const errorText = errorMsg.errors?.join("; ") ?? "Unknown error from Claude Agent SDK";
            return {
              ok: false,
              reply: fullReply,
              error: errorText,
            };
          }
        } else if (message.type === "stream_event") {
          // Streaming events - extract text delta
          const streamEvent = message as { event?: { type?: string; delta?: { text?: string } } };
          if (streamEvent.event?.type === "content_block_delta" && streamEvent.event.delta?.text) {
            await params.onPartialReply?.({ text: streamEvent.event.delta.text });
          }
        } else if (message.type === "tool_progress" || message.type === "tool_use_summary") {
          // Tool usage events
          params.onAgentEvent?.(message);
        }

        // Check for abort
        if (abortController.signal.aborted) {
          return {
            ok: false,
            aborted: true,
            reply: fullReply,
            error: "Request was aborted",
          };
        }
      }

      return {
        ok: true,
        reply: fullReply,
        tokensUsed: {
          input: inputTokens,
          output: outputTokens,
        },
      };
    } finally {
      clearTimeout(timeoutId);
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);

    // Check for abort
    if (params.abortSignal?.aborted) {
      return {
        ok: false,
        aborted: true,
        error: "Agent run was aborted",
      };
    }

    return {
      ok: false,
      error: `Claude Agent SDK error: ${errorMessage}`,
    };
  }
}

/**
 * Get Claude Code SDK provider configuration.
 *
 * This returns a synthetic provider config for the Claude Code SDK.
 */
export function getClaudeCodeSdkProviderConfig() {
  return {
    baseUrl: "claude-code-sdk://local",
    api: "claude-code-agent" as const,
    auth: "subscription" as const,
    models: [
      {
        id: "claude-opus-4-6",
        name: "Claude Opus 4.6 (Claude Code)",
        reasoning: false,
        input: ["text", "image"] as ("text" | "image")[],
        cost: {
          input: 0, // Covered by subscription
          output: 0,
          cacheRead: 0,
          cacheWrite: 0,
        },
        contextWindow: 200000,
        maxTokens: 8192,
      },
      {
        id: "claude-opus-4-5",
        name: "Claude Opus 4.5 (Claude Code)",
        reasoning: false,
        input: ["text", "image"] as ("text" | "image")[],
        cost: {
          input: 0, // Covered by subscription
          output: 0,
          cacheRead: 0,
          cacheWrite: 0,
        },
        contextWindow: 200000,
        maxTokens: 8192,
      },
      {
        id: "claude-sonnet-4-5",
        name: "Claude Sonnet 4.5 (Claude Code)",
        reasoning: false,
        input: ["text", "image"] as ("text" | "image")[],
        cost: {
          input: 0,
          output: 0,
          cacheRead: 0,
          cacheWrite: 0,
        },
        contextWindow: 200000,
        maxTokens: 8192,
      },
    ],
  };
}

/**
 * Check if we should fall back to Anthropic API.
 *
 * This is called when Claude Code SDK is not available or fails.
 */
export async function shouldFallbackToAnthropicApi(): Promise<boolean> {
  try {
    await loadSdk();
    return false; // SDK is available, no fallback needed
  } catch {
    return true; // SDK not available, fall back to API
  }
}

/**
 * Get fallback provider ID when Claude Code SDK is unavailable.
 */
export function getClaudeCodeFallbackProvider(): string {
  return "anthropic";
}

/**
 * Get fallback model ID when Claude Code SDK is unavailable.
 */
export function getClaudeCodeFallbackModel(): string {
  return "claude-opus-4-6";
}
