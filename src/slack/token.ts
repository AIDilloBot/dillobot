import { normalizeAccountId } from "../routing/session-key.js";
import {
  retrieveSlackTokens,
  storeSlackTokens,
} from "../security-hardening/vault/vault-manager.js";

export function normalizeSlackToken(raw?: string): string | undefined {
  const trimmed = raw?.trim();
  return trimmed ? trimmed : undefined;
}

export function resolveSlackBotToken(raw?: string): string | undefined {
  return normalizeSlackToken(raw);
}

export function resolveSlackAppToken(raw?: string): string | undefined {
  return normalizeSlackToken(raw);
}

// =============================================================================
// DILLOBOT: Vault-based Slack Token Functions
// =============================================================================

export type SlackVaultTokens = {
  botToken?: string;
  appToken?: string;
  userToken?: string;
  signingSecret?: string;
};

/**
 * DILLOBOT: Retrieve Slack tokens from vault.
 */
export async function retrieveSlackTokensFromVault(
  accountId: string,
): Promise<SlackVaultTokens | null> {
  const normalizedId = normalizeAccountId(accountId);
  try {
    const tokens = await retrieveSlackTokens(normalizedId);
    return tokens ?? null;
  } catch {
    return null;
  }
}

/**
 * DILLOBOT: Store Slack tokens in vault.
 */
export async function saveSlackTokensToVault(
  accountId: string,
  tokens: SlackVaultTokens,
): Promise<void> {
  const normalizedId = normalizeAccountId(accountId);
  await storeSlackTokens(normalizedId, tokens);
}
