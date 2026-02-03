/**
 * DilloBot Vault Migration
 *
 * Handles migration from plaintext credential storage to encrypted vault.
 */

import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { SecureVault, VaultMigrationResult } from "../types.js";
import { secureDelete } from "./aes-fallback.js";
import { buildVaultKey } from "./vault.js";

/**
 * Paths to plaintext credential files in OpenClaw.
 */
const PLAINTEXT_PATHS = {
  deviceAuth: path.join(os.homedir(), ".openclaw", "identity", "device-auth.json"),
  deviceIdentity: path.join(os.homedir(), ".openclaw", "identity", "device.json"),
  authProfiles: path.join(os.homedir(), ".openclaw", "auth-profiles.json"),
  legacyAuthProfiles: path.join(os.homedir(), ".openclaw", "auth.json"),
  gatewayToken: path.join(os.homedir(), ".openclaw", "gateway-token"),
  // DILLOBOT: Additional paths for comprehensive vault migration
  copilotToken: path.join(os.homedir(), ".openclaw", "credentials", "github-copilot.token.json"),
  envFile: path.join(os.homedir(), ".openclaw", ".env"),
  pairedDevices: path.join(os.homedir(), ".openclaw", "devices", "paired.json"),
};

/**
 * Migration marker file to prevent re-migration.
 */
const MIGRATION_MARKER = path.join(os.homedir(), ".openclaw", "security", ".migrated");

/**
 * Check if migration has already been completed.
 */
export async function isMigrationCompleted(): Promise<boolean> {
  try {
    await fs.access(MIGRATION_MARKER);
    return true;
  } catch {
    return false;
  }
}

/**
 * Check if plaintext credential files exist.
 */
export async function hasPlaintextCredentials(): Promise<boolean> {
  for (const filePath of Object.values(PLAINTEXT_PATHS)) {
    try {
      await fs.access(filePath);
      return true;
    } catch {
      // File doesn't exist, continue checking
    }
  }
  return false;
}

/**
 * Migrate plaintext credentials to secure vault.
 *
 * This function:
 * 1. Reads plaintext credential files
 * 2. Stores them in the encrypted vault
 * 3. Securely deletes the plaintext files
 * 4. Creates a migration marker
 *
 * @param vault The secure vault to migrate to
 * @returns Migration result with success/failure details
 */
export async function migrateToSecureVault(vault: SecureVault): Promise<VaultMigrationResult> {
  const result: VaultMigrationResult = {
    migrated: [],
    failed: [],
    skipped: [],
  };

  // Check if already migrated
  if (await isMigrationCompleted()) {
    console.info("[DilloBot Vault] Migration already completed, skipping");
    return result;
  }

  // Migrate device auth
  try {
    const migrated = await migrateDeviceAuth(vault);
    if (migrated) {
      result.migrated.push("device-auth");
    } else {
      result.skipped.push("device-auth");
    }
  } catch (error) {
    result.failed.push({
      key: "device-auth",
      error: (error as Error).message,
    });
  }

  // Migrate device identity
  try {
    const migrated = await migrateDeviceIdentity(vault);
    if (migrated) {
      result.migrated.push("device-identity");
    } else {
      result.skipped.push("device-identity");
    }
  } catch (error) {
    result.failed.push({
      key: "device-identity",
      error: (error as Error).message,
    });
  }

  // Migrate auth profiles
  try {
    const migrated = await migrateAuthProfiles(vault);
    if (migrated) {
      result.migrated.push("auth-profiles");
    } else {
      result.skipped.push("auth-profiles");
    }
  } catch (error) {
    result.failed.push({
      key: "auth-profiles",
      error: (error as Error).message,
    });
  }

  // Migrate gateway token
  try {
    const migrated = await migrateGatewayToken(vault);
    if (migrated) {
      result.migrated.push("gateway-token");
    } else {
      result.skipped.push("gateway-token");
    }
  } catch (error) {
    result.failed.push({
      key: "gateway-token",
      error: (error as Error).message,
    });
  }

  // DILLOBOT: Migrate Copilot token
  try {
    const migrated = await migrateCopilotToken(vault);
    if (migrated) {
      result.migrated.push("copilot-token");
    } else {
      result.skipped.push("copilot-token");
    }
  } catch (error) {
    result.failed.push({
      key: "copilot-token",
      error: (error as Error).message,
    });
  }

  // DILLOBOT: Migrate env file (OpenAI key, etc.)
  try {
    const migrated = await migrateEnvFile(vault);
    if (migrated) {
      result.migrated.push("env-file");
    } else {
      result.skipped.push("env-file");
    }
  } catch (error) {
    result.failed.push({
      key: "env-file",
      error: (error as Error).message,
    });
  }

  // Create migration marker if any migrations succeeded
  if (result.migrated.length > 0) {
    await createMigrationMarker(result);
  }

  return result;
}

/**
 * Migrate device auth tokens.
 */
async function migrateDeviceAuth(vault: SecureVault): Promise<boolean> {
  const filePath = PLAINTEXT_PATHS.deviceAuth;

  try {
    const content = await fs.readFile(filePath, "utf-8");
    const data = JSON.parse(content);

    // Store in vault
    const key = buildVaultKey("deviceAuth", data.deviceId ?? "default");
    await vault.store(key, Buffer.from(JSON.stringify(data)));

    // Securely delete plaintext
    await secureDelete(filePath);

    console.info(`[DilloBot Vault] Migrated device auth from ${filePath}`);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return false; // File doesn't exist
    }
    throw error;
  }
}

