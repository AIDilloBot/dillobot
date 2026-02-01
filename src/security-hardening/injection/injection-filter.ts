/**
 * DilloBot Prompt Injection Filter
 *
 * Provides detection and sanitization of prompt injection attempts
 * in user messages before they reach the LLM.
 */

import type { InjectionFilterConfig, InjectionScanResult, InjectionSeverity } from "../types.js";

/**
 * Injection patterns with associated severity and weight.
 * Higher weights contribute more to the total score.
 */
const INJECTION_PATTERNS: Array<{
  pattern: RegExp;
  name: string;
  severity: InjectionSeverity;
  weight: number;
}> = [
  // Instruction override attempts (high severity)
  {
    pattern: /ignore\s+(all\s+)?(previous|prior|above)\s+(instructions?|prompts?|rules?|guidelines?)/i,
    name: "ignore_previous",
    severity: "high",
    weight: 30,
  },
  {
    pattern: /disregard\s+(all\s+)?(previous|prior|above|your)/i,
    name: "disregard_instructions",
    severity: "high",
    weight: 30,
  },
  {
    pattern: /forget\s+(everything|all|your)\s+(instructions?|rules?|guidelines?|training)/i,
    name: "forget_instructions",
    severity: "high",
    weight: 30,
  },

  // Role hijacking attempts (high severity)
  {
    pattern: /you\s+are\s+now\s+(a|an)\s+/i,
    name: "role_hijack",
    severity: "high",
    weight: 25,
  },
  {
    pattern: /new\s+(instructions?|persona|role|identity):/i,
    name: "new_persona",
    severity: "high",
    weight: 25,
  },
  {
    pattern: /pretend\s+(you('re|are)\s+)?(to\s+be\s+)?/i,
    name: "pretend_persona",
    severity: "medium",
    weight: 20,
  },

  // System prompt injection (critical severity)
  {
    pattern: /system\s*:?\s*(prompt|override|command|instruction)/i,
    name: "system_override",
    severity: "critical",
    weight: 40,
  },
  {
    pattern: /<\/?system>/i,
    name: "xml_system_tag",
    severity: "critical",
    weight: 40,
  },
  {
    pattern: /<\/user>\s*<(system|assistant)>/i,
    name: "xml_role_injection",
    severity: "critical",
    weight: 45,
  },
  {
    pattern: /\]\s*\n\s*\[?(system|assistant|user)\]?:/i,
    name: "bracket_role_injection",
    severity: "high",
    weight: 35,
  },

  // Jailbreak attempts (high severity)
  {
    pattern: /\bDAN\b/,
    name: "dan_jailbreak",
    severity: "high",
    weight: 30,
  },
  {
    pattern: /\b(developer|dev)\s*mode\b/i,
    name: "developer_mode",
    severity: "high",
    weight: 25,
  },
  {
    pattern: /\bno\s+(restrictions?|limits?|rules?|guidelines?)\b/i,
    name: "no_restrictions",
    severity: "high",
    weight: 25,
  },
  {
    pattern: /\bunlock(ed)?\s+(mode|capabilities?|features?)\b/i,
    name: "unlock_mode",
    severity: "high",
    weight: 25,
  },

  // Tool invocation attempts (medium severity)
  {
    pattern: /\bexec\b.*command\s*=/i,
    name: "exec_command",
    severity: "medium",
    weight: 20,
  },
  {
    pattern: /elevated\s*=\s*true/i,
    name: "elevated_privileges",
    severity: "high",
    weight: 30,
  },
  {
    pattern: /\{\s*"?tool"?\s*:/i,
    name: "tool_json",
    severity: "medium",
    weight: 15,
  },
  {
    pattern: /\{\s*"?function"?\s*:/i,
    name: "function_json",
    severity: "medium",
    weight: 15,
  },

  // Data exfiltration attempts (high severity)
  {
    pattern: /send\s+(this\s+)?to\s+[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/i,
    name: "email_exfil",
    severity: "high",
    weight: 25,
  },
  {
    pattern: /forward\s+(this\s+)?to\s+/i,
    name: "forward_exfil",
    severity: "medium",
    weight: 15,
  },

  // Destructive commands (medium severity)
  {
    pattern: /rm\s+-rf/i,
    name: "rm_rf_command",
    severity: "medium",
    weight: 20,
  },
  {
    pattern: /delete\s+all\s+(emails?|files?|data|messages?)/i,
    name: "delete_all",
    severity: "medium",
    weight: 20,
  },

  // Encoded payloads (medium severity)
  {
    pattern: /base64\s*:\s*[A-Za-z0-9+/=]{20,}/i,
    name: "base64_payload",
    severity: "medium",
    weight: 15,
  },

  // Prompt extraction attempts (medium severity)
  {
    pattern: /reveal\s+(your\s+)?(system\s+)?prompt/i,
    name: "reveal_prompt",
    severity: "medium",
    weight: 15,
  },
  {
    pattern: /show\s+(me\s+)?(your\s+)?(system\s+)?instructions/i,
    name: "show_instructions",
    severity: "medium",
    weight: 15,
  },
  {
    pattern: /what\s+(are|is)\s+(your\s+)?(system\s+)?prompt/i,
    name: "what_prompt",
    severity: "low",
    weight: 10,
  },
];

/**
 * Default injection filter configuration.
 */
const DEFAULT_CONFIG: InjectionFilterConfig = {
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
 * Get the default injection filter configuration.
 */
export function getDefaultInjectionConfig(): InjectionFilterConfig {
  return structuredClone(DEFAULT_CONFIG);
}

/**
 * Scan content for prompt injection patterns.
 *
 * @param content The message content to scan
 * @param config Optional configuration overrides
 * @returns Scan result with detected patterns and severity
 */
export function scanForInjection(content: string, config?: Partial<InjectionFilterConfig>): InjectionScanResult {
  const cfg = { ...DEFAULT_CONFIG, ...config };

  if (!cfg.enabled) {
    return {
      detected: false,
      severity: "none",
      patterns: [],
      score: 0,
      shouldBlock: false,
      shouldSanitize: false,
    };
  }

  const detectedPatterns: string[] = [];
  let totalScore = 0;
  let maxSeverity: InjectionSeverity = "none";

  // Check all patterns
  for (const { pattern, name, severity, weight } of INJECTION_PATTERNS) {
    if (pattern.test(content)) {
      detectedPatterns.push(name);
      totalScore += weight;

      // Track max severity
      if (severityToNumber(severity) > severityToNumber(maxSeverity)) {
        maxSeverity = severity;
      }
    }
  }

  // Check custom patterns
  if (cfg.customPatterns) {
    for (let i = 0; i < cfg.customPatterns.length; i++) {
      const customPattern = cfg.customPatterns[i];
      if (customPattern.test(content)) {
        detectedPatterns.push(`custom_${i}`);
        totalScore += 20; // Default weight for custom patterns
      }
    }
  }

  const detected = detectedPatterns.length > 0;
  const shouldBlock = totalScore >= cfg.thresholds.block;
  const shouldSanitize = totalScore >= cfg.thresholds.sanitize && !shouldBlock;

  return {
    detected,
    severity: maxSeverity,
    patterns: detectedPatterns,
    score: totalScore,
    shouldBlock,
    shouldSanitize,
  };
}

/**
 * Convert severity to numeric value for comparison.
 */
function severityToNumber(severity: InjectionSeverity): number {
  switch (severity) {
    case "none":
      return 0;
    case "low":
      return 1;
    case "medium":
      return 2;
    case "high":
      return 3;
    case "critical":
      return 4;
  }
}

/**
 * Sanitize content by removing or neutralizing injection patterns.
 *
 * This function attempts to remove dangerous patterns while preserving
 * legitimate content as much as possible.
 *
 * @param content The content to sanitize
 * @returns Sanitized content
 */
export function sanitizeInjectionPatterns(content: string): string {
  let sanitized = content;

  // Remove XML-style role tags
  sanitized = sanitized.replace(/<\/?(?:system|assistant|user)>/gi, "[REMOVED]");

  // Remove bracket-style role markers
  sanitized = sanitized.replace(/\[(?:system|assistant|user)\]:/gi, "[REMOVED]:");

  // Neutralize "ignore previous" type instructions
  sanitized = sanitized.replace(
    /(ignore|disregard|forget)\s+(all\s+)?(previous|prior|above|your)\s+(instructions?|prompts?|rules?|guidelines?)/gi,
    "[SANITIZED: $1 $4]",
  );

  // Neutralize "you are now" role changes
  sanitized = sanitized.replace(/you\s+are\s+now\s+(a|an)\s+/gi, "[SANITIZED: role change] ");

  // Neutralize system override attempts
  sanitized = sanitized.replace(/system\s*:\s*(prompt|override|command|instruction)/gi, "[SANITIZED: $1]");

  // Neutralize jailbreak keywords
  sanitized = sanitized.replace(/\bDAN\b/g, "[SANITIZED]");
  sanitized = sanitized.replace(/\b(developer|dev)\s*mode\b/gi, "[SANITIZED: $1 mode]");

  return sanitized;
}

/**
 * Escape content for safe inclusion in prompts.
 *
 * This wraps content in security boundaries and escapes
 * potentially dangerous sequences.
 *
 * @param content The content to escape
 * @param source Optional source label for the content
 * @returns Escaped content with security boundaries
 */
export function escapeForPrompt(content: string, source?: string): string {
  const sourceLabel = source ? ` (source: ${source})` : "";

  // First sanitize any injection patterns
  const sanitized = sanitizeInjectionPatterns(content);

  // Wrap in security boundaries
  return [
    `<<<EXTERNAL_UNTRUSTED_CONTENT${sourceLabel}>>>`,
    sanitized,
    "<<<END_EXTERNAL_UNTRUSTED_CONTENT>>>",
  ].join("\n");
}

/**
 * Check if content appears to be from an external/untrusted source
 * based on session key patterns.
 */
export function isExternalContent(sessionKey: string): boolean {
  return (
    sessionKey.startsWith("hook:") ||
    sessionKey.startsWith("webhook:") ||
    sessionKey.startsWith("email:") ||
    sessionKey.startsWith("api:")
  );
}
