/**
 * DilloBot Vault Manager
 *
 * Provides a singleton vault instance and typed helpers for credential storage.
 * This is the main entry point for all credential storage operations.
 */

import type { SecureVault } from "../types.js";
import { createVault, buildVaultKey, VAULT_KEY_PREFIXES } from "./vault.js";

// Singleton vault instance
let vaultInstance: SecureVault | null = null;
let initPromise: Promise<SecureVault> | null = null;

/**
 * Get the global vault instance.
 *
 * Lazily initializes the vault on first access. Uses AES-256-GCM encrypted
 * file with machine-derived key (no password required).
 */
export async function getVault(): Promise<SecureVault> {
  if (vaultInstance) {
    return vaultInstance;
  }

  if (initPromise) {
    return initPromise;
  }

  initPromise = createVault().then((vault) => {
    vaultInstance = vault;
    return vault;
  });

  return initPromise;
}

/**
 * Reset the vault instance (for testing).
 */
export function resetVaultInstance(): void {
  vaultInstance = null;
  initPromise = null;
}

/**
 * Get the vault backend type currently in use.
 */
export async function getVaultBackend(): Promise<string> {
  const vault = await getVault();
  return vault.backend;
}

// =============================================================================
// Typed Credential Storage Helpers
// =============================================================================

export type VaultKeyPrefix = keyof typeof VAULT_KEY_PREFIXES;

/**
 * Store a credential in the vault.
 *
 * @param prefix The credential type prefix
 * @param id The credential identifier
 * @param data The data to store (will be JSON serialized)
 */
export async function storeCredential(
  prefix: VaultKeyPrefix,
  id: string,
  data: unknown,
): Promise<void> {
  const vault = await getVault();
  const key = buildVaultKey(prefix, id);
  const buffer = Buffer.from(JSON.stringify(data), "utf-8");
  await vault.store(key, buffer);
}

/**
 * Retrieve a credential from the vault.
 *
 * @param prefix The credential type prefix
 * @param id The credential identifier
 * @returns The stored data, or null if not found
 */
export async function retrieveCredential<T>(prefix: VaultKeyPrefix, id: string): Promise<T | null> {
  const vault = await getVault();
  const key = buildVaultKey(prefix, id);
  const buffer = await vault.retrieve(key);

  if (!buffer) {
    return null;
  }

  try {
    return JSON.parse(buffer.toString("utf-8")) as T;
  } catch {
    console.error(`[vault-manager] Failed to parse credential ${key}`);
    return null;
  }
}

/**
 * Delete a credential from the vault.
 *
 * @param prefix The credential type prefix
 * @param id The credential identifier
 * @returns true if deleted, false if not found
 */
export async function deleteCredential(prefix: VaultKeyPrefix, id: string): Promise<boolean> {
  const vault = await getVault();
  const key = buildVaultKey(prefix, id);
  return vault.delete(key);
}

/**
 * Check if a credential exists in the vault.
 *
 * @param prefix The credential type prefix
 * @param id The credential identifier
 */
export async function hasCredential(prefix: VaultKeyPrefix, id: string): Promise<boolean> {
  const vault = await getVault();
  const key = buildVaultKey(prefix, id);
  return vault.exists(key);
}

/**
 * List all credentials of a given type.
 *
 * @param prefix The credential type prefix to filter by
 * @returns Array of credential IDs (without prefix)
 */
export async function listCredentials(prefix: VaultKeyPrefix): Promise<string[]> {
  const vault = await getVault();
  const allKeys = await vault.list();
  const prefixStr = VAULT_KEY_PREFIXES[prefix];

  return allKeys
    .filter((key) => key.startsWith(prefixStr))
    .map((key) => key.slice(prefixStr.length));
}

/**
 * List all credentials in the vault (all types).
 */
export async function listAllCredentials(): Promise<string[]> {
  const vault = await getVault();
  return vault.list();
}

// =============================================================================
// Convenience Helpers for Specific Credential Types
// =============================================================================

/**
 * Store auth profiles (API keys, OAuth tokens).
 */
export async function storeAuthProfiles(agentId: string, profiles: unknown): Promise<void> {
  await storeCredential("authProfile", agentId, profiles);
}

/**
 * Retrieve auth profiles.
 */
export async function retrieveAuthProfiles<T>(agentId: string): Promise<T | null> {
  return retrieveCredential<T>("authProfile", agentId);
}

/**
 * Store device identity (including private key).
 */
export async function storeDeviceIdentity(deviceId: string, identity: unknown): Promise<void> {
  await storeCredential("deviceIdentity", deviceId, identity);
}

/**
 * Retrieve device identity.
 */
export async function retrieveDeviceIdentity<T>(deviceId: string): Promise<T | null> {
  return retrieveCredential<T>("deviceIdentity", deviceId);
}

/**
 * Store device auth token.
 */
export async function storeDeviceAuth(deviceId: string, auth: unknown): Promise<void> {
  await storeCredential("deviceAuth", deviceId, auth);
}

/**
 * Retrieve device auth token.
 */
