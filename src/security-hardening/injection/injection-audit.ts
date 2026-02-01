/**
 * DilloBot Injection Audit
 *
 * Provides security event logging and auditing for
 * injection detection and output filtering.
 */

import crypto from "node:crypto";
import type { InjectionScanResult, OutputFilterResult, SecurityAuditEvent, SecurityAuditEventType } from "../types.js";

/**
 * Event listeners for security audit events.
 */
const eventListeners: Array<(event: SecurityAuditEvent) => void> = [];

/**
 * Register a listener for security audit events.
 */
export function onSecurityAuditEvent(listener: (event: SecurityAuditEvent) => void): () => void {
  eventListeners.push(listener);
  return () => {
    const index = eventListeners.indexOf(listener);
    if (index >= 0) {
      eventListeners.splice(index, 1);
    }
  };
}

/**
 * Emit a security audit event to all listeners.
 */
export function emitSecurityAuditEvent(event: SecurityAuditEvent): void {
  for (const listener of eventListeners) {
    try {
      listener(event);
    } catch (error) {
      // Don't let listener errors break the flow
      console.error("[DilloBot Security] Audit listener error:", error);
    }
  }

  // Also log to console for now (will integrate with OpenClaw logging)
  logSecurityEvent(event);
}

/**
 * Log a security event to console.
 */
function logSecurityEvent(event: SecurityAuditEvent): void {
  const timestamp = new Date(event.timestamp).toISOString();
  const prefix = `[DilloBot Security ${timestamp}]`;

  switch (event.severity) {
    case "critical":
      console.error(`${prefix} CRITICAL: ${event.eventType}`, formatEventDetails(event));
      break;
    case "high":
      console.warn(`${prefix} HIGH: ${event.eventType}`, formatEventDetails(event));
      break;
    case "medium":
      console.warn(`${prefix} MEDIUM: ${event.eventType}`, formatEventDetails(event));
      break;
    case "low":
      console.info(`${prefix} LOW: ${event.eventType}`, formatEventDetails(event));
      break;
    default:
      console.info(`${prefix} INFO: ${event.eventType}`, formatEventDetails(event));
  }
}

/**
 * Format event details for logging.
 */
function formatEventDetails(event: SecurityAuditEvent): string {
  const parts: string[] = [];

  if (event.sessionKey) {
    parts.push(`session=${event.sessionKey}`);
  }
  if (event.senderId) {
    parts.push(`sender=${event.senderId}`);
  }
  if (event.channel) {
    parts.push(`channel=${event.channel}`);
  }
  if (event.contentHash) {
    parts.push(`hash=${event.contentHash.slice(0, 16)}...`);
  }

  // Add specific details based on event type
  const details = event.details as Record<string, unknown>;
  if (details.patterns) {
    parts.push(`patterns=${JSON.stringify(details.patterns)}`);
  }
  if (details.score !== undefined) {
    parts.push(`score=${details.score}`);
  }
  if (details.redactedPatterns) {
    parts.push(`redacted=${JSON.stringify(details.redactedPatterns)}`);
  }

  return parts.join(" ");
}

/**
 * Hash content for audit logging (privacy-preserving).
 */
export function hashContent(content: string): string {
  return crypto.createHash("sha256").update(content).digest("hex");
}

/**
 * Context for injection attempt logging.
 */
export interface InjectionAttemptContext {
  sessionKey?: string;
  senderId?: string;
  channel?: string;
  body?: string;
}

/**
 * Log an injection attempt detection.
 */
export function logInjectionAttempt(params: {
  ctx: InjectionAttemptContext;
  scanResult: InjectionScanResult;
}): void {
  const { ctx, scanResult } = params;

  const eventType: SecurityAuditEventType = scanResult.shouldBlock
    ? "injection_blocked"
    : scanResult.shouldSanitize
      ? "injection_sanitized"
      : "injection_detected";

  const event: SecurityAuditEvent = {
    timestamp: Date.now(),
    eventType,
    severity: scanResult.severity,
    sessionKey: ctx.sessionKey,
    senderId: ctx.senderId,
    channel: ctx.channel,
    details: {
      patterns: scanResult.patterns,
      score: scanResult.score,
      shouldBlock: scanResult.shouldBlock,
      shouldSanitize: scanResult.shouldSanitize,
    },
    contentHash: ctx.body ? hashContent(ctx.body) : undefined,
  };

  emitSecurityAuditEvent(event);
}

/**
 * Log an output filtering event.
 */
export function logOutputFiltered(params: { sessionKey?: string; filterResult: OutputFilterResult }): void {
  const { sessionKey, filterResult } = params;

  if (!filterResult.filtered) {
    return; // Nothing to log
  }

  const event: SecurityAuditEvent = {
    timestamp: Date.now(),
    eventType: "output_filtered",
    severity: "medium",
    sessionKey,
    details: {
      redactedPatterns: filterResult.redactedPatterns,
      originalLength: filterResult.original.length,
      sanitizedLength: filterResult.sanitized.length,
    },
    contentHash: hashContent(filterResult.original),
  };

  emitSecurityAuditEvent(event);
}

/**
 * Log a skill verification failure.
 */
export function logSkillVerificationFailed(params: {
  skillKey: string;
  reason: string;
  expected?: string;
  actual?: string;
}): void {
  const event: SecurityAuditEvent = {
    timestamp: Date.now(),
    eventType: "skill_verification_failed",
    severity: "high",
    details: {
      skillKey: params.skillKey,
      reason: params.reason,
      expected: params.expected,
      actual: params.actual,
    },
  };

  emitSecurityAuditEvent(event);
}

/**
 * Log a policy violation.
 */
export function logPolicyViolation(params: { path: string; message: string; attemptedValue?: unknown }): void {
  const event: SecurityAuditEvent = {
    timestamp: Date.now(),
    eventType: "policy_violation",
    severity: "high",
    details: {
      configPath: params.path,
      message: params.message,
      attemptedValue: params.attemptedValue,
    },
  };

  emitSecurityAuditEvent(event);
}

/**
 * Log a vault access event.
 */
export function logVaultAccess(params: {
  operation: "store" | "retrieve" | "delete" | "rotate";
  key: string;
  success: boolean;
  error?: string;
}): void {
  const event: SecurityAuditEvent = {
    timestamp: Date.now(),
    eventType: "vault_access",
    severity: params.success ? "none" : "medium",
    details: {
      operation: params.operation,
      keyPrefix: params.key.split(":")[0], // Only log key prefix for privacy
      success: params.success,
      error: params.error,
    },
  };

  emitSecurityAuditEvent(event);
}

/**
 * Log a pairing attempt.
 */
export function logPairingAttempt(params: {
  deviceId: string;
  channel?: string;
  result: "approved" | "rejected" | "expired" | "pending";
  isLocal: boolean;
}): void {
  const event: SecurityAuditEvent = {
    timestamp: Date.now(),
    eventType: "pairing_attempt",
    severity: params.result === "rejected" ? "medium" : "none",
    channel: params.channel,
    details: {
      deviceId: params.deviceId.slice(0, 16) + "...", // Truncate for privacy
      result: params.result,
      isLocal: params.isLocal,
    },
  };

  emitSecurityAuditEvent(event);
}
