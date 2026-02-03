/**
 * DilloBot AES Fallback Vault
 *
 * Provides AES-256-GCM encrypted file-based credential storage
 * when platform-specific keychains are not available.
 */

import crypto from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { SecureVault, VaultBackend } from "../types.js";

/**
 * Default vault file path.
 */
const DEFAULT_VAULT_PATH = path.join(os.homedir(), ".openclaw", "security", "vault.enc");

/**
 * Salt file path (stored separately from vault).
 */
const SALT_FILE_NAME = "vault.salt";

/**
 * PBKDF2 configuration (OWASP 2023 recommendations).
 */
const PBKDF2_CONFIG = {
  iterations: 310000,
  keyLength: 32, // 256 bits
  digest: "sha256",
};

/**
 * AES-GCM configuration.
 */
const AES_CONFIG = {
  algorithm: "aes-256-gcm" as const,
  ivLength: 12, // 96 bits for GCM
  authTagLength: 16, // 128 bits
};

/**
 * Vault file format.
 */
interface VaultFile {
  version: 1;
  entries: Record<
    string,
    {
      iv: string; // base64
      ciphertext: string; // base64
      authTag: string; // base64
    }
  >;
}

/**
 * AES-256-GCM encrypted file vault implementation.
 */
export class AesFallbackVault implements SecureVault {
  readonly backend: VaultBackend = "aes-fallback";

  private vaultPath: string;
  private masterKey: Buffer | null = null;
  private password: string | undefined;
  private initialized = false;

  constructor(vaultPath?: string, password?: string) {
    this.vaultPath = vaultPath ?? DEFAULT_VAULT_PATH;
    this.password = password;
  }

  /**
   * Initialize the vault, deriving the master key from password.
   */
  private async initialize(): Promise<void> {
    if (this.initialized) return;

    // Ensure directory exists
    const dir = path.dirname(this.vaultPath);
    await fs.mkdir(dir, { recursive: true, mode: 0o700 });

    // Get or create salt
    const salt = await this.getOrCreateSalt();

    // Derive master key from password (constructor password, env var, or machine-derived)
    const password = this.password ?? (await this.getPasswordFromEnvironment());
    this.masterKey = await this.deriveKey(password, salt);
    this.initialized = true;
  }

