/**
 * DilloBot Security Policy Configuration
 *
 * Provides default security policy configuration and utilities
 * for merging user config with hardened defaults.
 */

import type {
  ConnectionPolicyConfig,
  CredentialPolicyConfig,
  InjectionFilterConfig,
  MemoryPolicyConfig,
  OutputFilterConfig,
  SecurityPolicyConfig,
  SkillPolicyConfig,
} from "../types.js";
import { getHardenedDefaults } from "./security-policy.js";

/**
 * Default connection policy configuration.
 */
const DEFAULT_CONNECTION_POLICY: ConnectionPolicyConfig = {
  requireChallengeForLocal: true,
  allowLocalAutoApprove: true, // Allow local loopback to self-approve
  maxPairingRequestsPerHour: 10,
};

/**
 * Default credential policy configuration.
 */
const DEFAULT_CREDENTIAL_POLICY: CredentialPolicyConfig = {
  vaultBackend: "aes-fallback",
  allowPlaintextFallback: false,
  keyDerivationIterations: 310000,
};

/**
 * Default skill policy configuration.
 */
const DEFAULT_SKILL_POLICY: SkillPolicyConfig = {
  inspectBeforeInstall: true,
  trustBundledSkills: true,
  trustedSkills: [],
  quickCheckOnly: false,
  blockCritical: true,
};

/**
 * Default memory policy configuration.
 */
const DEFAULT_MEMORY_POLICY: MemoryPolicyConfig = {
  useSecureBuffers: true,
  zeroOnFree: true,
};

/**
 * Default injection filter configuration.
 */
const DEFAULT_INJECTION_POLICY: InjectionFilterConfig = {
  enabled: true,
  mode: "sanitize",
  thresholds: {
    warn: 20,
    sanitize: 50,
    block: 80,
  },
  logAttempts: true,
};

/**
 * Default output filter configuration.
 */
const DEFAULT_OUTPUT_POLICY: OutputFilterConfig = {
  enabled: true,
  patterns: {
    systemPromptLeaks: true,
    configLeaks: true,
    tokenLeaks: true,
  },
};

/**
 * Complete default security policy.
 */
const DEFAULT_SECURITY_POLICY: SecurityPolicyConfig = {
  connections: DEFAULT_CONNECTION_POLICY,
  credentials: DEFAULT_CREDENTIAL_POLICY,
  skills: DEFAULT_SKILL_POLICY,
  memory: DEFAULT_MEMORY_POLICY,
  injection: DEFAULT_INJECTION_POLICY,
  output: DEFAULT_OUTPUT_POLICY,
};

/**
 * Get the default security policy configuration.
 */
export function getDefaultSecurityPolicy(): SecurityPolicyConfig {
  return structuredClone(DEFAULT_SECURITY_POLICY);
}

/**
 * Merge user security config with defaults and hardened values.
 *
 * Priority (highest to lowest):
 * 1. Hardened defaults (cannot be overridden)
 * 2. User config
 * 3. Default values
 */
export function getSecurityPolicyConfig(
  userConfig?: Partial<SecurityPolicyConfig>,
): SecurityPolicyConfig {
  const defaults = getDefaultSecurityPolicy();
  const hardened = getHardenedDefaults();

  // Start with defaults
  const result = structuredClone(defaults);

  // Apply user config (if provided)
  if (userConfig) {
    if (userConfig.connections) {
      Object.assign(result.connections, userConfig.connections);
    }
    if (userConfig.credentials) {
      Object.assign(result.credentials, userConfig.credentials);
    }
    if (userConfig.skills) {
      Object.assign(result.skills, userConfig.skills);
    }
    if (userConfig.memory) {
      Object.assign(result.memory, userConfig.memory);
    }
    if (userConfig.injection) {
      Object.assign(result.injection, userConfig.injection);
    }
    if (userConfig.output) {
      Object.assign(result.output, userConfig.output);
    }
  }

  // Apply hardened defaults (override any user config that conflicts)
  if (hardened.connections) {
    Object.assign(result.connections, hardened.connections);
  }
  if (hardened.credentials) {
    Object.assign(result.credentials, hardened.credentials);
  }

  return result;
}

/**
 * Export individual default getters for convenience.
 */
export function getDefaultConnectionPolicy(): ConnectionPolicyConfig {
  return structuredClone(DEFAULT_CONNECTION_POLICY);
}

export function getDefaultCredentialPolicy(): CredentialPolicyConfig {
  return structuredClone(DEFAULT_CREDENTIAL_POLICY);
}

export function getDefaultSkillPolicy(): SkillPolicyConfig {
  return structuredClone(DEFAULT_SKILL_POLICY);
}

export function getDefaultMemoryPolicy(): MemoryPolicyConfig {
  return structuredClone(DEFAULT_MEMORY_POLICY);
}

export function getDefaultInjectionPolicy(): InjectionFilterConfig {
  return structuredClone(DEFAULT_INJECTION_POLICY);
}

export function getDefaultOutputPolicy(): OutputFilterConfig {
  return structuredClone(DEFAULT_OUTPUT_POLICY);
}
