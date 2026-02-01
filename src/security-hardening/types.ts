/**
 * DilloBot Security Hardening - Shared Types
 *
 * This module provides type definitions for the security hardening features.
 */

// =============================================================================
// Vault Types
// =============================================================================

export type VaultBackend =
  | "keychain"
  | "credential-manager"
  | "secret-service"
  | "aes-fallback"
  | "auto";

export interface SecureVault {
  /** Store a credential with automatic encryption */
  store(key: string, value: Buffer): Promise<void>;

  /** Retrieve and decrypt a credential */
  retrieve(key: string): Promise<Buffer | null>;

  /** Securely delete a credential (zero-fill before removal) */
  delete(key: string): Promise<boolean>;

  /** Check if a credential exists */
  exists(key: string): Promise<boolean>;

  /** List all stored credential keys */
  list(): Promise<string[]>;

  /** Rotate encryption keys (for AES fallback) */
  rotateKeys?(): Promise<void>;

  /** Get the backend type */
  readonly backend: VaultBackend;
}

export interface VaultMigrationResult {
  migrated: string[];
  failed: Array<{ key: string; error: string }>;
  skipped: string[];
}

// =============================================================================
// Injection Detection Types
// =============================================================================

export type InjectionSeverity = "none" | "low" | "medium" | "high" | "critical";

export type InjectionScanResult = {
  detected: boolean;
  severity: InjectionSeverity;
  patterns: string[];
  score: number;
  shouldBlock: boolean;
  shouldSanitize: boolean;
};

export type InjectionFilterMode = "warn" | "sanitize" | "block";

export interface InjectionFilterConfig {
  enabled: boolean;
  mode: InjectionFilterMode;
  customPatterns?: RegExp[];
  whitelist?: string[]; // Session keys or sender IDs exempt from filtering
  thresholds: {
    warn: number;
    sanitize: number;
    block: number;
  };
  logAttempts: boolean;
}

export interface OutputFilterConfig {
  enabled: boolean;
  patterns: {
    systemPromptLeaks: boolean;
    configLeaks: boolean;
    tokenLeaks: boolean;
  };
}

export interface OutputFilterResult {
  filtered: boolean;
  original: string;
  sanitized: string;
  redactedPatterns: string[];
}

// =============================================================================
// LLM-Based Injection Analysis Types
// =============================================================================

/**
 * Categories of injection attacks detected by LLM analysis.
 */
export type InjectionCategory =
  | "instruction_override" // Attempts to ignore/forget system instructions
  | "role_manipulation" // Attempts to change AI persona or claim permissions
  | "context_escape" // Fake system messages, delimiter abuse
  | "data_exfiltration" // Instructions to send data to external endpoints
  | "hidden_instruction" // Instructions in HTML, encoding, invisible text
  | "social_engineering" // False claims of authority or urgency
  | "other";

/**
 * Intent classification for content.
 */
export type InjectionIntent = "legitimate" | "suspicious" | "malicious";

/**
 * Content source types for trust classification.
 */
export type ContentSource =
  | "user_direct" // Direct CLI/UI input
  | "email" // Email content
  | "webhook" // External webhooks
  | "api" // External API calls
  | "web_content" // Fetched web pages
  | "file_content" // File content
  | "skill" // Skill prompts
  | "unknown";

/**
 * Trust levels for content sources.
 */
export type TrustLevel = "high" | "medium" | "low";

/**
 * Result of LLM-based injection analysis.
 */
export interface InjectionAnalysisResult {
  /** Whether the content passed analysis */
  safe: boolean;
  /** Overall risk level */
  riskLevel: InjectionSeverity;
  /** Assessed intent of the content */
  intent: InjectionIntent;
  /** Category of injection if detected */
  category?: InjectionCategory;
  /** Human-readable explanation */
  explanation: string;
  /** Whether content should be blocked */
  shouldBlock: boolean;
  /** Whether a warning should be shown */
  shouldWarn: boolean;
  /** Raw LLM response for debugging */
  rawResponse?: string;
}

/**
 * Configuration for LLM-based injection analysis.
 */
