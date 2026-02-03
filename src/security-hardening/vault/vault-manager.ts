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
 * Lazily initializes the vault on first access. Uses OS keychain when available,
 * falls back to AES-256-GCM encrypted file with machine-derived key.
 */
export async function getVault(): Promise<SecureVault> {
  if (vaultInstance) {
    return vaultInstance;
  }

  if (initPromise) {
    return initPromise;
  }

  initPromise = createVault("auto").then((vault) => {
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
