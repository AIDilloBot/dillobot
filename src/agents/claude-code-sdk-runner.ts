/**
 * DilloBot Claude Code SDK Runner
 *
 * Provides native integration with Claude Code SDK for using
 * Claude Code subscription as the LLM provider.
 */

import type { OpenClawConfig } from "../config/config.js";
import { getValidClaudeCodeAuth, isClaudeCodeSubscriptionAvailable } from "./claude-code-sdk-auth.js";

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
export function isClaudeCodeSdkProvider(provider: string, config?: OpenClawConfig): boolean {
  const normalized = provider.trim().toLowerCase();
  return (
    normalized === "claude-code-agent" ||
    normalized === "claude-code-sdk" ||
    normalized === "claude-code" ||
    normalized === "dillobot"
  );
}

/**
 * Run agent using Claude Code SDK.
 *
 * This function provides native integration with Claude Code's subscription
 * authentication, bypassing the need for API keys.
 *
 * @param params Run parameters
 * @returns Run result
 */
export async function runClaudeCodeSdkAgent(params: ClaudeCodeSdkRunParams): Promise<ClaudeCodeSdkRunResult> {
  // Check if Claude Code SDK is available
  const available = await isClaudeCodeSubscriptionAvailable();
  if (!available) {
    return {
      ok: false,
      error: "Claude Code SDK not available. Please authenticate with Claude Code CLI.",
    };
  }

  // Get authentication
  const auth = await getValidClaudeCodeAuth();
  if (!auth) {
    return {
      ok: false,
      error: "Claude Code subscription token is missing or expired.",
    };
  }

  try {
    // TODO: Integrate with actual Claude Code Agent SDK
    // For now, this is a placeholder that shows the structure
    console.info("[DilloBot] Running with Claude Code SDK");
    console.info(`[DilloBot] Session: ${params.sessionId}`);
    console.info(`[DilloBot] Model: ${params.model ?? "claude-opus-4-5"}`);
    console.info(`[DilloBot] Token source: ${auth.source}`);

    // The actual implementation would use the Claude Code Agent SDK:
    // import { createAgent, runAgent } from "@anthropic-ai/claude-code-sdk";
    //
    // const agent = createAgent({
    //   subscriptionToken: auth.subscriptionToken,
    //   model: params.model ?? "claude-opus-4-5",
    //   systemPrompt: params.extraSystemPrompt,
    // });
    //
    // const result = await runAgent(agent, {
    //   prompt: params.prompt,
    //   workspaceDir: params.workspaceDir,
    //   onPartialReply: params.onPartialReply,
    //   abortSignal: params.abortSignal,
    // });

    // Placeholder response for now
    // In production, this would be replaced with actual SDK calls
    return {
      ok: false,
      error:
        "Claude Code SDK integration is not yet fully implemented. " +
        "Please use the Anthropic API provider as a fallback. " +
        "Token was found at: " +
        auth.source,
    };
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
      error: `Claude Code SDK error: ${errorMessage}`,
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
        id: "claude-opus-4-5",
        name: "Claude Opus 4.5 (Claude Code)",
        reasoning: false,
        input: ["text", "image"] as const,
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
        input: ["text", "image"] as const,
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
  const available = await isClaudeCodeSubscriptionAvailable();
  return !available;
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
  return "claude-opus-4-5";
}
