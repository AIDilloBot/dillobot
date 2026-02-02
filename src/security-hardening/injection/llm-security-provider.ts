/**
 * LLM Security Provider
 *
 * Provides LLM-based security analysis using either:
 * - Claude Code CLI (when using Claude Agent SDK provider)
 * - The user's configured LLM provider (for other providers)
 *
 * This runs OUT-OF-BAND from the main agent flow - only the content
 * is analyzed, not the full context/history/tools.
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
 * Uses `claude -p` (print mode, no tools) for clean analysis.
 */
export function createClaudeCliSecurityProvider(): InjectionLLMProvider {
  return {
    async complete(prompt: string): Promise<string> {
      return new Promise((resolve, reject) => {
        const proc = spawn("claude", ["-p", prompt], {
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
 */
export function createAnthropicSecurityProvider(options: {
  apiKey: string;
  model?: string;
}): InjectionLLMProvider {
  const model = options.model || "claude-sonnet-4-20250514";

  return {
    async complete(prompt: string): Promise<string> {
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
          messages: [{ role: "user", content: prompt }],
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
 */
export function createOpenAICompatibleSecurityProvider(options: {
  baseUrl: string;
  apiKey: string;
  model: string;
}): InjectionLLMProvider {
  return {
    async complete(prompt: string): Promise<string> {
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
          messages: [{ role: "user", content: prompt }],
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
