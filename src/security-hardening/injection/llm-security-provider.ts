/**
 * LLM Security Provider
 *
 * Provides LLM-based security analysis using either:
 * - Claude Code CLI (when using Claude Agent SDK provider)
 * - The user's configured LLM provider (for other providers)
 *
 * This runs OUT-OF-BAND from the main agent flow - only the content
 * is analyzed, not the full context/history/tools.
 *
 * SECURITY HARDENING:
 * - Tools are explicitly disabled on all providers
 * - System role is used for analysis instructions (separate from user content)
 * - This prevents prompt injection in the content from hijacking the analysis
 */

import { spawn } from "node:child_process";
import type { InjectionLLMProvider } from "./injection-analyzer.js";

/**
 * Check if the provider is Claude Agent SDK.
 */
export function isClaudeAgentSdkProvider(provider: string): boolean {
  const normalized = provider.trim().toLowerCase();
  return (
    normalized === "claude-code-agent" ||
    normalized === "claude-code-sdk" ||
    normalized === "claude-code" ||
    normalized === "dillobot"
  );
}

/**
 * Create an LLM provider that uses Claude Code CLI for security analysis.
 * Uses `claude -p` (print mode) with `--no-tools` for secure analysis.
 *
 * SECURITY: --no-tools explicitly disables all tool execution
 */
export function createClaudeCliSecurityProvider(): InjectionLLMProvider {
  return {
    async complete(systemPrompt: string, userContent: string): Promise<string> {
      return new Promise((resolve, reject) => {
        // Combine system and user content for CLI (CLI doesn't support separate system prompt)
        // The system prompt contains hardened instructions that resist injection
        const fullPrompt = `${systemPrompt}\n\n---\n\nContent to analyze:\n${userContent}`;

        // SECURITY: Use --no-tools to explicitly disable tool execution
        // Use -p for print mode (non-interactive)
        const proc = spawn("claude", ["-p", "--no-tools", fullPrompt], {
          stdio: ["pipe", "pipe", "pipe"],
          timeout: 30000, // 30 second timeout for security analysis
        });

        let stdout = "";
        let stderr = "";

        proc.stdout?.on("data", (data) => {
          stdout += data.toString();
        });

        proc.stderr?.on("data", (data) => {
          stderr += data.toString();
        });

        proc.on("close", (code) => {
          if (code === 0) {
            resolve(stdout.trim());
          } else {
            reject(new Error(`Claude CLI exited with code ${code}: ${stderr}`));
          }
        });

        proc.on("error", (err) => {
          reject(new Error(`Failed to run Claude CLI: ${err.message}`));
        });
      });
    },
  };
}

/**
 * Options for creating a generic LLM security provider.
 */
export interface GenericLLMProviderOptions {
  /** Base URL for the API */
  baseUrl: string;
  /** API key for authentication */
  apiKey: string;
  /** Model ID to use */
  model: string;
  /** Provider type (anthropic, openai, google, etc.) */
  providerType: string;
}

/**
 * Create an LLM provider using the Anthropic API directly.
 *
 * SECURITY:
 * - Uses system role for analysis instructions (not injectable by user content)
 * - Does not pass tools array (tools disabled by default)
 */
export function createAnthropicSecurityProvider(options: {
  apiKey: string;
  model?: string;
}): InjectionLLMProvider {
  const model = options.model || "claude-sonnet-4-20250514";

  return {
    async complete(systemPrompt: string, userContent: string): Promise<string> {
      const response = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": options.apiKey,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify({
          model,
          max_tokens: 1024,
          // SECURITY: System prompt in system role - cannot be overridden by user content
          system: systemPrompt,
          // SECURITY: User content is separate - any injection attempts stay in user role
          messages: [{ role: "user", content: userContent }],
          // SECURITY: Explicitly no tools - Anthropic API has no tools by default,
          // but we don't pass the tools field at all to ensure no tool execution
        }),
      });

      if (!response.ok) {
        const error = await response.text();
        throw new Error(`Anthropic API error: ${response.status} ${error}`);
      }

      const data = (await response.json()) as {
        content: Array<{ type: string; text?: string }>;
      };
      const textBlock = data.content.find((c) => c.type === "text");
      return textBlock?.text || "";
    },
  };
}

/**
 * Create an LLM provider using OpenAI-compatible API.
 *
 * SECURITY:
 * - Uses system role for analysis instructions
 * - Explicitly sets tool_choice to "none" to disable any tool calling
 */
export function createOpenAICompatibleSecurityProvider(options: {
  baseUrl: string;
  apiKey: string;
  model: string;
}): InjectionLLMProvider {
  return {
    async complete(systemPrompt: string, userContent: string): Promise<string> {
      const url = options.baseUrl.endsWith("/")
        ? `${options.baseUrl}chat/completions`
        : `${options.baseUrl}/chat/completions`;

      const response = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${options.apiKey}`,
        },
        body: JSON.stringify({
          model: options.model,
          max_tokens: 1024,
          // SECURITY: System instructions in system role
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: userContent },
          ],
          // SECURITY: Explicitly disable tools
          // Some OpenAI-compatible APIs support tool_choice
          tool_choice: "none",
        }),
      });

      if (!response.ok) {
        const error = await response.text();
        throw new Error(`OpenAI API error: ${response.status} ${error}`);
      }

      const data = (await response.json()) as {
        choices: Array<{ message: { content: string } }>;
      };
      return data.choices[0]?.message?.content || "";
    },
  };
}

/**
 * Resolve the appropriate LLM provider for security analysis.
 *
 * @param provider The configured LLM provider name
 * @param config Configuration for API access (if not using Claude CLI)
 * @returns An InjectionLLMProvider or null if unavailable
 */
export function resolveSecurityLLMProvider(
  provider: string,
  config?: {
    anthropicApiKey?: string;
    openaiApiKey?: string;
    openaiBaseUrl?: string;
    model?: string;
  },
): InjectionLLMProvider | null {
  // Use Claude CLI for Claude Agent SDK provider
  if (isClaudeAgentSdkProvider(provider)) {
    return createClaudeCliSecurityProvider();
  }

  // Use Anthropic API if we have a key
  if (config?.anthropicApiKey) {
    return createAnthropicSecurityProvider({
      apiKey: config.anthropicApiKey,
      model: config.model,
    });
  }

  // Use OpenAI-compatible API if we have a key
  if (config?.openaiApiKey) {
    return createOpenAICompatibleSecurityProvider({
      baseUrl: config.openaiBaseUrl || "https://api.openai.com/v1",
      apiKey: config.openaiApiKey,
      model: config.model || "gpt-4o",
    });
  }

  // No provider available
  return null;
}
