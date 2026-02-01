/**
 * DilloBot Claude Code SDK Authentication
 *
 * Handles authentication with Claude Code SDK using the subscription
 * token from ~/.claude/ directory.
 */

import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";

/**
 * Claude Code SDK authentication result.
 */
export interface ClaudeCodeAuthResult {
  subscriptionToken: string;
  expires?: number;
  email?: string;
  source: "file" | "env";
}

/**
 * Possible locations for Claude Code credentials.
 */
const CLAUDE_CREDENTIAL_PATHS = [
  path.join(os.homedir(), ".claude", "credentials.json"),
  path.join(os.homedir(), ".claude", "auth.json"),
  path.join(os.homedir(), ".config", "claude", "credentials.json"),
];

/**
 * Environment variables that may contain Claude Code credentials.
 */
const CLAUDE_ENV_VARS = [
  "CLAUDE_CODE_SUBSCRIPTION_TOKEN",
  "CLAUDE_CODE_TOKEN",
  "CLAUDE_SUBSCRIPTION_TOKEN",
];

/**
 * Check if Claude Code subscription is available and authenticated.
 */
export async function isClaudeCodeSubscriptionAvailable(): Promise<boolean> {
  const auth = await getClaudeCodeAuth();
  return auth !== null;
}

/**
 * Get Claude Code subscription authentication.
 * Returns null if not available.
 */
export async function getClaudeCodeAuth(): Promise<ClaudeCodeAuthResult | null> {
  // First check environment variables
  for (const envVar of CLAUDE_ENV_VARS) {
    const token = process.env[envVar];
    if (token && token.trim()) {
      return {
        subscriptionToken: token.trim(),
        source: "env",
      };
    }
  }

  // Then check file-based credentials
  for (const credPath of CLAUDE_CREDENTIAL_PATHS) {
    try {
      const content = await fs.readFile(credPath, "utf-8");
      const creds = JSON.parse(content);

      // Look for subscription token in various formats
      const token =
        creds.subscriptionToken ??
        creds.subscription_token ??
        creds.token ??
        creds.accessToken ??
        creds.access_token;

      if (token && typeof token === "string" && token.trim()) {
        return {
          subscriptionToken: token.trim(),
          expires: creds.expires ?? creds.expiresAt ?? creds.expires_at,
          email: creds.email ?? creds.user?.email,
          source: "file",
        };
      }
    } catch {
      // File doesn't exist or isn't valid JSON, continue checking
    }
  }

  return null;
}

/**
 * Check if a subscription token is expired.
 */
export function isTokenExpired(auth: ClaudeCodeAuthResult): boolean {
  if (!auth.expires) {
    return false; // No expiry set, assume valid
  }

  const now = Date.now();
  const expiresMs = auth.expires > 1e12 ? auth.expires : auth.expires * 1000; // Handle seconds vs milliseconds

  // Add 5 minute buffer
  return now > expiresMs - 5 * 60 * 1000;
}

/**
 * Get a valid (non-expired) Claude Code auth, or null.
 */
export async function getValidClaudeCodeAuth(): Promise<ClaudeCodeAuthResult | null> {
  const auth = await getClaudeCodeAuth();

  if (!auth) {
    return null;
  }

  if (isTokenExpired(auth)) {
    console.warn("[DilloBot] Claude Code subscription token is expired");
    return null;
  }

  return auth;
}

/**
 * Refresh Claude Code subscription token if expired.
 *
 * Note: Full OAuth refresh would require Claude Code SDK integration.
 * This is a placeholder that returns null if expired.
 */
export async function refreshClaudeCodeAuth(): Promise<ClaudeCodeAuthResult | null> {
  // TODO: Implement OAuth refresh flow with Claude Code SDK
  console.warn("[DilloBot] Claude Code token refresh not yet implemented");
  return getValidClaudeCodeAuth();
}

/**
 * Get authentication info for display (redacted).
 */
export async function getClaudeCodeAuthInfo(): Promise<{
  available: boolean;
  source?: "file" | "env";
  email?: string;
  expired?: boolean;
  tokenPrefix?: string;
}> {
  const auth = await getClaudeCodeAuth();

  if (!auth) {
    return { available: false };
  }

  return {
    available: true,
    source: auth.source,
    email: auth.email,
    expired: isTokenExpired(auth),
    tokenPrefix: auth.subscriptionToken.slice(0, 8) + "...",
  };
}
