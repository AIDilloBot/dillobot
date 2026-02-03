/**
 * DilloBot AES Fallback Vault
 *
 * Provides AES-256-GCM encrypted file-based credential storage
 * when platform-specific keychains are not available.
 *
 * SECURITY: Uses hardware-based machine UUID for key derivation.
 * This is much more secure than hostname/homedir which are easily guessable.
 */

import { execSync } from "node:child_process";
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
 * Get hardware-based machine UUID.
 *
 * This is MUCH more secure than hostname/homedir/platform because:
 * - It requires local access to the machine to read
 * - It's a random UUID, not predictable
 * - It persists across reboots but is unique per machine
 *
 * @returns Hardware UUID or null if not available
 */
async function getHardwareUUID(): Promise<string | null> {
  const platform = os.platform();

  try {
    if (platform === "darwin") {
      // macOS: Get IOPlatformUUID (hardware UUID)
      // This requires local access - cannot be read remotely
      const output = execSync("ioreg -rd1 -c IOPlatformExpertDevice", {
        encoding: "utf-8",
        timeout: 5000,
      });
      const match = output.match(/"IOPlatformUUID"\s*=\s*"([^"]+)"/);
      if (match?.[1]) {
        return match[1];
      }
    } else if (platform === "linux") {
      // Linux: Read machine-id file
      // This is generated at install time and is unique per installation
      try {
        const machineId = await fs.readFile("/etc/machine-id", "utf-8");
        if (machineId.trim()) {
          return machineId.trim();
        }
      } catch {
        // Try alternate location (older systems)
        try {
          const machineId = await fs.readFile("/var/lib/dbus/machine-id", "utf-8");
          if (machineId.trim()) {
            return machineId.trim();
          }
        } catch {
          // Fall through
        }
      }
    } else if (platform === "win32") {
      // Windows: Read MachineGuid from registry
      // Generated at Windows install, unique per installation
      const output = execSync(
        'reg query "HKLM\\SOFTWARE\\Microsoft\\Cryptography" /v MachineGuid',
        { encoding: "utf-8", timeout: 5000 },
      );
      const match = output.match(/MachineGuid\s+REG_SZ\s+(\S+)/);
      if (match?.[1]) {
        return match[1];
      }
    }
  } catch {
    // Failed to get hardware UUID, will fall back
  }

  return null;
}

/**
 * Generate legacy machine ID (for migration from old vaults).
 * This uses hostname/homedir/platform which is less secure.
 */
