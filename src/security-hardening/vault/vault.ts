/**
 * DilloBot Secure Vault
 *
 * Provides AES-256-GCM encrypted credential storage.
 * Uses a machine-derived key for passwordless encryption.
 */

import type { SecureVault } from "../types.js";

/**
 * Create a secure vault.
 *
 * Uses AES-256-GCM encryption with a machine-derived key.
 * No password required - credentials are tied to this machine.
 *
 * @param options Optional configuration
 * @returns A SecureVault instance
 */
export async function createVault(options?: {
  vaultPath?: string;
  password?: string;
}): Promise<SecureVault> {
  const { AesFallbackVault } = await import("./aes-fallback.js");
  return new AesFallbackVault(options?.vaultPath, options?.password);
}

/**
 * Vault key prefixes for different credential types.
 */
export const VAULT_KEY_PREFIXES = {
  /** Device authentication tokens */
  deviceAuth: "device-auth:",
  /** Device identity (private keys) */
  deviceIdentity: "device-identity:",
  /** Auth profiles (API keys, OAuth tokens) */
  authProfile: "auth-profile:",
  /** Channel pairing codes */
  pairing: "pairing:",
  /** Gateway tokens */
  gateway: "gateway:",
  /** GitHub Copilot token cache */
  copilotToken: "copilot-token:",
  /** OpenAI API key (was stored in .env) */
  openaiKey: "openai-key:",
  /** WhatsApp credentials (Baileys creds.json) */
  whatsappCreds: "whatsapp-creds:",
  /** Telegram bot tokens */
  telegramToken: "telegram-token:",
  /** Discord bot tokens */
  discordToken: "discord-token:",
  /** Slack bot/app tokens */
  slackToken: "slack-token:",
  /** Generic channel credentials (for extensions) */
  channelCreds: "channel-creds:",
} as const;

/**
 * Build a vault key from prefix and identifier.
 */
export function buildVaultKey(prefix: keyof typeof VAULT_KEY_PREFIXES, id: string): string {
  return `${VAULT_KEY_PREFIXES[prefix]}${id}`;
}

/**
 * Parse a vault key into prefix and identifier.
 */
export function parseVaultKey(key: string): { prefix: string; id: string } | null {
  for (const [name, prefix] of Object.entries(VAULT_KEY_PREFIXES)) {
    if (key.startsWith(prefix)) {
      return {
        prefix: name,
        id: key.slice(prefix.length),
      };
    }
  }
  return null;
}
