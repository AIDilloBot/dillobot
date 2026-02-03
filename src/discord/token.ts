import type { OpenClawConfig } from "../config/config.js";
import { DEFAULT_ACCOUNT_ID, normalizeAccountId } from "../routing/session-key.js";
import {
  retrieveDiscordToken,
  storeDiscordToken,
} from "../security-hardening/vault/vault-manager.js";

export type DiscordTokenSource = "env" | "config" | "vault" | "none";

export type DiscordTokenResolution = {
  token: string;
  source: DiscordTokenSource;
};

export function normalizeDiscordToken(raw?: string | null): string | undefined {
  if (!raw) {
    return undefined;
  }
  const trimmed = raw.trim();
  if (!trimmed) {
    return undefined;
  }
  return trimmed.replace(/^Bot\s+/i, "");
}

export function resolveDiscordToken(
  cfg?: OpenClawConfig,
  opts: { accountId?: string | null; envToken?: string | null } = {},
): DiscordTokenResolution {
  const accountId = normalizeAccountId(opts.accountId);
  const discordCfg = cfg?.channels?.discord;
  const accountCfg =
    accountId !== DEFAULT_ACCOUNT_ID
      ? discordCfg?.accounts?.[accountId]
      : discordCfg?.accounts?.[DEFAULT_ACCOUNT_ID];
  const accountToken = normalizeDiscordToken(accountCfg?.token ?? undefined);
  if (accountToken) {
    return { token: accountToken, source: "config" };
  }

  const allowEnv = accountId === DEFAULT_ACCOUNT_ID;
  const configToken = allowEnv ? normalizeDiscordToken(discordCfg?.token ?? undefined) : undefined;
  if (configToken) {
    return { token: configToken, source: "config" };
  }

  const envToken = allowEnv
    ? normalizeDiscordToken(opts.envToken ?? process.env.DISCORD_BOT_TOKEN)
    : undefined;
  if (envToken) {
    return { token: envToken, source: "env" };
  }

  return { token: "", source: "none" };
}

/**
 * DILLOBOT: Async version that checks vault first.
 * Priority: vault → config → env
 */
export async function resolveDiscordTokenAsync(
  cfg?: OpenClawConfig,
  opts: { accountId?: string | null; envToken?: string | null } = {},
): Promise<DiscordTokenResolution> {
  const accountId = normalizeAccountId(opts.accountId);

  // DILLOBOT: Check vault first
  try {
    const vaultToken = await retrieveDiscordToken(accountId);
    if (vaultToken) {
      return { token: vaultToken, source: "vault" };
    }
  } catch {
    // Vault not available, continue with other sources
  }

  // Fall back to sync resolution (config, env)
  const result = resolveDiscordToken(cfg, opts);

  // DILLOBOT: If we found a token from other sources, store in vault for next time
  if (result.token && result.source !== "none") {
    storeDiscordToken(accountId, result.token).catch(() => {
      // Best-effort vault storage
    });
  }

  return result;
}

/**
 * DILLOBOT: Store a Discord token in the vault.
 * Call this when setting up a new bot token via CLI/dashboard.
 */
export async function saveDiscordTokenToVault(accountId: string, token: string): Promise<void> {
  const normalizedId = normalizeAccountId(accountId);
  const normalizedToken = normalizeDiscordToken(token) ?? token;
  await storeDiscordToken(normalizedId, normalizedToken);
}
