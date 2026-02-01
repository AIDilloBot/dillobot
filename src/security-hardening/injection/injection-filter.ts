/**
 * DilloBot Quick Injection Pre-Filter
 *
 * This module provides FAST pattern-based detection for unambiguous threats
 * that don't require LLM analysis. These patterns catch things that are
 * NEVER legitimate in normal content.
 *
 * For semantic injection detection, use injection-analyzer.ts which uses
 * the LLM to understand intent rather than matching patterns.
 *
 * Pattern Philosophy:
 * - Only include patterns for things that are NEVER legitimate
 * - Credential patterns detect DATA, not intent
 * - Unicode manipulation characters are never needed in normal text
 * - Webhook URLs for known exfil services are never legitimate to include
 */

import type { InjectionFilterConfig, InjectionScanResult, InjectionSeverity } from "../types.js";

/**
 * Critical patterns that are NEVER legitimate.
 * These are fast checks that run before LLM analysis.
 */
const CRITICAL_PATTERNS: Array<{
  pattern: RegExp;
  name: string;
  severity: InjectionSeverity;
  category: "unicode" | "exfil_endpoint" | "credential";
  description: string;
}> = [
  // ==========================================================================
  // UNICODE MANIPULATION - Never legitimate in normal text
  // ==========================================================================
  {
    pattern: /[\u200B\u200C\u200D\u2060\uFEFF]/,
    name: "zero_width_chars",
    severity: "medium",
    category: "unicode",
    description: "Zero-width characters (can hide content or split keywords)",
  },
  {
    pattern: /[\u202A-\u202E]/,
    name: "bidi_override",
    severity: "high",
    category: "unicode",
    description: "Bidirectional text override (can reverse/hide text direction)",
  },
  {
    pattern: /[\uE0000-\uE007F]/,
    name: "tag_chars",
    severity: "high",
    category: "unicode",
    description: "Unicode tag characters (invisible, can encode hidden data)",
  },
  {
    pattern: /[\u2061-\u2064]/,
    name: "invisible_operators",
    severity: "medium",
    category: "unicode",
    description: "Invisible mathematical operators (can separate keywords)",
  },

  // ==========================================================================
  // KNOWN EXFIL ENDPOINTS - Never legitimate to include in content
  // ==========================================================================
  {
    pattern: /discord\.com\/api\/webhooks\/\d{17,}/i,
    name: "discord_webhook",
    severity: "critical",
    category: "exfil_endpoint",
    description: "Discord webhook URL (data exfiltration endpoint)",
  },
  {
    pattern: /hooks\.slack\.com\/services\/T[A-Z0-9]+\/B[A-Z0-9]+\/[A-Za-z0-9]+/i,
    name: "slack_webhook",
    severity: "critical",
    category: "exfil_endpoint",
    description: "Slack webhook URL (data exfiltration endpoint)",
  },
  {
    pattern: /(?:webhook\.site|requestbin\.com|hookbin\.com|pipedream\.net)\/[a-z0-9-]+/i,
    name: "temp_webhook",
    severity: "high",
    category: "exfil_endpoint",
    description: "Temporary webhook service (common exfiltration target)",
  },

  // ==========================================================================
  // CREDENTIAL PATTERNS - Data detection (never include in external content)
  // ==========================================================================
  {
    pattern: /AKIA[0-9A-Z]{16}/,
    name: "aws_access_key",
    severity: "critical",
    category: "credential",
    description: "AWS Access Key ID",
  },
  {
    pattern: /ghp_[A-Za-z0-9_]{36,}/,
    name: "github_pat",
    severity: "critical",
    category: "credential",
    description: "GitHub Personal Access Token",
  },
  {
    pattern: /gho_[A-Za-z0-9_]{36,}/,
    name: "github_oauth",
    severity: "critical",
    category: "credential",
    description: "GitHub OAuth Token",
  },
  {
    pattern: /sk-ant-[A-Za-z0-9_-]{40,}/,
    name: "anthropic_key",
    severity: "critical",
    category: "credential",
    description: "Anthropic API Key",
  },
  {
    pattern: /sk-[A-Za-z0-9]{48,}/,
    name: "openai_key",
    severity: "critical",
    category: "credential",
    description: "OpenAI API Key",
  },
  {
    pattern: /AIza[0-9A-Za-z_-]{35}/,
    name: "google_api_key",
    severity: "critical",
    category: "credential",
    description: "Google API Key",
  },
  {
    pattern: /(?:sk|pk)_(?:live|test)_[0-9a-zA-Z]{24,}/,
    name: "stripe_key",
    severity: "critical",
    category: "credential",
    description: "Stripe API Key",
  },
  {
    pattern: /-----BEGIN\s+(?:RSA\s+)?PRIVATE\s+KEY-----/,
    name: "private_key",
    severity: "critical",
    category: "credential",
    description: "Private Key (PEM format)",
  },
];

