/**
 * DilloBot Channel Credentials Vault Tests
 *
 * Tests vault storage for messaging channel credentials:
 * - Telegram bot tokens
 * - Discord bot tokens
 * - Slack bot/app tokens
 * - WhatsApp credentials
 * - Generic channel credentials
 */

import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { AesFallbackVault } from "./aes-fallback.js";
import { buildVaultKey, VAULT_KEY_PREFIXES } from "./vault.js";

describe("channel-credentials", () => {
  let testDir: string;
  let vault: AesFallbackVault;

  beforeEach(async () => {
    // Create unique test directory for each test
    testDir = path.join(
      os.tmpdir(),
      `channel-creds-test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    );
    await fs.mkdir(testDir, { recursive: true });
    const vaultPath = path.join(testDir, "vault.enc");
    vault = new AesFallbackVault(vaultPath, "test-password-123");
  });

  afterEach(async () => {
    try {
      await fs.rm(testDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  // Helper functions that mirror vault-manager API
  async function storeCredential(
    prefix: keyof typeof VAULT_KEY_PREFIXES,
    id: string,
    data: unknown,
  ): Promise<void> {
    const key = buildVaultKey(prefix, id);
    const buffer = Buffer.from(JSON.stringify(data), "utf-8");
    await vault.store(key, buffer);
  }

  async function retrieveCredential<T>(
    prefix: keyof typeof VAULT_KEY_PREFIXES,
    id: string,
  ): Promise<T | null> {
    const key = buildVaultKey(prefix, id);
    const buffer = await vault.retrieve(key);
    if (!buffer) return null;
    try {
      return JSON.parse(buffer.toString("utf-8")) as T;
    } catch {
      return null;
    }
  }

  async function deleteCredential(
    prefix: keyof typeof VAULT_KEY_PREFIXES,
    id: string,
  ): Promise<boolean> {
    const key = buildVaultKey(prefix, id);
    return vault.delete(key);
  }

  async function hasCredential(
    prefix: keyof typeof VAULT_KEY_PREFIXES,
    id: string,
  ): Promise<boolean> {
    const key = buildVaultKey(prefix, id);
    return vault.exists(key);
  }

  describe("Telegram token storage", () => {
    type VaultTelegramToken = { token: string; storedAt: number };

    it("stores and retrieves Telegram bot token", async () => {
      const accountId = "default";
      const tokenData: VaultTelegramToken = {
        token: "123456789:ABCdefGHIjklMNOpqrsTUVwxyz",
        storedAt: Date.now(),
      };

      await storeCredential("telegramToken", accountId, tokenData);
      const retrieved = await retrieveCredential<VaultTelegramToken>("telegramToken", accountId);

      expect(retrieved).not.toBeNull();
      expect(retrieved?.token).toBe(tokenData.token);
    });

    it("handles multiple Telegram accounts", async () => {
      const token1: VaultTelegramToken = { token: "bot1-token", storedAt: Date.now() };
      const token2: VaultTelegramToken = { token: "bot2-token", storedAt: Date.now() };

      await storeCredential("telegramToken", "account1", token1);
      await storeCredential("telegramToken", "account2", token2);

      const retrieved1 = await retrieveCredential<VaultTelegramToken>("telegramToken", "account1");
      const retrieved2 = await retrieveCredential<VaultTelegramToken>("telegramToken", "account2");

      expect(retrieved1?.token).toBe("bot1-token");
      expect(retrieved2?.token).toBe("bot2-token");
    });

    it("deletes Telegram token", async () => {
      const tokenData: VaultTelegramToken = { token: "to-delete", storedAt: Date.now() };
      await storeCredential("telegramToken", "delete-test", tokenData);

      expect(await hasCredential("telegramToken", "delete-test")).toBe(true);

      const deleted = await deleteCredential("telegramToken", "delete-test");
      expect(deleted).toBe(true);
      expect(await hasCredential("telegramToken", "delete-test")).toBe(false);
    });
  });

  describe("Discord token storage", () => {
    type VaultDiscordToken = { token: string; storedAt: number };

    it("stores and retrieves Discord bot token", async () => {
      const tokenData: VaultDiscordToken = {
        token: "MTIzNDU2Nzg5MDEyMzQ1Njc4.GDisco.abcdefghijklmnopqrstuvwxyz",
        storedAt: Date.now(),
      };

      await storeCredential("discordToken", "default", tokenData);
      const retrieved = await retrieveCredential<VaultDiscordToken>("discordToken", "default");

      expect(retrieved?.token).toBe(tokenData.token);
    });

    it("stores token without Bot prefix", async () => {
      // Discord tokens should be stored without "Bot " prefix
      const tokenData: VaultDiscordToken = {
        token: "raw-token-without-prefix",
        storedAt: Date.now(),
      };

      await storeCredential("discordToken", "normalized", tokenData);
      const retrieved = await retrieveCredential<VaultDiscordToken>("discordToken", "normalized");

      expect(retrieved?.token).not.toContain("Bot ");
      expect(retrieved?.token).toBe("raw-token-without-prefix");
    });
  });

  describe("Slack token storage", () => {
    type VaultSlackTokens = {
      botToken?: string;
      appToken?: string;
      userToken?: string;
      signingSecret?: string;
      storedAt: number;
    };

    it("stores and retrieves Slack bot and app tokens", async () => {
      const tokens: VaultSlackTokens = {
        botToken: "xoxb-1234567890-1234567890123-abcdefghijklmnop",
        appToken: "xapp-1-A1234567890-1234567890123-abcdefghijklmnop",
        storedAt: Date.now(),
      };

      await storeCredential("slackToken", "default", tokens);
      const retrieved = await retrieveCredential<VaultSlackTokens>("slackToken", "default");

      expect(retrieved?.botToken).toBe(tokens.botToken);
      expect(retrieved?.appToken).toBe(tokens.appToken);
    });

    it("stores all Slack credential types", async () => {
      const tokens: VaultSlackTokens = {
        botToken: "xoxb-bot-token",
        appToken: "xapp-app-token",
        userToken: "xoxp-user-token",
        signingSecret: "signing-secret-123",
        storedAt: Date.now(),
      };

      await storeCredential("slackToken", "full-account", tokens);
      const retrieved = await retrieveCredential<VaultSlackTokens>("slackToken", "full-account");

      expect(retrieved?.botToken).toBe(tokens.botToken);
      expect(retrieved?.appToken).toBe(tokens.appToken);
      expect(retrieved?.userToken).toBe(tokens.userToken);
      expect(retrieved?.signingSecret).toBe(tokens.signingSecret);
    });

    it("handles partial Slack tokens", async () => {
      // Some setups only have botToken
      const tokens: VaultSlackTokens = {
        botToken: "xoxb-only-bot",
        storedAt: Date.now(),
      };

      await storeCredential("slackToken", "bot-only", tokens);
      const retrieved = await retrieveCredential<VaultSlackTokens>("slackToken", "bot-only");

      expect(retrieved?.botToken).toBe("xoxb-only-bot");
      expect(retrieved?.appToken).toBeUndefined();
    });
  });

  describe("WhatsApp credentials storage", () => {
    type VaultWhatsAppCreds = { creds: unknown; storedAt: number };

    it("stores and retrieves WhatsApp credentials", async () => {
      // Simulated Baileys creds.json structure
      const creds = {
        me: { id: "1234567890@s.whatsapp.net", name: "Bot" },
        noiseKey: { private: "base64-private", public: "base64-public" },
        signedIdentityKey: { private: "base64-private", public: "base64-public" },
        signedPreKey: { keyPair: {}, signature: "base64-sig", keyId: 1 },
        registrationId: 12345,
      };

      const data: VaultWhatsAppCreds = { creds, storedAt: Date.now() };
      await storeCredential("whatsappCreds", "default", data);

      const retrieved = await retrieveCredential<VaultWhatsAppCreds>("whatsappCreds", "default");
      expect(retrieved?.creds).toEqual(creds);
    });

    it("handles complex WhatsApp credential structure", async () => {
      const creds = {
        me: { id: "1234567890@s.whatsapp.net" },
        account: {
          details: "binary-data",
          accountSignatureKey: "base64-key",
          accountSignature: "base64-sig",
          deviceSignature: "base64-sig",
        },
      };

      const data: VaultWhatsAppCreds = { creds, storedAt: Date.now() };
      await storeCredential("whatsappCreds", "complex", data);

      const retrieved = await retrieveCredential<VaultWhatsAppCreds>("whatsappCreds", "complex");
      expect(retrieved?.creds).toEqual(creds);
    });
  });

  describe("Generic channel credentials storage", () => {
    type VaultChannelCreds = {
      channel: string;
      accountId: string;
      credentials: Record<string, unknown>;
      storedAt: number;
    };

    it("stores and retrieves generic channel credentials", async () => {
      const creds: VaultChannelCreds = {
        channel: "matrix",
        accountId: "default",
        credentials: {
          homeserver: "https://matrix.org",
          accessToken: "matrix-access-token",
          userId: "@bot:matrix.org",
          deviceId: "ABCDEF123",
        },
        storedAt: Date.now(),
      };

      await storeCredential("channelCreds", "matrix:default", creds);
      const retrieved = await retrieveCredential<VaultChannelCreds>(
        "channelCreds",
        "matrix:default",
      );

      expect(retrieved?.channel).toBe("matrix");
      expect(retrieved?.credentials.accessToken).toBe("matrix-access-token");
    });

    it("handles MS Teams credentials", async () => {
      const creds: VaultChannelCreds = {
        channel: "msteams",
        accountId: "default",
        credentials: {
          appId: "12345678-1234-1234-1234-123456789abc",
          appPassword: "teams-app-secret",
          tenantId: "tenant-id-here",
        },
        storedAt: Date.now(),
      };

      await storeCredential("channelCreds", "msteams:default", creds);
      const retrieved = await retrieveCredential<VaultChannelCreds>(
        "channelCreds",
        "msteams:default",
      );

      expect(retrieved?.credentials.appId).toBe("12345678-1234-1234-1234-123456789abc");
      expect(retrieved?.credentials.appPassword).toBe("teams-app-secret");
    });

    it("handles Zalo credentials", async () => {
      const creds: VaultChannelCreds = {
        channel: "zalo",
        accountId: "default",
        credentials: {
          botToken: "zalo-bot-token-here",
        },
        storedAt: Date.now(),
      };

      await storeCredential("channelCreds", "zalo:default", creds);
      const retrieved = await retrieveCredential<VaultChannelCreds>("channelCreds", "zalo:default");

      expect(retrieved?.credentials.botToken).toBe("zalo-bot-token-here");
    });
  });

  describe("key prefix isolation", () => {
    it("isolates credentials by prefix", async () => {
      // Store credentials with same ID but different prefixes
      await storeCredential("telegramToken", "shared-id", { token: "telegram", storedAt: 0 });
      await storeCredential("discordToken", "shared-id", { token: "discord", storedAt: 0 });
      await storeCredential("slackToken", "shared-id", { botToken: "slack", storedAt: 0 });

      // Each should retrieve its own data
      const telegram = await retrieveCredential<{ token: string }>("telegramToken", "shared-id");
      const discord = await retrieveCredential<{ token: string }>("discordToken", "shared-id");
      const slack = await retrieveCredential<{ botToken: string }>("slackToken", "shared-id");

      expect(telegram?.token).toBe("telegram");
      expect(discord?.token).toBe("discord");
      expect(slack?.botToken).toBe("slack");
    });

    it("lists credentials by prefix", async () => {
      await storeCredential("telegramToken", "tg1", { token: "t1", storedAt: 0 });
      await storeCredential("telegramToken", "tg2", { token: "t2", storedAt: 0 });
      await storeCredential("discordToken", "dc1", { token: "d1", storedAt: 0 });

      const allKeys = await vault.list();
      const telegramKeys = allKeys.filter((k) => k.startsWith(VAULT_KEY_PREFIXES.telegramToken));
      const discordKeys = allKeys.filter((k) => k.startsWith(VAULT_KEY_PREFIXES.discordToken));

      expect(telegramKeys.length).toBe(2);
      expect(discordKeys.length).toBe(1);
    });
  });
});
