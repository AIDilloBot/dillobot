/**
 * DilloBot Secure Vault
 *
 * Provides encrypted credential storage with platform-specific backends:
 * - macOS: Keychain
 * - Windows: Credential Manager
 * - Linux: Secret Service (D-Bus)
 * - Fallback: AES-256-GCM encrypted file
 */

import os from "node:os";
import type { SecureVault, VaultBackend } from "../types.js";

// Declare keytar as optional module (installed separately for native keychain support)
declare module "keytar" {
  export function setPassword(service: string, account: string, password: string): Promise<void>;
  export function getPassword(service: string, account: string): Promise<string | null>;
  export function deletePassword(service: string, account: string): Promise<boolean>;
  export function findCredentials(service: string): Promise<Array<{ account: string; password: string }>>;
}

/**
 * Service name for vault entries.
 */
export const VAULT_SERVICE_NAME = "com.dillobot.openclaw";

/**
 * Detect the default vault backend for the current platform.
 */
export function getDefaultVaultBackend(): VaultBackend {
  const platform = os.platform();

  switch (platform) {
    case "darwin":
      return "keychain";
    case "win32":
      return "credential-manager";
    case "linux":
      return "secret-service";
    default:
      return "aes-fallback";
  }
}

/**
 * Check if a vault backend is available on the current platform.
 */
export async function isBackendAvailable(backend: VaultBackend): Promise<boolean> {
  switch (backend) {
    case "keychain":
      return os.platform() === "darwin";

    case "credential-manager":
      return os.platform() === "win32";

    case "secret-service":
      if (os.platform() !== "linux") return false;
      // Check if D-Bus secret service is available
      try {
        // This would require checking for libsecret availability
        // For now, assume it's available on Linux
        return true;
      } catch {
        return false;
      }

    case "aes-fallback":
      return true; // Always available

    case "auto":
      return true;
  }
}

/**
 * Create a secure vault with the specified or auto-detected backend.
 *
 * @param preferredBackend The preferred backend, or "auto" to auto-detect
 * @param options Optional configuration
 * @returns A SecureVault instance
 */
export async function createVault(
  preferredBackend: VaultBackend = "auto",
  options?: {
    vaultPath?: string;
    password?: string;
  },
): Promise<SecureVault> {
  let backend = preferredBackend;

  if (backend === "auto") {
    backend = getDefaultVaultBackend();
  }

  // Check if the preferred backend is available
  const available = await isBackendAvailable(backend);
  if (!available) {
    console.warn(`[DilloBot Vault] Backend ${backend} not available, falling back to aes-fallback`);
    backend = "aes-fallback";
  }

  switch (backend) {
    case "keychain":
      return createKeychainVault();

    case "credential-manager":
      return createCredentialManagerVault();

    case "secret-service":
      return createSecretServiceVault();

    case "aes-fallback":
      return createAesFallbackVault(options?.vaultPath, options?.password);

    default:
      throw new Error(`Unknown vault backend: ${backend}`);
  }
}

/**
 * Create macOS Keychain vault.
 *
 * Uses the keytar library for cross-platform keychain access.
 */
async function createKeychainVault(): Promise<SecureVault> {
  // Dynamic import to avoid requiring keytar on all platforms
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let keytar: any;
  try {
    keytar = await import("keytar");
  } catch {
    console.warn("[DilloBot Vault] keytar not available, falling back to AES vault");
    return createAesFallbackVault();
  }

  return {
    backend: "keychain",

    async store(key: string, value: Buffer): Promise<void> {
      await keytar.setPassword(VAULT_SERVICE_NAME, key, value.toString("base64"));
    },

    async retrieve(key: string): Promise<Buffer | null> {
      const encoded = await keytar.getPassword(VAULT_SERVICE_NAME, key);
      if (encoded === null) return null;
      return Buffer.from(encoded, "base64");
    },

    async delete(key: string): Promise<boolean> {
      return keytar.deletePassword(VAULT_SERVICE_NAME, key);
    },

    async exists(key: string): Promise<boolean> {
      const value = await keytar.getPassword(VAULT_SERVICE_NAME, key);
      return value !== null;
    },

    async list(): Promise<string[]> {
      const credentials = await keytar.findCredentials(VAULT_SERVICE_NAME);
      return credentials.map((c: { account: string }) => c.account);
    },
  };
}

/**
 * Create Windows Credential Manager vault.
 *
 * Uses the keytar library which wraps Windows Credential Manager.
 */
async function createCredentialManagerVault(): Promise<SecureVault> {
  // Same implementation as keychain - keytar handles Windows Credential Manager
  return createKeychainVault();
}

/**
 * Create Linux Secret Service vault.
 *
 * Uses the keytar library which wraps libsecret.
 */
async function createSecretServiceVault(): Promise<SecureVault> {
  // Same implementation as keychain - keytar handles Secret Service
  return createKeychainVault();
}

/**
 * Create AES-256-GCM encrypted file vault.
 *
 * This is the fallback when platform-specific keychains are not available.
 */
async function createAesFallbackVault(vaultPath?: string, password?: string): Promise<SecureVault> {
  const { AesFallbackVault } = await import("./aes-fallback.js");
  return new AesFallbackVault(vaultPath, password);
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
