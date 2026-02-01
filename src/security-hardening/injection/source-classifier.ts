/**
 * DilloBot Content Source Classification
 *
 * Classifies incoming content by source to determine appropriate
 * trust levels and security treatment.
 */

/**
 * Types of content sources.
 */
export type ContentSource =
  | "user_direct" // Direct CLI/UI input from authenticated user
  | "email" // Email content (Gmail hooks, etc.)
  | "webhook" // External webhook payloads
  | "api" // External API calls
  | "web_content" // Fetched web pages
  | "file_content" // Content read from files
  | "skill" // Skill prompts (handled separately)
  | "unknown"; // Unknown source

/**
 * Trust levels for content sources.
 */
export type TrustLevel = "high" | "medium" | "low";

/**
 * Source classification result.
 */
export interface SourceClassification {
  source: ContentSource;
  trustLevel: TrustLevel;
  requiresLLMAnalysis: boolean;
  requiresWrapping: boolean;
}

/**
 * Trust level configuration for each source type.
 */
const SOURCE_TRUST_CONFIG: Record<
  ContentSource,
  { trustLevel: TrustLevel; requiresLLMAnalysis: boolean; requiresWrapping: boolean }
> = {
  user_direct: {
    trustLevel: "high",
    requiresLLMAnalysis: false,
    requiresWrapping: false,
  },
  skill: {
    trustLevel: "medium",
    requiresLLMAnalysis: true, // Handled by skill-inspector.ts
    requiresWrapping: false,
  },
  file_content: {
    trustLevel: "medium",
    requiresLLMAnalysis: false,
    requiresWrapping: true,
  },
  email: {
    trustLevel: "low",
    requiresLLMAnalysis: true,
    requiresWrapping: true,
  },
  webhook: {
    trustLevel: "low",
    requiresLLMAnalysis: true,
    requiresWrapping: true,
  },
  api: {
    trustLevel: "low",
    requiresLLMAnalysis: true,
    requiresWrapping: true,
  },
  web_content: {
    trustLevel: "low",
    requiresLLMAnalysis: true,
    requiresWrapping: true,
  },
  unknown: {
    trustLevel: "low",
    requiresLLMAnalysis: true,
    requiresWrapping: true,
  },
};

/**
 * Session key patterns for source detection.
 */
const SESSION_KEY_PATTERNS: Array<{ pattern: RegExp; source: ContentSource }> = [
  // Email hooks
  { pattern: /^hook:gmail:/i, source: "email" },
  { pattern: /^hook:email:/i, source: "email" },
  { pattern: /^hook:outlook:/i, source: "email" },
  { pattern: /^email:/i, source: "email" },

  // Webhooks
  { pattern: /^hook:webhook:/i, source: "webhook" },
  { pattern: /^hook:/i, source: "webhook" }, // Generic hook fallback
  { pattern: /^webhook:/i, source: "webhook" },

  // API calls
  { pattern: /^api:/i, source: "api" },
  { pattern: /^external:/i, source: "api" },

  // Web content
  { pattern: /^web:/i, source: "web_content" },
  { pattern: /^fetch:/i, source: "web_content" },

  // File content
  { pattern: /^file:/i, source: "file_content" },

  // Skills
  { pattern: /^skill:/i, source: "skill" },
];

/**
 * Classify content source from session key.
 *
 * @param sessionKey The session key or identifier
 * @param context Optional additional context for classification
 * @returns The classified content source
 */
export function classifySource(
  sessionKey: string,
  context?: Record<string, unknown>,
): ContentSource {
  // Check session key patterns
  for (const { pattern, source } of SESSION_KEY_PATTERNS) {
    if (pattern.test(sessionKey)) {
      return source;
    }
  }

  // Check context for additional hints
  if (context) {
    if (context.isEmail || context.emailAddress) {
      return "email";
    }
    if (context.isWebhook || context.webhookId) {
      return "webhook";
    }
    if (context.isApiCall || context.apiClient) {
      return "api";
    }
    if (context.isWebFetch || context.url) {
      return "web_content";
    }
    if (context.isFile || context.filePath) {
      return "file_content";
    }
  }

  // Default: assume direct user input if no patterns match
  // This is intentionally permissive for backwards compatibility
  if (
    !sessionKey ||
    sessionKey === "user" ||
    sessionKey === "cli" ||
    sessionKey === "interactive"
  ) {
    return "user_direct";
  }

  return "unknown";
}

/**
 * Get the trust level for a content source.
 *
 * @param source The content source
 * @returns The trust level
 */
export function getTrustLevel(source: ContentSource): TrustLevel {
  return SOURCE_TRUST_CONFIG[source].trustLevel;
}

/**
 * Check if a source requires LLM-based injection analysis.
 *
 * @param source The content source
 * @returns True if LLM analysis is required
 */
export function requiresLLMAnalysis(source: ContentSource): boolean {
  return SOURCE_TRUST_CONFIG[source].requiresLLMAnalysis;
}

/**
 * Check if content from a source should be wrapped with security boundaries.
 *
 * @param source The content source
 * @returns True if content should be wrapped
 */
export function requiresWrapping(source: ContentSource): boolean {
  return SOURCE_TRUST_CONFIG[source].requiresWrapping;
}

/**
 * Get full classification for a session key.
 *
 * @param sessionKey The session key
 * @param context Optional additional context
 * @returns Full source classification
 */
export function getSourceClassification(
  sessionKey: string,
  context?: Record<string, unknown>,
): SourceClassification {
  const source = classifySource(sessionKey, context);
  const config = SOURCE_TRUST_CONFIG[source];

  return {
    source,
    trustLevel: config.trustLevel,
    requiresLLMAnalysis: config.requiresLLMAnalysis,
    requiresWrapping: config.requiresWrapping,
  };
}

/**
 * Check if a session key indicates an external/untrusted source.
 * This is a convenience function for quick checks.
 */
export function isExternalSource(sessionKey: string, context?: Record<string, unknown>): boolean {
  const source = classifySource(sessionKey, context);
  return getTrustLevel(source) === "low";
}