export async function retrieveDeviceAuth<T>(deviceId: string): Promise<T | null> {
  return retrieveCredential<T>("deviceAuth", deviceId);
}

// =============================================================================
// DILLOBOT: Messaging Channel Credentials
// =============================================================================

/** Telegram token stored in vault */
export type VaultTelegramToken = {
  token: string;
  storedAt: number;
};

/** Discord token stored in vault */
export type VaultDiscordToken = {
  token: string;
  storedAt: number;
};

/** Slack tokens stored in vault */
export type VaultSlackTokens = {
  botToken?: string;
  appToken?: string;
  userToken?: string;
  signingSecret?: string;
  storedAt: number;
};

/** WhatsApp credentials (Baileys creds.json content) */
export type VaultWhatsAppCreds = {
  creds: unknown;
  storedAt: number;
};

/** Generic channel credentials */
export type VaultChannelCreds = {
  channel: string;
  accountId: string;
  credentials: Record<string, unknown>;
  storedAt: number;
};

/**
 * Store Telegram bot token in vault.
 */
export async function storeTelegramToken(accountId: string, token: string): Promise<void> {
  const data: VaultTelegramToken = { token, storedAt: Date.now() };
  await storeCredential("telegramToken", accountId, data);
}

/**
 * Retrieve Telegram bot token from vault.
 */
export async function retrieveTelegramToken(accountId: string): Promise<string | null> {
  const data = await retrieveCredential<VaultTelegramToken>("telegramToken", accountId);
  return data?.token ?? null;
}

/**
 * Delete Telegram bot token from vault.
 */
export async function deleteTelegramToken(accountId: string): Promise<boolean> {
  return deleteCredential("telegramToken", accountId);
}

/**
 * Store Discord bot token in vault.
 */
export async function storeDiscordToken(accountId: string, token: string): Promise<void> {
  const data: VaultDiscordToken = { token, storedAt: Date.now() };
  await storeCredential("discordToken", accountId, data);
}

/**
 * Retrieve Discord bot token from vault.
 */
export async function retrieveDiscordToken(accountId: string): Promise<string | null> {
  const data = await retrieveCredential<VaultDiscordToken>("discordToken", accountId);
  return data?.token ?? null;
}

/**
 * Delete Discord bot token from vault.
 */
export async function deleteDiscordToken(accountId: string): Promise<boolean> {
  return deleteCredential("discordToken", accountId);
}

/**
 * Store Slack tokens in vault.
 */
export async function storeSlackTokens(
  accountId: string,
  tokens: Omit<VaultSlackTokens, "storedAt">,
): Promise<void> {
  const data: VaultSlackTokens = { ...tokens, storedAt: Date.now() };
  await storeCredential("slackToken", accountId, data);
}

/**
 * Retrieve Slack tokens from vault.
 */
export async function retrieveSlackTokens(
  accountId: string,
): Promise<Omit<VaultSlackTokens, "storedAt"> | null> {
  const data = await retrieveCredential<VaultSlackTokens>("slackToken", accountId);
  if (!data) return null;
  const { storedAt: _, ...tokens } = data;
  return tokens;
}

/**
 * Delete Slack tokens from vault.
 */
export async function deleteSlackTokens(accountId: string): Promise<boolean> {
  return deleteCredential("slackToken", accountId);
}

/**
 * Store WhatsApp credentials in vault.
 */
export async function storeWhatsAppCreds(accountId: string, creds: unknown): Promise<void> {
  const data: VaultWhatsAppCreds = { creds, storedAt: Date.now() };
  await storeCredential("whatsappCreds", accountId, data);
}

/**
 * Retrieve WhatsApp credentials from vault.
 */
export async function retrieveWhatsAppCreds(accountId: string): Promise<unknown | null> {
  const data = await retrieveCredential<VaultWhatsAppCreds>("whatsappCreds", accountId);
  return data?.creds ?? null;
}

/**
 * Delete WhatsApp credentials from vault.
 */
export async function deleteWhatsAppCreds(accountId: string): Promise<boolean> {
  return deleteCredential("whatsappCreds", accountId);
}

/**
 * Store generic channel credentials in vault.
 * Use this for extension channels not covered by specific helpers.
 */
export async function storeChannelCreds(
  channel: string,
  accountId: string,
  credentials: Record<string, unknown>,
): Promise<void> {
  const data: VaultChannelCreds = { channel, accountId, credentials, storedAt: Date.now() };
  await storeCredential("channelCreds", `${channel}:${accountId}`, data);
}

/**
 * Retrieve generic channel credentials from vault.
 */
export async function retrieveChannelCreds(
  channel: string,
  accountId: string,
): Promise<Record<string, unknown> | null> {
  const data = await retrieveCredential<VaultChannelCreds>(
    "channelCreds",
    `${channel}:${accountId}`,
  );
  return data?.credentials ?? null;
}

/**
 * Delete generic channel credentials from vault.
 */
export async function deleteChannelCreds(channel: string, accountId: string): Promise<boolean> {
  return deleteCredential("channelCreds", `${channel}:${accountId}`);
}
