/**
 * DilloBot Security Hardening Module
 *
 * This module provides security enhancements for OpenClaw:
 * - Encrypted credential vault (OS keychain + AES fallback)
 * - Prompt injection detection and filtering
 * - Skill verification with checksums and signatures
 * - Security policy enforcement
 * - Mandatory challenge-response authentication
 *
 * All security features are isolated in this module to minimize
 * merge conflicts when rebasing from upstream OpenClaw.
 */

// Types
export * from "./types.js";

// Policy enforcement
export { enforceSecurityPolicy, getHardenedDefaults } from "./policy/security-policy.js";
export { getSecurityPolicyConfig } from "./policy/policy-config.js";

// Credential vault
export { createVault, getDefaultVaultBackend } from "./vault/vault.js";
export { migrateToSecureVault } from "./vault/migration.js";

// Injection protection
export {
  scanForInjection,
  sanitizeInjectionPatterns,
  escapeForPrompt,
  getDefaultInjectionConfig,
} from "./injection/injection-filter.js";
export { filterOutput, getDefaultOutputConfig } from "./injection/output-filter.js";
export { logInjectionAttempt, logOutputFiltered, emitSecurityAuditEvent } from "./injection/injection-audit.js";

// Skill verification
export { verifySkill, computeSkillChecksum } from "./skills/skill-verification.js";
export { loadChecksumStore, saveChecksumStore } from "./skills/checksum-store.js";

// Challenge-response auth
export { generateChallenge, verifyChallenge } from "./auth/challenge-response.js";
