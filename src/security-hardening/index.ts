/**
 * DilloBot Security Hardening Module
 *
 * This module provides security enhancements for OpenClaw:
 * - Encrypted credential vault (AES-256-GCM with machine-derived key)
 * - Prompt injection detection and filtering
 * - LLM-based skill inspection before installation
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
export { createVault, VAULT_KEY_PREFIXES, buildVaultKey } from "./vault/vault.js";
export {
  migrateToSecureVault,
  isMigrationCompleted,
  hasPlaintextCredentials,
  getMigrationStatus,
} from "./vault/migration.js";

// Vault manager (main entry point for credential storage)
export {
  getVault,
  getVaultBackend,
  storeCredential,
  retrieveCredential,
  deleteCredential,
  hasCredential,
  listCredentials,
  listAllCredentials,
  storeAuthProfiles,
  retrieveAuthProfiles,
  storeDeviceIdentity,
  retrieveDeviceIdentity,
  storeDeviceAuth,
  retrieveDeviceAuth,
  resetVaultInstance,
  type VaultKeyPrefix,
  // DILLOBOT: Channel credential helpers
  storeTelegramToken,
  retrieveTelegramToken,
  deleteTelegramToken,
  storeDiscordToken,
  retrieveDiscordToken,
  deleteDiscordToken,
  storeSlackTokens,
  retrieveSlackTokens,
  deleteSlackTokens,
  storeWhatsAppCreds,
  retrieveWhatsAppCreds,
  deleteWhatsAppCreds,
  storeChannelCreds,
  retrieveChannelCreds,
  deleteChannelCreds,
  type VaultTelegramToken,
  type VaultDiscordToken,
  type VaultSlackTokens,
  type VaultWhatsAppCreds,
  type VaultChannelCreds,
} from "./vault/vault-manager.js";

// Injection protection - Quick pre-filter
export {
  scanForInjection,
  sanitizeInjectionPatterns,
  stripDangerousUnicode,
  escapeForPrompt,
  getDefaultInjectionConfig,
  getPatternDetails,
} from "./injection/injection-filter.js";

// Injection protection - LLM-based semantic analysis
export {
  analyzeForInjection,
  buildInjectionAnalysisPrompt,
  formatAnalysisResults,
  canSkipAnalysis,
  DEFAULT_ANALYSIS_CONFIG,
  type InjectionAnalysisResult,
  type InjectionLLMProvider,
  type InjectionAnalysisConfig,
} from "./injection/injection-analyzer.js";

// Injection protection - Source classification
export {
  classifySource,
  getTrustLevel,
  requiresLLMAnalysis,
  requiresWrapping,
  getSourceClassification,
  isExternalSource,
  type ContentSource,
  type TrustLevel,
  type SourceClassification,
} from "./injection/source-classifier.js";

// Output filtering
export { filterOutput, getDefaultOutputConfig } from "./injection/output-filter.js";

// Audit logging
export {
  logInjectionAttempt,
  logOutputFiltered,
  emitSecurityAuditEvent,
} from "./injection/injection-audit.js";

// Content security (unified entry point)
export {
  processContentSecurity,
  shouldBlockImmediately,
  createLLMProvider,
  DEFAULT_CONTENT_SECURITY_CONFIG,
  type ContentSecurityResult,
  type ContentSecurityConfig,
  type ContentSecurityContext,
} from "./injection/content-security.js";

// Security gate (LLM-based out-of-band analysis)
export {
  runSecurityGate,
  shouldBlockQuickly,
  type SecurityGateResult,
  type SecurityGateConfig,
} from "./injection/security-gate.js";

// LLM security provider
export {
  isClaudeAgentSdkProvider,
  createClaudeCliSecurityProvider,
  createAnthropicSecurityProvider,
  createOpenAICompatibleSecurityProvider,
  resolveSecurityLLMProvider,
} from "./injection/llm-security-provider.js";

// Skill inspection (LLM-based)
export {
  verifySkillForInstallation,
  clearVerificationCache,
  trustSkill,
  untrustSkill,
  inspectSkill,
  quickSecurityCheck,
  formatInspectionResults,
  DEFAULT_VERIFICATION_CONFIG,
  type SkillVerificationResult,
  type SkillVerificationConfig,
  type SkillInstallDecision,
  type InspectionLLMProvider,
} from "./skills/skill-verification.js";

// Challenge-response auth
export { generateChallenge, verifyChallenge } from "./auth/challenge-response.js";
