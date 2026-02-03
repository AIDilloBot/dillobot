/**
 * DilloBot AES Fallback Vault Tests
 */

import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { AesFallbackVault, secureDelete } from "./aes-fallback.js";

describe("AesFallbackVault", () => {
  const testDir = path.join(os.tmpdir(), `aes-vault-test-${Date.now()}`);
  const testVaultPath = path.join(testDir, "vault.enc");

  beforeEach(async () => {
    await fs.mkdir(testDir, { recursive: true });
  });

  afterEach(async () => {
    delete process.env.DILLOBOT_VAULT_PASSWORD;
    delete process.env.OPENCLAW_VAULT_PASSWORD;
    try {
      await fs.rm(testDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  describe("passwordless operation", () => {
    it("works without env password (machine-derived key)", async () => {
      // No password set - should use machine-derived key
      const vault = new AesFallbackVault(testVaultPath);

      const testData = Buffer.from("secret-data");
      await vault.store("test-key", testData);

      const retrieved = await vault.retrieve("test-key");
      expect(retrieved).toEqual(testData);
    });

    it("uses DILLOBOT_VAULT_PASSWORD when set", async () => {
      process.env.DILLOBOT_VAULT_PASSWORD = "custom-password";
      const vault = new AesFallbackVault(testVaultPath);

      const testData = Buffer.from("secret-data");
      await vault.store("test-key", testData);

      const retrieved = await vault.retrieve("test-key");
      expect(retrieved).toEqual(testData);
    });

    it("uses OPENCLAW_VAULT_PASSWORD as fallback", async () => {
      process.env.OPENCLAW_VAULT_PASSWORD = "legacy-password";
      const vault = new AesFallbackVault(testVaultPath);

      const testData = Buffer.from("secret-data");
      await vault.store("test-key", testData);

      const retrieved = await vault.retrieve("test-key");
      expect(retrieved).toEqual(testData);
    });
  });

  describe("store and retrieve", () => {
    it("stores and retrieves data correctly", async () => {
      const vault = new AesFallbackVault(testVaultPath, "test-password");

      const testData = Buffer.from(JSON.stringify({ key: "value", nested: { a: 1 } }));
      await vault.store("json-key", testData);

      const retrieved = await vault.retrieve("json-key");
      expect(retrieved).toEqual(testData);
    });

    it("handles multiple keys", async () => {
      const vault = new AesFallbackVault(testVaultPath, "test-password");

      await vault.store("key-1", Buffer.from("data-1"));
      await vault.store("key-2", Buffer.from("data-2"));
      await vault.store("key-3", Buffer.from("data-3"));

      expect(await vault.retrieve("key-1")).toEqual(Buffer.from("data-1"));
      expect(await vault.retrieve("key-2")).toEqual(Buffer.from("data-2"));
      expect(await vault.retrieve("key-3")).toEqual(Buffer.from("data-3"));
    });

    it("returns null for non-existent key", async () => {
      const vault = new AesFallbackVault(testVaultPath, "test-password");
      const retrieved = await vault.retrieve("non-existent");
      expect(retrieved).toBeNull();
    });
  });

  describe("delete", () => {
    it("deletes an existing key", async () => {
      const vault = new AesFallbackVault(testVaultPath, "test-password");

      await vault.store("to-delete", Buffer.from("data"));
      expect(await vault.exists("to-delete")).toBe(true);

      const deleted = await vault.delete("to-delete");
      expect(deleted).toBe(true);
      expect(await vault.exists("to-delete")).toBe(false);
    });

    it("returns false for non-existent key", async () => {
      const vault = new AesFallbackVault(testVaultPath, "test-password");
      const deleted = await vault.delete("non-existent");
      expect(deleted).toBe(false);
    });
  });

  describe("exists", () => {
    it("returns true for existing key", async () => {
      const vault = new AesFallbackVault(testVaultPath, "test-password");
      await vault.store("exists-key", Buffer.from("data"));
      expect(await vault.exists("exists-key")).toBe(true);
    });

    it("returns false for non-existent key", async () => {
      const vault = new AesFallbackVault(testVaultPath, "test-password");
      expect(await vault.exists("non-existent")).toBe(false);
    });
  });

  describe("list", () => {
    it("lists all stored keys", async () => {
      const vault = new AesFallbackVault(testVaultPath, "test-password");

      await vault.store("list-key-1", Buffer.from("data-1"));
      await vault.store("list-key-2", Buffer.from("data-2"));

      const keys = await vault.list();
      expect(keys).toContain("list-key-1");
      expect(keys).toContain("list-key-2");
    });

    it("returns empty array for empty vault", async () => {
      const vault = new AesFallbackVault(testVaultPath, "test-password");
      const keys = await vault.list();
      expect(keys).toEqual([]);
    });
  });

  describe("key rotation", () => {
    it("rotates keys and re-encrypts all entries", async () => {
      const vault = new AesFallbackVault(testVaultPath, "test-password");

      // Store some data
      await vault.store("rotate-key-1", Buffer.from("data-1"));
      await vault.store("rotate-key-2", Buffer.from("data-2"));

      // Rotate keys
      await vault.rotateKeys();

      // Verify data is still accessible
      expect(await vault.retrieve("rotate-key-1")).toEqual(Buffer.from("data-1"));
      expect(await vault.retrieve("rotate-key-2")).toEqual(Buffer.from("data-2"));
    });
  });

  describe("backend property", () => {
    it("reports aes-fallback backend", async () => {
      const vault = new AesFallbackVault(testVaultPath, "test-password");
      expect(vault.backend).toBe("aes-fallback");
    });
  });

  describe("corrupted vault recovery", () => {
    it("recovers from corrupted JSON by starting fresh", async () => {
      // Write corrupted JSON to vault file
      await fs.mkdir(testDir, { recursive: true });
      await fs.writeFile(testVaultPath, '{"version":1,"entries":{}}garbage data here', "utf-8");

      const vault = new AesFallbackVault(testVaultPath, "test-password");

      // Should not throw, should recover gracefully
      const keys = await vault.list();
      expect(keys).toEqual([]);

      // Should be able to store new data
      await vault.store("new-key", Buffer.from("new-data"));
      const retrieved = await vault.retrieve("new-key");
      expect(retrieved).toEqual(Buffer.from("new-data"));
    });

    it("recovers from invalid vault structure", async () => {
      // Write valid JSON but invalid vault structure
      await fs.mkdir(testDir, { recursive: true });
      await fs.writeFile(testVaultPath, '{"foo":"bar"}', "utf-8");

      const vault = new AesFallbackVault(testVaultPath, "test-password");

      // Should recover and return empty entries
      const keys = await vault.list();
      expect(keys).toEqual([]);
    });

    it("creates backup of corrupted vault file", async () => {
      await fs.mkdir(testDir, { recursive: true });
      await fs.writeFile(testVaultPath, "completely invalid", "utf-8");

      const vault = new AesFallbackVault(testVaultPath, "test-password");
      await vault.list(); // Triggers load and recovery

      // Check that a backup file was created
      const files = await fs.readdir(testDir);
      const backupFiles = files.filter((f) => f.includes(".corrupted."));
      expect(backupFiles.length).toBeGreaterThan(0);
    });
  });
});

describe("secureDelete", () => {
  const testDir = path.join(os.tmpdir(), `secure-delete-test-${Date.now()}`);

  beforeEach(async () => {
    await fs.mkdir(testDir, { recursive: true });
  });

  afterEach(async () => {
    try {
      await fs.rm(testDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  it("deletes a file", async () => {
    const filePath = path.join(testDir, "to-delete.txt");
    await fs.writeFile(filePath, "sensitive data");

    await secureDelete(filePath);

    await expect(fs.access(filePath)).rejects.toThrow();
  });

  it("handles non-existent file gracefully", async () => {
    const filePath = path.join(testDir, "non-existent.txt");
    await expect(secureDelete(filePath)).resolves.not.toThrow();
  });
});
