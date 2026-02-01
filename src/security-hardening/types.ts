/**
 * DilloBot Security Hardening - Shared Types
 *
 * This module provides type definitions for the security hardening features.
 */

// =============================================================================
// Vault Types
// =============================================================================

export type VaultBackend = "keychain" | "credential-manager" | "secret-service" | "aes-fallback" | "auto";

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
// Skill Verification Types
// =============================================================================

export interface SkillChecksum {
  skillKey: string;
  sha256: string;
  pgpSignature?: string;
  signedBy?: string;
  verifiedAt?: number;
}

export type SkillVerificationReason =
  | "checksum_mismatch"
  | "signature_invalid"
  | "key_untrusted"
  | "not_found"
  | "file_read_error";

export interface SkillVerificationResult {
  valid: boolean;
  reason?: SkillVerificationReason;
  expected?: string;
  actual?: string;
  warnings?: string[];
}

export interface SkillVerificationConfig {
  requireVerification: boolean;
  requireChecksum: boolean;
  requireSignature: boolean;
  trustedSigners: string[];
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
  /** Require SHA256 verification for skills */
  requireVerification: boolean;
  /** Require checksum for all skills (vs just verify if present) */
  requireChecksum: boolean;
  /** Require PGP signature for skills */
  requireSignature: boolean;
  /** Trusted PGP key fingerprints */
  trustedSigners: string[];
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
