/**
 * DilloBot Output Filter
 *
 * Prevents leaking sensitive information in LLM responses,
 * such as system prompts, configuration, and tokens.
 */

import type { OutputFilterConfig, OutputFilterResult } from "../types.js";

/**
 * Patterns that indicate system prompt content in output.
 */
const SYSTEM_PROMPT_LEAK_PATTERNS = [
  // Safety section markers
  /##\s*Safety\s+You\s+have\s+no\s+independent\s+goals/i,
  /Prioritize\s+safety\s+and\s+human\s+oversight/i,
  /Do\s+not\s+manipulate\s+or\s+persuade\s+anyone\s+to\s+expand\s+access/i,

  // External content markers (shouldn't appear in output)
  /<<<EXTERNAL_UNTRUSTED_CONTENT>>>/,
  /<<<END_EXTERNAL_UNTRUSTED_CONTENT>>>/,

  // System prompt function names
  /buildAgentSystemPrompt/i,
  /buildSafetySection/i,
  /buildSystemPrompt/i,

  // Common system prompt headers
  /^##\s*System\s*$/im,
  /^You\s+are\s+an?\s+AI\s+assistant\s+/im,
];

/**
 * Patterns that indicate configuration leaks.
 */
const CONFIG_LEAK_PATTERNS = [
  // Environment variable patterns
  /OPENCLAW_\w+_KEY/,
  /CLAWDBOT_\w+_KEY/,
  /ANTHROPIC_API_KEY\s*[=:]\s*["']?[a-zA-Z0-9_-]+/,
  /OPENAI_API_KEY\s*[=:]\s*["']?[a-zA-Z0-9_-]+/,

  // Config path patterns
  /gateway\.auth\.(token|password)/i,
  /credentials\.(apiKey|token|secret)/i,

  // File path patterns for sensitive locations
  /~\/\.openclaw\/identity\//,
  /~\/\.openclaw\/oauth\//,
];

/**
 * Patterns that indicate token/credential leaks.
 */
const TOKEN_LEAK_PATTERNS = [
  // API key formats (common patterns)
  /sk-[a-zA-Z0-9]{48,}/,
  /sk-ant-[a-zA-Z0-9-]+/,
  /sk-proj-[a-zA-Z0-9-]+/,

  // Bearer tokens
  /Bearer\s+[a-zA-Z0-9._-]{20,}/,

  // Base64 encoded tokens (long strings)
  /eyJ[a-zA-Z0-9_-]+\.eyJ[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+/, // JWT format

  // Private key markers
  /-----BEGIN\s+(RSA\s+)?PRIVATE\s+KEY-----/,
  /-----BEGIN\s+ENCRYPTED\s+PRIVATE\s+KEY-----/,
];

/**
 * Default output filter configuration.
 */
const DEFAULT_CONFIG: OutputFilterConfig = {
  enabled: true,
  patterns: {
    systemPromptLeaks: true,
    configLeaks: true,
    tokenLeaks: true,
  },
};

/**
 * Get the default output filter configuration.
 */
export function getDefaultOutputConfig(): OutputFilterConfig {
  return structuredClone(DEFAULT_CONFIG);
}

/**
 * Filter LLM output to prevent sensitive information leaks.
 *
 * @param text The LLM output text to filter
 * @param config Optional configuration overrides
 * @returns Filter result with original and sanitized text
 */
export function filterOutput(text: string, config?: Partial<OutputFilterConfig>): OutputFilterResult {
  const cfg = { ...DEFAULT_CONFIG, ...config };

  if (!cfg.enabled) {
    return {
      filtered: false,
      original: text,
      sanitized: text,
      redactedPatterns: [],
    };
  }

  let sanitized = text;
  const redactedPatterns: string[] = [];

  // Check system prompt leaks
  if (cfg.patterns.systemPromptLeaks) {
    for (const pattern of SYSTEM_PROMPT_LEAK_PATTERNS) {
      if (pattern.test(sanitized)) {
        sanitized = sanitized.replace(pattern, "[REDACTED: system content]");
        redactedPatterns.push(`system_prompt:${pattern.source.slice(0, 30)}`);
      }
    }
  }

  // Check config leaks
  if (cfg.patterns.configLeaks) {
    for (const pattern of CONFIG_LEAK_PATTERNS) {
      if (pattern.test(sanitized)) {
        sanitized = sanitized.replace(pattern, "[REDACTED: config]");
        redactedPatterns.push(`config:${pattern.source.slice(0, 30)}`);
      }
    }
  }

  // Check token leaks
  if (cfg.patterns.tokenLeaks) {
    for (const pattern of TOKEN_LEAK_PATTERNS) {
      if (pattern.test(sanitized)) {
        sanitized = sanitized.replace(pattern, "[REDACTED: credential]");
        redactedPatterns.push(`token:${pattern.source.slice(0, 30)}`);
      }
    }
  }

  const filtered = redactedPatterns.length > 0;

  return {
    filtered,
    original: text,
    sanitized,
    redactedPatterns,
  };
}

/**
 * Quick check if text might contain sensitive content.
 * Use this for early bailout before full filtering.
 */
export function mightContainSensitive(text: string): boolean {
  // Quick patterns that are very likely to indicate sensitive content
  const quickPatterns = [
    /<<<.*?>>>/,
    /OPENCLAW_/,
    /CLAWDBOT_/,
    /API_KEY/,
    /sk-[a-z]+-/,
    /-----BEGIN/,
  ];

  for (const pattern of quickPatterns) {
    if (pattern.test(text)) {
      return true;
    }
  }

  return false;
}

/**
 * Redact a specific value from text (e.g., a known API key).
 */
export function redactValue(text: string, value: string, replacement = "[REDACTED]"): string {
  if (!value || value.length < 8) {
    return text; // Don't redact very short values (too likely to match valid content)
  }

  // Escape regex special characters
  const escaped = value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(escaped, "g");

  return text.replace(pattern, replacement);
}
