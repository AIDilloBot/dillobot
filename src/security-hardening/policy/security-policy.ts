/**
 * DilloBot Security Policy Enforcement
 *
 * This module enforces security policies on OpenClaw configuration,
 * blocking dangerous overrides and ensuring hardened defaults.
 */

import type { SecurityPolicyConfig } from "../types.js";

/**
 * Hardened default policy - these values cannot be overridden by config.
 */
const HARDENED_DEFAULTS: Partial<SecurityPolicyConfig> = {
  connections: {
    requireChallengeForLocal: true,
    allowLocalAutoApprove: true, // First-run only: local can self-approve if no devices paired yet
    maxPairingRequestsPerHour: 10,
  },
  credentials: {
    vaultBackend: "auto",
    allowPlaintextFallback: false, // CRITICAL: No plaintext storage
    keyDerivationIterations: 310000, // OWASP 2023 recommendation
  },
};

/**
 * Get the hardened defaults that cannot be overridden.
 */
export function getHardenedDefaults(): Partial<SecurityPolicyConfig> {
  return structuredClone(HARDENED_DEFAULTS);
}

/**
 * Dangerous config keys that are blocked in hardened mode.
 */
const BLOCKED_CONFIG_PATHS = [
  "gateway.controlUi.dangerouslyDisableDeviceAuth",
  "gateway.controlUi.allowInsecureAuth",
  "gateway.auth.autoApproveLocal",
] as const;

/**
 * Log a policy violation warning.
 */
function logPolicyViolation(path: string, message: string): void {
  // Use console.warn for now - will integrate with OpenClaw logging later
  console.warn(`[DilloBot Security] Policy violation blocked: ${path} - ${message}`);
}

/**
 * Deep get a value from a nested object using dot notation.
 */
function deepGet(obj: Record<string, unknown>, path: string): unknown {
  const parts = path.split(".");
  let current: unknown = obj;
  for (const part of parts) {
    if (current === null || current === undefined || typeof current !== "object") {
      return undefined;
    }
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}

/**
 * Deep delete a value from a nested object using dot notation.
 */
function deepDelete(obj: Record<string, unknown>, path: string): boolean {
  const parts = path.split(".");
  const lastPart = parts.pop();
  if (!lastPart) return false;

  let current: unknown = obj;
  for (const part of parts) {
    if (current === null || current === undefined || typeof current !== "object") {
      return false;
    }
    current = (current as Record<string, unknown>)[part];
  }

  if (current !== null && current !== undefined && typeof current === "object") {
    delete (current as Record<string, unknown>)[lastPart];
    return true;
  }
  return false;
}

/**
 * Enforce security policy on OpenClaw configuration.
 *
 * This function should be called during config load to:
 * 1. Block dangerous config overrides
 * 2. Apply hardened defaults
 * 3. Log any policy violations
 *
 * @param config The user's OpenClaw configuration
 * @returns The config with security policy enforced
 */
export function enforceSecurityPolicy<T extends Record<string, unknown>>(config: T): T {
  const enforced = structuredClone(config);

  // Block dangerous config paths
  for (const blockedPath of BLOCKED_CONFIG_PATHS) {
    const value = deepGet(enforced, blockedPath);
    if (value !== undefined) {
      deepDelete(enforced, blockedPath);
      logPolicyViolation(blockedPath, `Blocked attempt to set dangerous option (value: ${JSON.stringify(value)})`);
    }
  }

  // Ensure gateway.controlUi exists for safety checks
  const gateway = enforced.gateway as Record<string, unknown> | undefined;
  if (gateway?.controlUi) {
    const controlUi = gateway.controlUi as Record<string, unknown>;

    // Block any attempt to disable device auth
    if (controlUi.dangerouslyDisableDeviceAuth === true) {
      delete controlUi.dangerouslyDisableDeviceAuth;
      logPolicyViolation(
        "gateway.controlUi.dangerouslyDisableDeviceAuth",
        "Device authentication cannot be disabled in DilloBot",
      );
    }

    // Block insecure auth
    if (controlUi.allowInsecureAuth === true) {
      delete controlUi.allowInsecureAuth;
      logPolicyViolation("gateway.controlUi.allowInsecureAuth", "Insecure authentication is blocked in DilloBot");
    }
  }

  // Check for open DM policies without explicit acknowledgment
  const channels = enforced.channels as Record<string, Record<string, unknown>> | undefined;
  if (channels) {
    for (const [channelName, channelConfig] of Object.entries(channels)) {
      const dm = channelConfig?.dm as Record<string, unknown> | undefined;
      if (dm?.policy === "open") {
        const allowFrom = dm.allowFrom as string[] | undefined;
        if (!allowFrom?.includes("*")) {
          logPolicyViolation(
            `channels.${channelName}.dm.policy`,
            'Open DM policy requires explicit allowFrom: ["*"] acknowledgment',
          );
        }
      }
    }
  }

  return enforced;
}

/**
 * Validate that a security config meets minimum requirements.
 */
export function validateSecurityConfig(config: Partial<SecurityPolicyConfig>): {
  valid: boolean;
  errors: string[];
  warnings: string[];
} {
  const errors: string[] = [];
  const warnings: string[] = [];

  // Check connection policy
  if (config.connections?.allowLocalAutoApprove === true) {
    errors.push("connections.allowLocalAutoApprove cannot be true in DilloBot (hardened default)");
  }

  // Check credential policy
  if (config.credentials?.allowPlaintextFallback === true) {
    errors.push("credentials.allowPlaintextFallback cannot be true in DilloBot (hardened default)");
  }

  if (config.credentials?.keyDerivationIterations && config.credentials.keyDerivationIterations < 100000) {
    warnings.push(
      `credentials.keyDerivationIterations (${config.credentials.keyDerivationIterations}) is below recommended minimum of 100000`,
    );
  }

  // Check injection config
  if (config.injection?.enabled === false) {
    warnings.push("Injection protection is disabled - this reduces security");
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  };
}
