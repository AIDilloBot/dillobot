/**
 * DilloBot Security Configuration Types
 *
 * Extends OpenClaw configuration with security hardening options.
 */

/**
 * Vault backend options.
 */
export type SecurityVaultBackend =
  | "auto"
  | "keychain"
  | "credential-manager"
  | "secret-service"
  | "aes-fallback";

/**
 * Injection filter mode.
 */
export type SecurityInjectionMode = "warn" | "sanitize" | "block";

/**
 * Vault configuration.
 */
export type SecurityVaultConfig = {
  /** Preferred vault backend ("auto" to detect based on platform) */
  backend?: SecurityVaultBackend;
  /** Path to AES vault file (only used with aes-fallback backend) */
  aesVaultPath?: string;
};

/**
 * Injection protection configuration.
 */
export type SecurityInjectionConfig = {
  /** Enable injection protection */
  enabled?: boolean;
  /** How to handle detected injections */
  mode?: SecurityInjectionMode;
  /** Score threshold for warning (0-100) */
  warnThreshold?: number;
  /** Score threshold for sanitization (0-100) */
  sanitizeThreshold?: number;
  /** Score threshold for blocking (0-100) */
  blockThreshold?: number;
  /** Log injection attempts */
  logAttempts?: boolean;
};

/**
 * Output filter configuration.
 */
export type SecurityOutputConfig = {
  /** Enable output filtering */
  enabled?: boolean;
  /** Filter system prompt leaks */
  filterSystemPromptLeaks?: boolean;
  /** Filter config/credential leaks */
  filterConfigLeaks?: boolean;
  /** Filter token/API key leaks */
  filterTokenLeaks?: boolean;
};

/**
 * Skill verification configuration.
 */
export type SecuritySkillsConfig = {
  /** Require checksum verification for skills */
  requireVerification?: boolean;
  /** Require checksum to be present (vs just verify if present) */
  requireChecksum?: boolean;
  /** Require PGP signature for skills */
  requireSignature?: boolean;
  /** Trusted PGP key fingerprints */
  trustedSigners?: string[];
};

/**
 * Connection security configuration.
 */
export type SecurityConnectionConfig = {
  /** Require challenge-response for local connections (always true in DilloBot) */
  requireChallengeForLocal?: boolean;
  /** Maximum pairing requests per hour per device */
  maxPairingRequestsPerHour?: number;
};

/**
 * LLM-based security analysis configuration.
 */
export type SecurityLLMAnalysisConfig = {
  /** Enable LLM-based security analysis for low-trust content */
  enabled?: boolean;
  /** Risk level threshold for blocking ("high" or "critical") */
  blockThreshold?: "medium" | "high" | "critical";
  /** Risk level threshold for warning */
  warnThreshold?: "low" | "medium" | "high";
};

/**
 * Complete security configuration.
 */
export type SecurityConfig = {
  /** Vault configuration */
  vault?: SecurityVaultConfig;
  /** Injection protection configuration */
  injection?: SecurityInjectionConfig;
  /** Output filtering configuration */
  output?: SecurityOutputConfig;
  /** Skill verification configuration */
  skills?: SecuritySkillsConfig;
  /** Connection security configuration */
  connections?: SecurityConnectionConfig;
  /** LLM-based security analysis configuration */
  llmAnalysis?: SecurityLLMAnalysisConfig;
};

/**
 * Default security configuration (hardened).
 */
export const DEFAULT_SECURITY_CONFIG: SecurityConfig = {
  vault: {
    backend: "auto",
  },
  injection: {
    enabled: true,
    mode: "sanitize",
    warnThreshold: 20,
    sanitizeThreshold: 50,
    blockThreshold: 80,
    logAttempts: true,
  },
  output: {
    enabled: true,
    filterSystemPromptLeaks: true,
    filterConfigLeaks: true,
    filterTokenLeaks: true,
  },
  skills: {
    requireVerification: true,
    requireChecksum: false,
    requireSignature: false,
    trustedSigners: [],
  },
  connections: {
    requireChallengeForLocal: true,
    maxPairingRequestsPerHour: 10,
  },
  llmAnalysis: {
    enabled: true,
    blockThreshold: "high",
    warnThreshold: "medium",
  },
};