/**
 * Default configuration for quick filter.
 */
const DEFAULT_CONFIG: InjectionFilterConfig = {
  enabled: true,
  mode: "warn", // Quick filter only warns; LLM analyzer decides actions
  thresholds: {
    warn: 0, // Any detection triggers warning
    sanitize: 100, // Don't auto-sanitize (let LLM decide)
    block: 100, // Don't auto-block (let LLM decide)
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
 * Scan content for critical patterns.
 * This is a FAST pre-filter before LLM analysis.
 *
 * @param content The content to scan
 * @param config Optional configuration
 * @returns Scan result with detected patterns
 */
export function scanForInjection(
  content: string,
  config?: Partial<InjectionFilterConfig>,
): InjectionScanResult {
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
  let maxSeverity: InjectionSeverity = "none";
  const findings: Array<{ name: string; category: string; description: string }> = [];

  // Check all critical patterns
  for (const { pattern, name, severity, category, description } of CRITICAL_PATTERNS) {
    if (pattern.test(content)) {
      detectedPatterns.push(name);
      findings.push({ name, category, description });

      if (severityToNumber(severity) > severityToNumber(maxSeverity)) {
        maxSeverity = severity;
      }
    }
  }

  // Check custom patterns if provided
  if (cfg.customPatterns) {
    for (let i = 0; i < cfg.customPatterns.length; i++) {
      const customPattern = cfg.customPatterns[i];
      if (customPattern.test(content)) {
        detectedPatterns.push(`custom_${i}`);
      }
    }
  }

  const detected = detectedPatterns.length > 0;

  // Quick filter doesn't block/sanitize - it just detects and warns
  // The LLM analyzer makes the final decision
  return {
    detected,
    severity: maxSeverity,
    patterns: detectedPatterns,
    score: detectedPatterns.length * 10,
    shouldBlock: false, // Let LLM decide
    shouldSanitize: false, // Let LLM decide
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
 * Strip dangerous unicode characters from content.
 * This is a targeted sanitization that only removes characters
 * that are NEVER legitimate.
 *
 * @param content The content to sanitize
 * @returns Content with dangerous unicode removed
 */
export function stripDangerousUnicode(content: string): string {
  return content
    .replace(/[\u200B\u200C\u200D\u2060\uFEFF]/g, "") // Zero-width chars
    .replace(/[\u202A-\u202E]/g, "") // Bidi overrides
    .replace(/[\uE0000-\uE007F]/g, "") // Tag chars
    .replace(/[\u2061-\u2064]/g, ""); // Invisible operators
}

/**
 * Escape content for safe inclusion in prompts.
 * Wraps content in security boundaries.
 *
 * @param content The content to escape
 * @param source Optional source label
 * @returns Escaped content with security boundaries
 */
export function escapeForPrompt(content: string, source?: string): string {
  const sourceLabel = source ? ` (source: ${source})` : "";
  const sanitized = stripDangerousUnicode(content);

  return [
    `<<<EXTERNAL_UNTRUSTED_CONTENT${sourceLabel}>>>`,
    sanitized,
    "<<<END_EXTERNAL_UNTRUSTED_CONTENT>>>",
  ].join("\n");
}

/**
 * Get pattern details for a detected pattern name.
 */
export function getPatternDetails(
  patternName: string,
): { category: string; description: string } | undefined {
  const pattern = CRITICAL_PATTERNS.find((p) => p.name === patternName);
  if (pattern) {
    return { category: pattern.category, description: pattern.description };
  }
  return undefined;
}

/**
 * Legacy function - kept for backwards compatibility.
 * Use stripDangerousUnicode() instead for targeted sanitization.
 */
export function sanitizeInjectionPatterns(content: string): string {
  return stripDangerousUnicode(content);
}
