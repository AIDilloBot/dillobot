/**
 * DilloBot Vault Manager Tests
 *
 * These tests use the AesFallbackVault directly to avoid singleton issues
 * and test the vault operations in isolation.
 */

import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { AesFallbackVault } from "./aes-fallback.js";
import { buildVaultKey, VAULT_KEY_PREFIXES } from "./vault.js";

describe("vault-manager", () => {
  let testDir: string;
  let vault: AesFallbackVault;

  beforeEach(async () => {
    // Create unique test directory for each test
    testDir = path.join(
      os.tmpdir(),
      `vault-manager-test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    );
    await fs.mkdir(testDir, { recursive: true });
    // Create vault with test-specific path and password
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

  async function listCredentials(prefix: keyof typeof VAULT_KEY_PREFIXES): Promise<string[]> {
    const allKeys = await vault.list();
    const prefixStr = VAULT_KEY_PREFIXES[prefix];
    return allKeys
      .filter((key) => key.startsWith(prefixStr))
      .map((key) => key.slice(prefixStr.length));
  }

  // Convenience helpers
  async function storeAuthProfiles(agentId: string, profiles: unknown): Promise<void> {
    await storeCredential("authProfile", agentId, profiles);
  }

  async function retrieveAuthProfiles<T>(agentId: string): Promise<T | null> {
    return retrieveCredential<T>("authProfile", agentId);
  }

  async function storeDeviceIdentity(deviceId: string, identity: unknown): Promise<void> {
    await storeCredential("deviceIdentity", deviceId, identity);
  }

  async function retrieveDeviceIdentity<T>(deviceId: string): Promise<T | null> {
    return retrieveCredential<T>("deviceIdentity", deviceId);
  }

  async function storeDeviceAuth(deviceId: string, auth: unknown): Promise<void> {
    await storeCredential("deviceAuth", deviceId, auth);
  }

  async function retrieveDeviceAuth<T>(deviceId: string): Promise<T | null> {
    return retrieveCredential<T>("deviceAuth", deviceId);
  }

  describe("vault instance", () => {
    it("returns a valid vault backend", async () => {
      expect(vault).toBeDefined();
      expect(vault.backend).toBe("aes-fallback");
    });
  });

  describe("storeCredential and retrieveCredential", () => {
    it("stores and retrieves a credential", async () => {
      const data = { key: "test-api-key", email: "test@example.com" };
      await storeCredential("authProfile", "test-id", data);

      const retrieved = await retrieveCredential<typeof data>("authProfile", "test-id");
      expect(retrieved).toEqual(data);
    });

    it("overwrites existing credential", async () => {
      const data1 = { key: "first-key" };
      const data2 = { key: "second-key" };

      await storeCredential("authProfile", "overwrite-test", data1);
      await storeCredential("authProfile", "overwrite-test", data2);

      const retrieved = await retrieveCredential<typeof data2>("authProfile", "overwrite-test");
      expect(retrieved).toEqual(data2);
    });

    it("returns null for non-existent credential", async () => {
      const retrieved = await retrieveCredential("authProfile", "non-existent");
      expect(retrieved).toBeNull();
    });
  });

  describe("deleteCredential", () => {
    it("deletes an existing credential", async () => {
      await storeCredential("authProfile", "delete-test", { key: "value" });
      const deleted = await deleteCredential("authProfile", "delete-test");
      expect(deleted).toBe(true);

      const retrieved = await retrieveCredential("authProfile", "delete-test");
      expect(retrieved).toBeNull();
    });

    it("returns false for non-existent credential", async () => {
      const deleted = await deleteCredential("authProfile", "non-existent");
      expect(deleted).toBe(false);
    });
  });

  describe("hasCredential", () => {
    it("returns true for existing credential", async () => {
      await storeCredential("authProfile", "exists-test", { key: "value" });
      const exists = await hasCredential("authProfile", "exists-test");
      expect(exists).toBe(true);
    });

    it("returns false for non-existent credential", async () => {
      const exists = await hasCredential("authProfile", "non-existent");
      expect(exists).toBe(false);
    });
  });

  describe("listCredentials", () => {
    it("lists credentials of a given type", async () => {
      await storeCredential("authProfile", "profile-1", { key: "k1" });
      await storeCredential("authProfile", "profile-2", { key: "k2" });
      await storeCredential("deviceAuth", "device-1", { token: "t1" });

      const authProfiles = await listCredentials("authProfile");
      expect(authProfiles).toContain("profile-1");
      expect(authProfiles).toContain("profile-2");
      expect(authProfiles).not.toContain("device-1");

      const deviceAuths = await listCredentials("deviceAuth");
      expect(deviceAuths).toContain("device-1");
    });
  });

  describe("convenience helpers", () => {
    it("storeAuthProfiles and retrieveAuthProfiles", async () => {
      const profiles = {
        version: 1,
        profiles: {
          "anthropic:default": { type: "api_key", provider: "anthropic", key: "sk-xxx" },
        },
      };
      await storeAuthProfiles("agent-1", profiles);

      const retrieved = await retrieveAuthProfiles<typeof profiles>("agent-1");
      expect(retrieved).toEqual(profiles);
    });

    it("storeDeviceIdentity and retrieveDeviceIdentity", async () => {
      const identity = {
        privateKeyPem: "-----BEGIN PRIVATE KEY-----\ntest\n-----END PRIVATE KEY-----",
      };
      await storeDeviceIdentity("device-123", identity);

      const retrieved = await retrieveDeviceIdentity<typeof identity>("device-123");
      expect(retrieved).toEqual(identity);
    });

    it("storeDeviceAuth and retrieveDeviceAuth", async () => {
      const auth = { version: 1, deviceId: "device-123", tokens: { gateway: { token: "xxx" } } };
      await storeDeviceAuth("device-123", auth);

      const retrieved = await retrieveDeviceAuth<typeof auth>("device-123");
      expect(retrieved).toEqual(auth);
    });
  });
});
