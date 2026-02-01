/**
 * DilloBot Skill Verification
 *
 * Provides SHA256 checksum and optional PGP signature verification
 * for skill integrity.
 */

import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import type { SkillChecksum, SkillVerificationResult } from "../types.js";
import { logSkillVerificationFailed } from "../injection/injection-audit.js";

/**
 * Compute SHA256 checksum of a skill directory or file.
 *
 * For directories, this computes a hash of all file contents
 * in a deterministic order.
 *
 * @param skillPath Path to skill file or directory
 * @returns SHA256 checksum as hex string
 */
export async function computeSkillChecksum(skillPath: string): Promise<string> {
  const stat = await fs.stat(skillPath);

  if (stat.isFile()) {
    // Single file - hash its contents
    const content = await fs.readFile(skillPath);
    return crypto.createHash("sha256").update(content).digest("hex");
  }

  if (stat.isDirectory()) {
    // Directory - hash all files in sorted order
    return computeDirectoryChecksum(skillPath);
  }

  throw new Error(`Invalid skill path: ${skillPath}`);
}

/**
 * Compute checksum for a directory.
 */
async function computeDirectoryChecksum(dirPath: string): Promise<string> {
  const hash = crypto.createHash("sha256");

  // Get all files recursively, sorted
  const files = await getAllFiles(dirPath);
  files.sort();

  for (const file of files) {
    // Include relative path in hash for structural integrity
    const relativePath = path.relative(dirPath, file);
    hash.update(relativePath);

    // Include file contents
    const content = await fs.readFile(file);
    hash.update(content);
  }

  return hash.digest("hex");
}

/**
 * Get all files in a directory recursively.
 */
async function getAllFiles(dirPath: string): Promise<string[]> {
  const files: string[] = [];
  const entries = await fs.readdir(dirPath, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = path.join(dirPath, entry.name);

    if (entry.isDirectory()) {
      // Skip hidden directories and node_modules
      if (!entry.name.startsWith(".") && entry.name !== "node_modules") {
        files.push(...(await getAllFiles(fullPath)));
      }
    } else if (entry.isFile()) {
      // Skip hidden files
      if (!entry.name.startsWith(".")) {
        files.push(fullPath);
      }
    }
  }

  return files;
}

/**
 * Verify a skill against its expected checksum.
 *
 * @param skillPath Path to skill file or directory
 * @param expected Expected checksum information
 * @returns Verification result
 */
export async function verifySkill(skillPath: string, expected: SkillChecksum): Promise<SkillVerificationResult> {
  try {
    // Check if skill exists
    try {
      await fs.access(skillPath);
    } catch {
      logSkillVerificationFailed({
        skillKey: expected.skillKey,
        reason: "not_found",
      });
      return {
        valid: false,
        reason: "not_found",
      };
    }

    // Compute actual checksum
    const actual = await computeSkillChecksum(skillPath);

    // Compare checksums
    if (actual !== expected.sha256) {
      logSkillVerificationFailed({
        skillKey: expected.skillKey,
        reason: "checksum_mismatch",
        expected: expected.sha256,
        actual,
      });
      return {
        valid: false,
        reason: "checksum_mismatch",
        expected: expected.sha256,
        actual,
      };
    }

    // If signature is provided, verify it
    if (expected.pgpSignature) {
      const signatureValid = await verifyPgpSignature(skillPath, expected.pgpSignature, expected.signedBy);

      if (!signatureValid) {
        logSkillVerificationFailed({
          skillKey: expected.skillKey,
          reason: "signature_invalid",
        });
        return {
          valid: false,
          reason: "signature_invalid",
        };
      }
    }

    // All checks passed
    return {
      valid: true,
      warnings: expected.pgpSignature ? [] : ["Skill has no PGP signature"],
    };
  } catch (error) {
    logSkillVerificationFailed({
      skillKey: expected.skillKey,
      reason: "file_read_error",
      actual: (error as Error).message,
    });
    return {
      valid: false,
      reason: "file_read_error",
    };
  }
}

/**
 * Verify PGP signature of a skill.
 *
 * Note: Full PGP implementation would require a library like openpgp.
 * This is a placeholder that logs a warning.
 *
 * @param skillPath Path to skill
 * @param signature Detached PGP signature (armored)
 * @param signedBy Expected signer key fingerprint
 * @returns true if signature is valid
 */
async function verifyPgpSignature(skillPath: string, signature: string, signedBy?: string): Promise<boolean> {
  // TODO: Implement full PGP verification with openpgp library
  console.warn("[DilloBot Skills] PGP signature verification not yet implemented");
  console.warn(`[DilloBot Skills] Would verify signature by: ${signedBy ?? "unknown"}`);

  // For now, log and return true to not block skills
  // In production, this should properly verify signatures
  return true;
}

/**
 * Generate a skill manifest with checksum.
 *
 * This can be used to create the expected checksum for a skill.
 *
 * @param skillPath Path to skill
 * @param skillKey Skill identifier
 * @returns Checksum manifest
 */
export async function generateSkillManifest(skillPath: string, skillKey: string): Promise<SkillChecksum> {
  const sha256 = await computeSkillChecksum(skillPath);

  return {
    skillKey,
    sha256,
    verifiedAt: Date.now(),
  };
}

/**
 * Verify multiple skills in parallel.
 *
 * @param skills Array of [skillPath, expected] tuples
 * @returns Map of skill key to verification result
 */
export async function verifySkills(
  skills: Array<[string, SkillChecksum]>,
): Promise<Map<string, SkillVerificationResult>> {
  const results = new Map<string, SkillVerificationResult>();

  const verifications = skills.map(async ([skillPath, expected]) => {
    const result = await verifySkill(skillPath, expected);
    return [expected.skillKey, result] as const;
  });

  const settled = await Promise.allSettled(verifications);

  for (const outcome of settled) {
    if (outcome.status === "fulfilled") {
      const [key, result] = outcome.value;
      results.set(key, result);
    }
  }

  return results;
}
