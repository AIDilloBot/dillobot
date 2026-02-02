/**
 * DilloBot Claude Code SDK Authentication
 *
 * Checks if Claude Code CLI is available and authenticated.
 * Claude Code handles its own auth via OAuth/system keychain.
 */

import { execSync, spawn } from "node:child_process";

/**
 * Claude Code SDK authentication result.
 */
export interface ClaudeCodeAuthResult {
  available: boolean;
  version?: string;
  source: "cli";
}

/**
 * Check if Claude Code CLI is installed and working.
 */
function isClaudeCliInstalled(): boolean {
  try {
    execSync("claude --version", { stdio: "pipe", timeout: 5000 });
    return true;
  } catch {
    return false;
  }
}

/**
 * Get Claude Code CLI version.
 */
function getClaudeCliVersion(): string | null {
  try {
    const output = execSync("claude --version", { encoding: "utf-8", timeout: 5000 });
    return output.trim();
  } catch {
    return null;
  }
}

/**
 * Check if Claude Code subscription is available.
 * This checks if the claude CLI is installed and accessible.
 */
export async function isClaudeCodeSubscriptionAvailable(): Promise<boolean> {
  return isClaudeCliInstalled();
}

/**
 * Get Claude Code authentication info.
 * Returns info about the CLI availability.
 */
export async function getClaudeCodeAuth(): Promise<ClaudeCodeAuthResult | null> {
  if (!isClaudeCliInstalled()) {
    return null;
  }

  return {
    available: true,
    version: getClaudeCliVersion() ?? undefined,
    source: "cli",
  };
}

/**
 * Check if a subscription token is expired.
 * Not applicable for CLI-based auth - Claude handles this.
 */
export function isTokenExpired(_auth: ClaudeCodeAuthResult): boolean {
  return false; // Claude CLI handles its own auth refresh
}

/**
 * Get a valid Claude Code auth, or null.
 */
export async function getValidClaudeCodeAuth(): Promise<ClaudeCodeAuthResult | null> {
  return getClaudeCodeAuth();
}

/**
 * Refresh Claude Code subscription token if expired.
 * Not needed - Claude CLI handles its own auth.
 */
export async function refreshClaudeCodeAuth(): Promise<ClaudeCodeAuthResult | null> {
  return getValidClaudeCodeAuth();
}

/**
 * Get authentication info for display.
 */
export async function getClaudeCodeAuthInfo(): Promise<{
  available: boolean;
  source?: "cli";
  version?: string;
}> {
  const auth = await getClaudeCodeAuth();

  if (!auth) {
    return { available: false };
  }

  return {
    available: true,
    source: auth.source,
    version: auth.version,
  };
}

/**
 * Run a prompt through Claude Code CLI.
 * Returns the response text.
 */
export async function runClaudeCodeCli(
  prompt: string,
  options?: {
    systemPrompt?: string;
    maxTurns?: number;
    allowedTools?: string[];
    timeoutMs?: number;
    onOutput?: (text: string) => void;
    abortSignal?: AbortSignal;
  },
): Promise<{ ok: boolean; response?: string; error?: string }> {
  return new Promise((resolve) => {
    const args = ["--print"]; // Non-interactive mode

    if (options?.maxTurns) {
      args.push("--max-turns", String(options.maxTurns));
    }

    if (options?.allowedTools && options.allowedTools.length > 0) {
      args.push("--allowedTools", options.allowedTools.join(","));
    }

    if (options?.systemPrompt) {
      args.push("--system-prompt", options.systemPrompt);
    }

    // Add the prompt as the last argument
    args.push(prompt);

    const timeoutMs = options?.timeoutMs ?? 300000; // 5 minute default
    let stdout = "";
    let stderr = "";
    let timedOut = false;

    const claude = spawn("claude", args, {
      stdio: ["pipe", "pipe", "pipe"],
      timeout: timeoutMs,
    });

    // Handle timeout
    const timeout = setTimeout(() => {
      timedOut = true;
      claude.kill("SIGTERM");
    }, timeoutMs);

    // Handle abort signal
    if (options?.abortSignal) {
      options.abortSignal.addEventListener("abort", () => {
        claude.kill("SIGTERM");
      });
    }

    claude.stdout.on("data", (data) => {
      const text = data.toString();
      stdout += text;
      options?.onOutput?.(text);
    });

    claude.stderr.on("data", (data) => {
      stderr += data.toString();
    });

    claude.on("close", (code) => {
      clearTimeout(timeout);

      if (options?.abortSignal?.aborted) {
        resolve({ ok: false, error: "Request aborted" });
        return;
      }

      if (timedOut) {
        resolve({ ok: false, error: `Claude Code CLI timed out after ${timeoutMs}ms` });
        return;
      }

      if (code === 0) {
        resolve({ ok: true, response: stdout.trim() });
      } else {
        resolve({
          ok: false,
          error: stderr.trim() || `Claude Code CLI exited with code ${code}`,
        });
      }
    });

    claude.on("error", (err) => {
      clearTimeout(timeout);
      resolve({ ok: false, error: `Failed to spawn Claude Code CLI: ${err.message}` });
    });
  });
}
