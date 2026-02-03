import type { OpenClawConfig } from "../config/config.js";
import type { SlackAccountConfig } from "../config/types.js";
import { normalizeChatType } from "../channels/chat-type.js";
import { DEFAULT_ACCOUNT_ID, normalizeAccountId } from "../routing/session-key.js";
import {
  resolveSlackAppToken,
  resolveSlackBotToken,
  retrieveSlackTokensFromVault,
  saveSlackTokensToVault,
} from "./token.js";

export type SlackTokenSource = "env" | "config" | "vault" | "none";

export type ResolvedSlackAccount = {
  accountId: string;
  enabled: boolean;
  name?: string;
  botToken?: string;
  appToken?: string;
  botTokenSource: SlackTokenSource;
  appTokenSource: SlackTokenSource;
  config: SlackAccountConfig;
  groupPolicy?: SlackAccountConfig["groupPolicy"];
  textChunkLimit?: SlackAccountConfig["textChunkLimit"];
  mediaMaxMb?: SlackAccountConfig["mediaMaxMb"];
  reactionNotifications?: SlackAccountConfig["reactionNotifications"];
  reactionAllowlist?: SlackAccountConfig["reactionAllowlist"];
  replyToMode?: SlackAccountConfig["replyToMode"];
  replyToModeByChatType?: SlackAccountConfig["replyToModeByChatType"];
  actions?: SlackAccountConfig["actions"];
  slashCommand?: SlackAccountConfig["slashCommand"];
  dm?: SlackAccountConfig["dm"];
  channels?: SlackAccountConfig["channels"];
};

function listConfiguredAccountIds(cfg: OpenClawConfig): string[] {
  const accounts = cfg.channels?.slack?.accounts;
  if (!accounts || typeof accounts !== "object") {
    return [];
  }
  return Object.keys(accounts).filter(Boolean);
}

export function listSlackAccountIds(cfg: OpenClawConfig): string[] {
  const ids = listConfiguredAccountIds(cfg);
  if (ids.length === 0) {
    return [DEFAULT_ACCOUNT_ID];
  }
  return ids.toSorted((a, b) => a.localeCompare(b));
}

export function resolveDefaultSlackAccountId(cfg: OpenClawConfig): string {
  const ids = listSlackAccountIds(cfg);
  if (ids.includes(DEFAULT_ACCOUNT_ID)) {
    return DEFAULT_ACCOUNT_ID;
  }
  return ids[0] ?? DEFAULT_ACCOUNT_ID;
}

function resolveAccountConfig(
  cfg: OpenClawConfig,
  accountId: string,
): SlackAccountConfig | undefined {
  const accounts = cfg.channels?.slack?.accounts;
  if (!accounts || typeof accounts !== "object") {
    return undefined;
  }
  return accounts[accountId] as SlackAccountConfig | undefined;
}

function mergeSlackAccountConfig(cfg: OpenClawConfig, accountId: string): SlackAccountConfig {
  const { accounts: _ignored, ...base } = (cfg.channels?.slack ?? {}) as SlackAccountConfig & {
    accounts?: unknown;
  };
  const account = resolveAccountConfig(cfg, accountId) ?? {};
  return { ...base, ...account };
}