  /**
   * Get or create the salt file.
   */
  private async getOrCreateSalt(): Promise<Buffer> {
    const saltPath = path.join(path.dirname(this.vaultPath), SALT_FILE_NAME);

    try {
      const salt = await fs.readFile(saltPath);
      return salt;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        // Create new salt
        const salt = crypto.randomBytes(32);
        await fs.writeFile(saltPath, salt, { mode: 0o600 });
        return salt;
      }
      throw error;
    }
  }

  /**
   * Get password from environment or derive from machine identity.
   *
   * Priority:
   * 1. DILLOBOT_VAULT_PASSWORD env var (for testing/override)
   * 2. OPENCLAW_VAULT_PASSWORD env var (legacy)
   * 3. Machine-derived key (hostname + homedir + platform hash)
   */
  private async getPasswordFromEnvironment(): Promise<string> {
    // Check env vars first (for testing/override)
    const envPassword = process.env.DILLOBOT_VAULT_PASSWORD ?? process.env.OPENCLAW_VAULT_PASSWORD;
    if (envPassword) {
      return envPassword;
    }

    // Generate machine-derived password (no user input needed)
    // This ties the vault to this specific machine
    return this.getMachineId();
  }

  /**
   * Generate a machine-specific identifier for passwordless encryption.
   *
   * Uses combination of hostname, homedir, platform, and arch to create
   * a unique but deterministic key for this machine. Credentials encrypted
   * with this key won't decrypt on a different machine.
   */
  private getMachineId(): string {
    const data = `dillobot:vault:${os.hostname()}:${os.homedir()}:${os.platform()}:${os.arch()}`;
    return crypto.createHash("sha256").update(data).digest("hex");
  }

  /**
   * Derive encryption key from password using PBKDF2.
   */
  private async deriveKey(password: string, salt: Buffer): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      crypto.pbkdf2(
        password,
        salt,
        PBKDF2_CONFIG.iterations,
        PBKDF2_CONFIG.keyLength,
        PBKDF2_CONFIG.digest,
        (err: Error | null, key: Buffer) => {
          if (err) reject(err);
          else resolve(key);
        },
      );
    });
  }

  /**
   * Load the vault file.
   */
  private async loadVault(): Promise<VaultFile> {
    try {
      const data = await fs.readFile(this.vaultPath, "utf-8");
      return JSON.parse(data) as VaultFile;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return { version: 1, entries: {} };
      }
      throw error;
    }
  }

  /**
   * Save the vault file.
   */
  private async saveVault(vault: VaultFile): Promise<void> {
    const tempPath = `${this.vaultPath}.tmp`;
    await fs.writeFile(tempPath, JSON.stringify(vault, null, 2), { mode: 0o600 });
    await fs.rename(tempPath, this.vaultPath);
  }

  /**
   * Encrypt a value.
   */
  private encrypt(value: Buffer): { iv: string; ciphertext: string; authTag: string } {
    if (!this.masterKey) {
      throw new Error("Vault not initialized");
    }

    const iv = crypto.randomBytes(AES_CONFIG.ivLength);
    const cipher = crypto.createCipheriv(AES_CONFIG.algorithm, this.masterKey, iv);

    const ciphertext = Buffer.concat([cipher.update(value), cipher.final()]);
    const authTag = cipher.getAuthTag();

    return {
      iv: iv.toString("base64"),
      ciphertext: ciphertext.toString("base64"),
      authTag: authTag.toString("base64"),
    };
  }

  /**
   * Decrypt a value.
   */
  private decrypt(entry: { iv: string; ciphertext: string; authTag: string }): Buffer {
    if (!this.masterKey) {
      throw new Error("Vault not initialized");
    }

    const iv = Buffer.from(entry.iv, "base64");
    const ciphertext = Buffer.from(entry.ciphertext, "base64");
    const authTag = Buffer.from(entry.authTag, "base64");

    const decipher = crypto.createDecipheriv(AES_CONFIG.algorithm, this.masterKey, iv);
    decipher.setAuthTag(authTag);

    return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  }

  async store(key: string, value: Buffer): Promise<void> {
    await this.initialize();

    const vault = await this.loadVault();
    vault.entries[key] = this.encrypt(value);
    await this.saveVault(vault);
  }

  async retrieve(key: string): Promise<Buffer | null> {
    await this.initialize();

    const vault = await this.loadVault();
    const entry = vault.entries[key];

    if (!entry) return null;

    try {
      return this.decrypt(entry);
    } catch (error) {
      console.error(`[DilloBot Vault] Failed to decrypt entry ${key}:`, error);
      return null;
    }
  }

  async delete(key: string): Promise<boolean> {
    await this.initialize();

    const vault = await this.loadVault();

    if (!(key in vault.entries)) {
      return false;
    }

    // Overwrite with zeros before deletion (secure deletion)
    const entry = vault.entries[key];
    entry.ciphertext = Buffer.alloc(Buffer.from(entry.ciphertext, "base64").length).toString(
      "base64",
    );

    delete vault.entries[key];
    await this.saveVault(vault);

    return true;
  }

  async exists(key: string): Promise<boolean> {
    await this.initialize();

    const vault = await this.loadVault();
    return key in vault.entries;
  }

  async list(): Promise<string[]> {
    await this.initialize();

    const vault = await this.loadVault();
    return Object.keys(vault.entries);
  }

  async rotateKeys(): Promise<void> {
    await this.initialize();

    // Load and decrypt all entries with current key
    const vault = await this.loadVault();
    const decrypted: Record<string, Buffer> = {};

    for (const [key, entry] of Object.entries(vault.entries)) {
      try {
        decrypted[key] = this.decrypt(entry);
      } catch {
        console.warn(`[DilloBot Vault] Skipping corrupted entry during rotation: ${key}`);
      }
    }

    // Generate new salt and derive new key
    const newSalt = crypto.randomBytes(32);
    const password = this.password ?? (await this.getPasswordFromEnvironment());
    if (!password) {
      throw new Error("Password required for key rotation");
    }

    const newMasterKey = await this.deriveKey(password, newSalt);

    // Save new salt
    const saltPath = path.join(path.dirname(this.vaultPath), SALT_FILE_NAME);
    await fs.writeFile(saltPath, newSalt, { mode: 0o600 });

    // Update master key
    const oldKey = this.masterKey;
    this.masterKey = newMasterKey;

    // Re-encrypt all entries with new key
    const newVault: VaultFile = { version: 1, entries: {} };
    for (const [key, value] of Object.entries(decrypted)) {
      newVault.entries[key] = this.encrypt(value);
    }

    await this.saveVault(newVault);

    // Zero out old key
    if (oldKey) {
      oldKey.fill(0);
    }
  }
}

/**
 * Securely delete a file by overwriting with zeros before unlinking.
 */
export async function secureDelete(filePath: string): Promise<void> {
  try {
    const stat = await fs.stat(filePath);
    const zeros = Buffer.alloc(stat.size);

    // Overwrite file with zeros
    const handle = await fs.open(filePath, "r+");
    await handle.write(zeros, 0, zeros.length, 0);
    await handle.sync();
    await handle.close();

    // Now delete
    await fs.unlink(filePath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      throw error;
    }
  }
}
