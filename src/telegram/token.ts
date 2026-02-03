import fs from "node:fs";
import type { OpenClawConfig } from "../config/config.js";
import type { TelegramAccountConfig } from "../config/types.telegram.js";
import { DEFAULT_ACCOUNT_ID, normalizeAccountId } from "../routing/session-key.js";
import {
  retrieveTelegramToken,
  storeTelegramToken,
} from "../security-hardening/vault/vault-manager.js";

export type TelegramTokenSource = "env" | "tokenFile" | "config" | "vault" | "none";

export type TelegramTokenResolution = {
  token: string;
  source: TelegramTokenSource;
};

type ResolveTelegramTokenOpts = {
  envToken?: string | null;
  accountId?: string | null;
  logMissingFile?: (message: string) => void;
};

export function resolveTelegramToken(
  cfg?: OpenClawConfig,
  opts: ResolveTelegramTokenOpts = {},
): TelegramTokenResolution {
  const accountId = normalizeAccountId(opts.accountId);
  const telegramCfg = cfg?.channels?.telegram;

  // Account IDs are normalized for routing (e.g. lowercased). Config keys may not
  // be normalized, so resolve per-account config by matching normalized IDs.
  const resolveAccountCfg = (id: string): TelegramAccountConfig | undefined => {
    const accounts = telegramCfg?.accounts;
    if (!accounts || typeof accounts !== "object" || Array.isArray(accounts)) {
      return undefined;
    }
    // Direct hit (already normalized key)
    const direct = accounts[id];
    if (direct) {
      return direct;
    }
    // Fallback: match by normalized key
    const matchKey = Object.keys(accounts).find((key) => normalizeAccountId(key) === id);
    return matchKey ? accounts[matchKey] : undefined;
  };

  const accountCfg = resolveAccountCfg(
    accountId !== DEFAULT_ACCOUNT_ID ? accountId : DEFAULT_ACCOUNT_ID,
  );
  const accountTokenFile = accountCfg?.tokenFile?.trim();
  if (accountTokenFile) {
    if (!fs.existsSync(accountTokenFile)) {
      opts.logMissingFile?.(
        `channels.telegram.accounts.${accountId}.tokenFile not found: ${accountTokenFile}`,
      );
      return { token: "", source: "none" };
    }
    try {
      const token = fs.readFileSync(accountTokenFile, "utf-8").trim();
      if (token) {
        return { token, source: "tokenFile" };
      }
    } catch (err) {
      opts.logMissingFile?.(
        `channels.telegram.accounts.${accountId}.tokenFile read failed: ${String(err)}`,
      );
      return { token: "", source: "none" };
    }
    return { token: "", source: "none" };
  }

  const accountToken = accountCfg?.botToken?.trim();
  if (accountToken) {
    return { token: accountToken, source: "config" };
  }

  const allowEnv = accountId === DEFAULT_ACCOUNT_ID;
  const tokenFile = telegramCfg?.tokenFile?.trim();
  if (tokenFile && allowEnv) {
    if (!fs.existsSync(tokenFile)) {
      opts.logMissingFile?.(`channels.telegram.tokenFile not found: ${tokenFile}`);
      return { token: "", source: "none" };
    }
    try {
      const token = fs.readFileSync(tokenFile, "utf-8").trim();
      if (token) {
        return { token, source: "tokenFile" };
      }
    } catch (err) {
      opts.logMissingFile?.(`channels.telegram.tokenFile read failed: ${String(err)}`);
      return { token: "", source: "none" };
    }
  }

  const configToken = telegramCfg?.botToken?.trim();
  if (configToken && allowEnv) {
    return { token: configToken, source: "config" };
  }

  const envToken = allowEnv ? (opts.envToken ?? process.env.TELEGRAM_BOT_TOKEN)?.trim() : "";
  if (envToken) {
    return { token: envToken, source: "env" };
  }

  return { token: "", source: "none" };
}

/**
 * DILLOBOT: Async version that checks vault first.
 * Priority: vault → tokenFile → config → env
 */
export async function resolveTelegramTokenAsync(
  cfg?: OpenClawConfig,
  opts: ResolveTelegramTokenOpts = {},
): Promise<TelegramTokenResolution> {
  const accountId = normalizeAccountId(opts.accountId);

  // DILLOBOT: Check vault first
  try {
    const vaultToken = await retrieveTelegramToken(accountId);
    if (vaultToken) {
      return { token: vaultToken, source: "vault" };
    }
  } catch {
    // Vault not available, continue with other sources
  }

  // Fall back to sync resolution (tokenFile, config, env)
  const result = resolveTelegramToken(cfg, opts);

  // DILLOBOT: If we found a token from other sources, store in vault for next time
  if (result.token && result.source !== "none") {
    storeTelegramToken(accountId, result.token).catch(() => {
      // Best-effort vault storage
    });
  }

  return result;
}

/**
 * DILLOBOT: Store a Telegram token in the vault.
 * Call this when setting up a new bot token via CLI/dashboard.
 */
export async function saveTelegramTokenToVault(accountId: string, token: string): Promise<void> {
  const normalizedId = normalizeAccountId(accountId);
  await storeTelegramToken(normalizedId, token);
}