export function resolveSlackAccount(params: {
  cfg: OpenClawConfig;
  accountId?: string | null;
}): ResolvedSlackAccount {
  const accountId = normalizeAccountId(params.accountId);
  const baseEnabled = params.cfg.channels?.slack?.enabled !== false;
  const merged = mergeSlackAccountConfig(params.cfg, accountId);
  const accountEnabled = merged.enabled !== false;
  const enabled = baseEnabled && accountEnabled;
  const allowEnv = accountId === DEFAULT_ACCOUNT_ID;
  const envBot = allowEnv ? resolveSlackBotToken(process.env.SLACK_BOT_TOKEN) : undefined;
  const envApp = allowEnv ? resolveSlackAppToken(process.env.SLACK_APP_TOKEN) : undefined;
  const configBot = resolveSlackBotToken(merged.botToken);
  const configApp = resolveSlackAppToken(merged.appToken);
  const botToken = configBot ?? envBot;
  const appToken = configApp ?? envApp;
  const botTokenSource: SlackTokenSource = configBot ? "config" : envBot ? "env" : "none";
  const appTokenSource: SlackTokenSource = configApp ? "config" : envApp ? "env" : "none";

  return {
    accountId,
    enabled,
    name: merged.name?.trim() || undefined,
    botToken,
    appToken,
    botTokenSource,
    appTokenSource,
    config: merged,
    groupPolicy: merged.groupPolicy,
    textChunkLimit: merged.textChunkLimit,
    mediaMaxMb: merged.mediaMaxMb,
    reactionNotifications: merged.reactionNotifications,
    reactionAllowlist: merged.reactionAllowlist,
    replyToMode: merged.replyToMode,
    replyToModeByChatType: merged.replyToModeByChatType,
    actions: merged.actions,
    slashCommand: merged.slashCommand,
    dm: merged.dm,
    channels: merged.channels,
  };
}

export function listEnabledSlackAccounts(cfg: OpenClawConfig): ResolvedSlackAccount[] {
  return listSlackAccountIds(cfg)
    .map((accountId) => resolveSlackAccount({ cfg, accountId }))
    .filter((account) => account.enabled);
}

export function resolveSlackReplyToMode(
  account: ResolvedSlackAccount,
  chatType?: string | null,
): "off" | "first" | "all" {
  const normalized = normalizeChatType(chatType ?? undefined);
  if (normalized && account.replyToModeByChatType?.[normalized] !== undefined) {
    return account.replyToModeByChatType[normalized] ?? "off";
  }
  if (normalized === "direct" && account.dm?.replyToMode !== undefined) {
    return account.dm.replyToMode;
  }
  return account.replyToMode ?? "off";
}

// =============================================================================
// DILLOBOT: Async Vault-Aware Account Resolution
// =============================================================================

/**
 * DILLOBOT: Async version that checks vault first.
 * Priority: vault → config → env
 */
export async function resolveSlackAccountAsync(params: {
  cfg: OpenClawConfig;
  accountId?: string | null;
}): Promise<ResolvedSlackAccount> {
  const accountId = normalizeAccountId(params.accountId);

  // DILLOBOT: Check vault first
  let vaultBot: string | undefined;
  let vaultApp: string | undefined;
  try {
    const vaultTokens = await retrieveSlackTokensFromVault(accountId);
    if (vaultTokens) {
      vaultBot = vaultTokens.botToken;
      vaultApp = vaultTokens.appToken;
    }
  } catch {
    // Vault not available, continue with other sources
  }

  // Get sync resolution for other config
  const syncResult = resolveSlackAccount(params);

  // If vault has tokens, use them (vault takes priority)
  if (vaultBot || vaultApp) {
    const botTokenSource: SlackTokenSource = vaultBot ? "vault" : syncResult.botTokenSource;
    const appTokenSource: SlackTokenSource = vaultApp ? "vault" : syncResult.appTokenSource;
    return {
      ...syncResult,
      botToken: vaultBot ?? syncResult.botToken,
      appToken: vaultApp ?? syncResult.appToken,
      botTokenSource,
      appTokenSource,
    };
  }

  // If we found tokens from other sources, store in vault for next time
  if (syncResult.botToken || syncResult.appToken) {
    saveSlackTokensToVault(accountId, {
      botToken: syncResult.botToken,
      appToken: syncResult.appToken,
    }).catch(() => {
      // Best-effort vault storage
    });
  }

  return syncResult;
}

/**
 * DILLOBOT: Async version of listEnabledSlackAccounts that checks vault.
 */
export async function listEnabledSlackAccountsAsync(
  cfg: OpenClawConfig,
): Promise<ResolvedSlackAccount[]> {
  const accountIds = listSlackAccountIds(cfg);
  const accounts = await Promise.all(
    accountIds.map((accountId) => resolveSlackAccountAsync({ cfg, accountId })),
  );
  return accounts.filter((account) => account.enabled);
}