export interface InjectionAnalysisConfig {
  /** Enable LLM-based analysis */
  enabled: boolean;
  /** Analyze all sources vs only low-trust */
  analyzeAllSources: boolean;
  /** Risk level threshold for blocking */
  blockThreshold: InjectionSeverity;
  /** Risk level threshold for warnings */
  warnThreshold: InjectionSeverity;
  /** Maximum content length to analyze */
  maxContentLength: number;
}

// =============================================================================
// Skill Verification Types (LLM-Based Inspection)
// =============================================================================

export type SkillRiskLevel = "none" | "low" | "medium" | "high" | "critical";

export type SkillFindingType =
  | "prompt_injection"
  | "data_exfiltration"
  | "privilege_escalation"
  | "obfuscated_code"
  | "external_communication"
  | "file_system_access"
  | "credential_access"
  | "system_command"
  | "suspicious_pattern"
  | "other";

export interface SkillSecurityFinding {
  type: SkillFindingType;
  severity: SkillRiskLevel;
  description: string;
  snippet?: string;
  line?: number;
}

export interface SkillInspectionResult {
  safe: boolean;
  riskLevel: SkillRiskLevel;
  findings: SkillSecurityFinding[];
  summary: string;
  bypassAllowed: boolean;
}

export interface SkillVerificationConfig {
  /** Enable LLM-based skill inspection */
  enabled: boolean;
  /** Trust bundled skills without inspection */
  trustBundledSkills: boolean;
  /** Skills to always trust (by name) */
  trustedSkills: string[];
  /** Only run quick pattern check, skip LLM analysis */
  quickCheckOnly: boolean;
}

// =============================================================================
// Security Policy Types
// =============================================================================

export interface ConnectionPolicyConfig {
  /** Require challenge-response for all connections including local */
  requireChallengeForLocal: boolean;
  /** Allow auto-approve for loopback connections (HARDENED: false) */
  allowLocalAutoApprove: boolean;
  /** Maximum pairing requests per hour per device */
  maxPairingRequestsPerHour: number;
}

export interface CredentialPolicyConfig {
  /** Preferred vault backend */
  vaultBackend: VaultBackend;
  /** Allow plaintext credential storage (HARDENED: false) */
  allowPlaintextFallback: boolean;
  /** PBKDF2 iterations for key derivation */
  keyDerivationIterations: number;
}

export interface SkillPolicyConfig {
  /** Enable LLM-based skill inspection before installation */
  inspectBeforeInstall: boolean;
  /** Trust bundled skills without inspection */
  trustBundledSkills: boolean;
  /** Skills to always trust (by name) */
  trustedSkills: string[];
  /** Only run quick pattern check, skip full LLM analysis */
  quickCheckOnly: boolean;
  /** Block skills with critical findings (no bypass allowed) */
  blockCritical: boolean;
}

export interface MemoryPolicyConfig {
  /** Use mlock'd secure buffers for sensitive data */
  useSecureBuffers: boolean;
  /** Zero memory before freeing */
  zeroOnFree: boolean;
}

export interface SecurityPolicyConfig {
  connections: ConnectionPolicyConfig;
  credentials: CredentialPolicyConfig;
  skills: SkillPolicyConfig;
  memory: MemoryPolicyConfig;
  injection: InjectionFilterConfig;
  output: OutputFilterConfig;
}

// =============================================================================
// Audit Types
// =============================================================================

export type SecurityAuditEventType =
  | "injection_detected"
  | "injection_blocked"
  | "injection_sanitized"
  | "output_filtered"
  | "skill_verification_failed"
  | "policy_violation"
  | "vault_access"
  | "pairing_attempt";

export interface SecurityAuditEvent {
  timestamp: number;
  eventType: SecurityAuditEventType;
  severity: InjectionSeverity;
  sessionKey?: string;
  senderId?: string;
  channel?: string;
  details: Record<string, unknown>;
  contentHash?: string; // SHA256 of content (not content itself for privacy)
}

// =============================================================================
// Challenge-Response Types
// =============================================================================

export interface ChallengePayload {
  nonce: string; // 32-byte random, base64url
  timestamp: number; // Unix ms
  serverIdentity: string; // Server's public key fingerprint
}

export interface ChallengeResponse {
  challenge: ChallengePayload;
  deviceSignature: string; // Ed25519 signature of challenge
  devicePublicKey: string; // base64url encoded
}

export interface AuthResult {
  ok: boolean;
  reason?: string;
  deviceId?: string;
}