/**
 * Migrate device identity (private keys).
 */
async function migrateDeviceIdentity(vault: SecureVault): Promise<boolean> {
  const filePath = PLAINTEXT_PATHS.deviceIdentity;

  try {
    const content = await fs.readFile(filePath, "utf-8");
    const data = JSON.parse(content);

    // Store in vault
    const key = buildVaultKey("deviceIdentity", data.deviceId ?? "default");
    await vault.store(key, Buffer.from(JSON.stringify(data)));

    // Securely delete plaintext
    await secureDelete(filePath);

    console.info(`[DilloBot Vault] Migrated device identity from ${filePath}`);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return false;
    }
    throw error;
  }
}

/**
 * Migrate auth profiles (API keys, OAuth tokens).
 */
async function migrateAuthProfiles(vault: SecureVault): Promise<boolean> {
  const filePath = PLAINTEXT_PATHS.authProfiles;

  try {
    const content = await fs.readFile(filePath, "utf-8");
    const data = JSON.parse(content);

    // Store in vault
    const key = buildVaultKey("authProfile", "default");
    await vault.store(key, Buffer.from(JSON.stringify(data)));

    // Securely delete plaintext
    await secureDelete(filePath);

    console.info(`[DilloBot Vault] Migrated auth profiles from ${filePath}`);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return false;
    }
    throw error;
  }
}

/**
 * Migrate gateway token.
 */
async function migrateGatewayToken(vault: SecureVault): Promise<boolean> {
  const filePath = PLAINTEXT_PATHS.gatewayToken;

  try {
    const content = await fs.readFile(filePath, "utf-8");
    const token = content.trim();

    if (!token) {
      return false;
    }

    // Store in vault
    const key = buildVaultKey("gateway", "token");
    await vault.store(key, Buffer.from(token));

    // Securely delete plaintext
    await secureDelete(filePath);

    console.info(`[DilloBot Vault] Migrated gateway token from ${filePath}`);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return false;
    }
    throw error;
  }
}

/**
 * DILLOBOT: Migrate GitHub Copilot token.
 */
async function migrateCopilotToken(vault: SecureVault): Promise<boolean> {
  const filePath = PLAINTEXT_PATHS.copilotToken;

  try {
    const content = await fs.readFile(filePath, "utf-8");
    const data = JSON.parse(content);

    if (!data?.token) {
      return false;
    }

    // Store in vault
    const key = buildVaultKey("copilotToken", "default");
    await vault.store(key, Buffer.from(JSON.stringify(data)));

    // Note: We keep the file as a cache, but the vault is authoritative
    console.info(`[DilloBot Vault] Migrated Copilot token from ${filePath}`);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return false;
    }
    throw error;
  }
}

/**
 * DILLOBOT: Migrate sensitive env vars from .env file.
 */
async function migrateEnvFile(vault: SecureVault): Promise<boolean> {
  const filePath = PLAINTEXT_PATHS.envFile;
  const sensitiveKeys = ["OPENAI_API_KEY", "ANTHROPIC_API_KEY", "GEMINI_API_KEY"];

  try {
    const content = await fs.readFile(filePath, "utf-8");
    const lines = content.split(/\r?\n/);
    let migrated = false;

    for (const line of lines) {
      const match = line.match(/^\s*(?:export\s+)?([A-Z_]+)\s*=\s*(.+)$/);
      if (!match) continue;

      const [, keyName, value] = match;
      if (!sensitiveKeys.includes(keyName)) continue;

      const trimmedValue = value.trim().replace(/^["']|["']$/g, "");
      if (!trimmedValue) continue;

      // Store in vault
      const key = buildVaultKey("openaiKey", keyName);
      await vault.store(key, Buffer.from(JSON.stringify({ value: trimmedValue })));
      migrated = true;
      console.info(`[DilloBot Vault] Migrated ${keyName} from ${filePath}`);
    }

    return migrated;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return false;
    }
    throw error;
  }
}

/**
 * Create migration marker file.
 */
async function createMigrationMarker(result: VaultMigrationResult): Promise<void> {
  const markerContent = {
    version: 1,
    migratedAt: new Date().toISOString(),
    migrated: result.migrated,
    failed: result.failed.map((f) => f.key),
    skipped: result.skipped,
  };

  const dir = path.dirname(MIGRATION_MARKER);
  await fs.mkdir(dir, { recursive: true, mode: 0o700 });
  await fs.writeFile(MIGRATION_MARKER, JSON.stringify(markerContent, null, 2), { mode: 0o600 });
}

/**
 * Reset migration (for testing or recovery).
 *
 * WARNING: This removes the migration marker but does not restore plaintext files.
 */
export async function resetMigration(): Promise<void> {
  try {
    await fs.unlink(MIGRATION_MARKER);
    console.info("[DilloBot Vault] Migration marker removed");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      throw error;
    }
  }
}

/**
 * Get migration status.
 */
export async function getMigrationStatus(): Promise<{
  completed: boolean;
  hasPlaintext: boolean;
  details?: {
    migratedAt: string;
    migrated: string[];
    failed: string[];
    skipped: string[];
  };
}> {
  const completed = await isMigrationCompleted();
  const hasPlaintext = await hasPlaintextCredentials();

  if (!completed) {
    return { completed, hasPlaintext };
  }

  try {
    const content = await fs.readFile(MIGRATION_MARKER, "utf-8");
    const details = JSON.parse(content);
    return { completed, hasPlaintext, details };
  } catch {
    return { completed, hasPlaintext };
  }
}