function getLegacyMachineId(): string {
  const data = `dillobot:vault:${os.hostname()}:${os.homedir()}:${os.platform()}:${os.arch()}`;
  return crypto.createHash("sha256").update(data).digest("hex");
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
  private usingLegacyKey = false;

  constructor(vaultPath?: string, password?: string) {
    this.vaultPath = vaultPath ?? DEFAULT_VAULT_PATH;
    this.password = password;
  }

  /**
   * Initialize the vault, deriving the master key from password.
   * Handles migration from legacy (hostname-based) to hardware UUID keys.
   */
  private async initialize(): Promise<void> {
    if (this.initialized) return;

    // Ensure directory exists
    const dir = path.dirname(this.vaultPath);
    await fs.mkdir(dir, { recursive: true, mode: 0o700 });

    // Get or create salt
    const salt = await this.getOrCreateSalt();

    // Get password (constructor password, env var, or machine-derived)
    const password = this.password ?? (await this.getPasswordFromEnvironment());
    this.masterKey = await this.deriveKey(password, salt);
    this.initialized = true;

    // Check if we need to migrate from legacy key
    await this.checkAndMigrateLegacyVault(salt);
  }

  /**
   * Check if vault exists with legacy key and migrate to new key.
   */
  private async checkAndMigrateLegacyVault(salt: Buffer): Promise<void> {
    // Only check migration if we're using hardware-based key (not env password)
    if (
      this.password ||
      process.env.DILLOBOT_VAULT_PASSWORD ||
      process.env.OPENCLAW_VAULT_PASSWORD
    ) {
      return;
    }

    // Check if vault file exists
    try {
      await fs.access(this.vaultPath);
    } catch {
      // No vault file, nothing to migrate
      return;
    }

    // Try to read vault with current key
    const vault = await this.loadVault();
    if (Object.keys(vault.entries).length === 0) {
      // Empty vault, nothing to migrate
      return;
    }

    // Try to decrypt any entry with current key
    const firstKey = Object.keys(vault.entries)[0];
    try {
      this.decrypt(vault.entries[firstKey]);
      // Decryption succeeded, current key is correct
      return;
    } catch {
      // Current key failed, try legacy key
    }

    // Try legacy key
    const legacyPassword = getLegacyMachineId();
    const legacyKey = await this.deriveKey(legacyPassword, salt);
    const originalKey = this.masterKey;
    this.masterKey = legacyKey;

    try {
      this.decrypt(vault.entries[firstKey]);
      // Legacy key worked! We need to migrate.
      console.log("[DilloBot Vault] Migrating vault from legacy to hardware-based key...");
      this.usingLegacyKey = true;

      // Decrypt all entries with legacy key
      const decrypted: Record<string, Buffer> = {};
      for (const [key, entry] of Object.entries(vault.entries)) {
        try {
          decrypted[key] = this.decrypt(entry);
        } catch {
          console.warn(`[DilloBot Vault] Skipping corrupted entry during migration: ${key}`);
        }
      }

      // Switch to new key and re-encrypt
      this.masterKey = originalKey;
      this.usingLegacyKey = false;

      const newVault: VaultFile = { version: 1, entries: {} };
      for (const [key, value] of Object.entries(decrypted)) {
        newVault.entries[key] = this.encrypt(value);
      }

      await this.saveVault(newVault);
      console.log("[DilloBot Vault] Migration complete. Vault now uses hardware-based key.");

      // Zero out legacy key
      legacyKey.fill(0);
    } catch {
      // Neither key works - vault may be corrupted or from different machine
      // Restore original key and let normal error handling take over
      this.masterKey = originalKey;
      legacyKey.fill(0);
    }
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
   * 3. Hardware-based machine UUID (secure)
   * 4. Fallback to hostname-based ID (if hardware UUID unavailable)
   */
  private async getPasswordFromEnvironment(): Promise<string> {
    // Check env vars first (for testing/override)
    const envPassword = process.env.DILLOBOT_VAULT_PASSWORD ?? process.env.OPENCLAW_VAULT_PASSWORD;
    if (envPassword) {
      return envPassword;
    }

    // Generate machine-derived password using hardware UUID
    return await this.getMachineId();
  }

  /**
   * Generate a machine-specific identifier for passwordless encryption.
   *
   * Uses hardware-based UUID which is:
   * - Unique per machine
   * - Requires local access to read
   * - Not predictable/guessable like hostname
   *
   * Falls back to legacy method if hardware UUID not available.
   */
  private async getMachineId(): Promise<string> {
    // Try to get hardware UUID first (more secure)
    const hardwareUUID = await getHardwareUUID();

    if (hardwareUUID) {
      // Use hardware UUID - much harder for attackers to obtain
      const data = `dillobot:vault:hw:${hardwareUUID}`;
      return crypto.createHash("sha256").update(data).digest("hex");
    }

    // Fallback to legacy method if hardware UUID not available
    // This shouldn't happen on normal systems, but provides a safety net
    console.warn(
      "[DilloBot Vault] Hardware UUID not available, using fallback machine ID. " +
        "This is less secure - consider investigating why hardware UUID is not accessible.",
    );
    return getLegacyMachineId();
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
   *
   * Handles corrupted JSON gracefully by backing up the corrupted file
   * and starting fresh. This prevents vault corruption from blocking
   * all credential operations.
   */
  private async loadVault(): Promise<VaultFile> {
    try {
      const data = await fs.readFile(this.vaultPath, "utf-8");
      const parsed = JSON.parse(data) as VaultFile;

      // Validate basic structure
      if (!parsed || typeof parsed !== "object" || !parsed.entries) {
        throw new Error("Invalid vault structure");
      }

      return parsed;
    } catch (error) {
      const err = error as NodeJS.ErrnoException;

      // File doesn't exist - return empty vault
      if (err.code === "ENOENT") {
        return { version: 1, entries: {} };
      }

      // JSON parse error or invalid structure - vault is corrupted
      if (err instanceof SyntaxError || err.message === "Invalid vault structure") {
        console.warn(
          `[DilloBot Vault] Vault file corrupted, backing up and starting fresh: ${err.message}`,
        );

        // Backup corrupted file
        try {
          const backupPath = `${this.vaultPath}.corrupted.${Date.now()}`;
          await fs.rename(this.vaultPath, backupPath);
          console.warn(`[DilloBot Vault] Corrupted vault backed up to: ${backupPath}`);
        } catch {
          // If backup fails, just delete the corrupted file
          try {
            await fs.unlink(this.vaultPath);
          } catch {
            // Ignore deletion errors
          }
        }

        // Return empty vault to start fresh
        return { version: 1, entries: {} };
      }

      // Other errors (permissions, etc.) should still throw
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

// Export for testing
export { getHardwareUUID, getLegacyMachineId };
