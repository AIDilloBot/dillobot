/**
 * DilloBot Skill Checksum Store
 *
 * Manages the database of known-good skill checksums.
 */

import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import type { SkillChecksum } from "../types.js";

/**
 * Checksum store file format.
 */
interface ChecksumStoreFile {
  version: 1;
  skills: Record<string, SkillChecksum>;
  trustedPgpKeys: string[];
  lastUpdated: string;
}

/**
 * Default checksum store path.
 */
const DEFAULT_STORE_PATH = path.join(os.homedir(), ".openclaw", "security", "skill-checksums.json");

/**
 * In-memory cache of the checksum store.
 */
let cachedStore: ChecksumStoreFile | null = null;
let cacheStorePath: string | null = null;

/**
 * Load the checksum store from disk.
 *
 * @param storePath Optional custom store path
 * @returns The checksum store
 */
export async function loadChecksumStore(storePath?: string): Promise<ChecksumStoreFile> {
  const effectivePath = storePath ?? DEFAULT_STORE_PATH;

  // Use cache if available and path matches
  if (cachedStore && cacheStorePath === effectivePath) {
    return cachedStore;
  }

  try {
    const content = await fs.readFile(effectivePath, "utf-8");
    cachedStore = JSON.parse(content) as ChecksumStoreFile;
    cacheStorePath = effectivePath;
    return cachedStore;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      // Create empty store
      const emptyStore: ChecksumStoreFile = {
        version: 1,
        skills: {},
        trustedPgpKeys: [],
        lastUpdated: new Date().toISOString(),
      };
      cachedStore = emptyStore;
      cacheStorePath = effectivePath;
      return emptyStore;
    }
    throw error;
  }
}

/**
 * Save the checksum store to disk.
 *
 * @param store The store to save
 * @param storePath Optional custom store path
 */
export async function saveChecksumStore(store: ChecksumStoreFile, storePath?: string): Promise<void> {
  const effectivePath = storePath ?? DEFAULT_STORE_PATH;

  // Ensure directory exists
  const dir = path.dirname(effectivePath);
  await fs.mkdir(dir, { recursive: true, mode: 0o700 });

  // Update last modified
  store.lastUpdated = new Date().toISOString();

  // Write atomically
  const tempPath = `${effectivePath}.tmp`;
  await fs.writeFile(tempPath, JSON.stringify(store, null, 2), { mode: 0o600 });
  await fs.rename(tempPath, effectivePath);

  // Update cache
  cachedStore = store;
  cacheStorePath = effectivePath;
}

/**
 * Get the expected checksum for a skill.
 *
 * @param skillKey The skill identifier
 * @param storePath Optional custom store path
 * @returns The expected checksum, or null if not found
 */
export async function getSkillChecksum(skillKey: string, storePath?: string): Promise<SkillChecksum | null> {
  const store = await loadChecksumStore(storePath);
  return store.skills[skillKey] ?? null;
}

/**
 * Set the expected checksum for a skill.
 *
 * @param checksum The checksum to store
 * @param storePath Optional custom store path
 */
export async function setSkillChecksum(checksum: SkillChecksum, storePath?: string): Promise<void> {
  const store = await loadChecksumStore(storePath);
  store.skills[checksum.skillKey] = checksum;
  await saveChecksumStore(store, storePath);
}

/**
 * Remove a skill from the checksum store.
 *
 * @param skillKey The skill identifier
 * @param storePath Optional custom store path
 * @returns true if the skill was removed
 */
export async function removeSkillChecksum(skillKey: string, storePath?: string): Promise<boolean> {
  const store = await loadChecksumStore(storePath);

  if (!(skillKey in store.skills)) {
    return false;
  }

  delete store.skills[skillKey];
  await saveChecksumStore(store, storePath);
  return true;
}

/**
 * List all skills in the checksum store.
 *
 * @param storePath Optional custom store path
 * @returns Array of skill keys
 */
export async function listSkillChecksums(storePath?: string): Promise<string[]> {
  const store = await loadChecksumStore(storePath);
  return Object.keys(store.skills);
}

/**
 * Add a trusted PGP key to the store.
 *
 * @param armoredKey The armored PGP public key
 * @param storePath Optional custom store path
 */
export async function addTrustedPgpKey(armoredKey: string, storePath?: string): Promise<void> {
  const store = await loadChecksumStore(storePath);

  // Avoid duplicates
  if (!store.trustedPgpKeys.includes(armoredKey)) {
    store.trustedPgpKeys.push(armoredKey);
    await saveChecksumStore(store, storePath);
  }
}

/**
 * Remove a trusted PGP key from the store.
 *
 * @param armoredKey The armored PGP public key
 * @param storePath Optional custom store path
 * @returns true if the key was removed
 */
export async function removeTrustedPgpKey(armoredKey: string, storePath?: string): Promise<boolean> {
  const store = await loadChecksumStore(storePath);
  const index = store.trustedPgpKeys.indexOf(armoredKey);

  if (index < 0) {
    return false;
  }

  store.trustedPgpKeys.splice(index, 1);
  await saveChecksumStore(store, storePath);
  return true;
}

/**
 * Get all trusted PGP keys.
 *
 * @param storePath Optional custom store path
 * @returns Array of armored PGP public keys
 */
export async function getTrustedPgpKeys(storePath?: string): Promise<string[]> {
  const store = await loadChecksumStore(storePath);
  return [...store.trustedPgpKeys];
}

/**
 * Clear the in-memory cache.
 * Useful for testing or when the store file has been modified externally.
 */
export function clearChecksumCache(): void {
  cachedStore = null;
  cacheStorePath = null;
}

/**
 * Bulk update checksums for multiple skills.
 *
 * @param checksums Array of checksums to store
 * @param storePath Optional custom store path
 */
export async function bulkUpdateChecksums(checksums: SkillChecksum[], storePath?: string): Promise<void> {
  const store = await loadChecksumStore(storePath);

  for (const checksum of checksums) {
    store.skills[checksum.skillKey] = checksum;
  }

  await saveChecksumStore(store, storePath);
}

/**
 * Get store metadata.
 *
 * @param storePath Optional custom store path
 */
export async function getStoreMetadata(
  storePath?: string,
): Promise<{
  skillCount: number;
  trustedKeyCount: number;
  lastUpdated: string;
}> {
  const store = await loadChecksumStore(storePath);

  return {
    skillCount: Object.keys(store.skills).length,
    trustedKeyCount: store.trustedPgpKeys.length,
    lastUpdated: store.lastUpdated,
  };
}
