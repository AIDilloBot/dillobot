/**
 * DilloBot Content Security
 *
 * Unified content security processing that integrates:
 * - Quick pre-filter for critical patterns
 * - Source classification and trust levels
 * - LLM-based semantic analysis for low-trust content
 * - External content wrapping
 *
 * This module is the main entry point for content security in DilloBot.
 */

import type { InjectionSeverity } from "../types.js";
import {
  analyzeForInjection,
  canSkipAnalysis,
  type InjectionLLMProvider,
  type InjectionAnalysisResult,
  DEFAULT_ANALYSIS_CONFIG,
} from "./injection-analyzer.js";
import { logInjectionAttempt, emitSecurityAuditEvent } from "./injection-audit.js";
import { scanForInjection, stripDangerousUnicode, escapeForPrompt } from "./injection-filter.js";
import {
  classifySource,
  getTrustLevel,
  requiresLLMAnalysis,
  requiresWrapping,
  type ContentSource,
  type TrustLevel,
} from "./source-classifier.js";

/**
 * Result of content security processing.
 */
export interface ContentSecurityResult {
  /** Whether the content is allowed to proceed */
  allowed: boolean;
  /** Whether the content was blocked */
  blocked: boolean;
  /** Reason for blocking (if blocked) */
  blockReason?: string;
  /** Whether warnings were generated */
  hasWarnings: boolean;
  /** Warning messages */
  warnings: string[];
  /** The processed content (sanitized if needed) */
  processedContent: string;
  /** Whether content was wrapped with security boundaries */
  wrapped: boolean;
  /** Source classification */
  source: ContentSource;
  /** Trust level */
  trustLevel: TrustLevel;
  /** Quick filter findings */
  quickFilterFindings: string[];
  /** LLM analysis result (if performed) */
  llmAnalysis?: InjectionAnalysisResult;
}

/**
 * Configuration for content security processing.
 */
export interface ContentSecurityConfig {
  /** Enable content security (default: true) */
  enabled: boolean;
  /** Enable quick pre-filter (default: true) */
  quickFilterEnabled: boolean;
  /** Enable LLM analysis for low-trust content (default: true) */
  llmAnalysisEnabled: boolean;
  /** Block on critical quick filter findings (default: true) */
  blockOnCriticalPatterns: boolean;
  /** Risk level threshold for blocking (default: critical) */
  blockThreshold: InjectionSeverity;
  /** Risk level threshold for warnings (default: medium) */
  warnThreshold: InjectionSeverity;
  /** Wrap external content with security boundaries (default: true) */
  wrapExternalContent: boolean;
  /** Strip dangerous unicode characters (default: true) */
  stripUnicode: boolean;
  /** Log security events (default: true) */
  logEvents: boolean;
}

/**
 * Default content security configuration.
 */
export const DEFAULT_CONTENT_SECURITY_CONFIG: ContentSecurityConfig = {
  enabled: true,
  quickFilterEnabled: true,
  llmAnalysisEnabled: true,
  blockOnCriticalPatterns: true,
  blockThreshold: "critical",
  warnThreshold: "medium",
  wrapExternalContent: true,
  stripUnicode: true,
  logEvents: true,
};

/**
 * Context for content security processing.
 */
export interface ContentSecurityContext {
  /** Session key or identifier */
  sessionKey: string;
  /** Optional sender identifier */
  senderId?: string;
  /** Optional channel identifier */
  channel?: string;
  /** Optional additional context */
  metadata?: Record<string, unknown>;
}

/**
 * Process content through the security pipeline.
 *
 * @param content The content to process
 * @param context Security context
 * @param llmProvider Optional LLM provider for semantic analysis
 * @param config Optional configuration overrides
 * @returns Security processing result
 */
export async function processContentSecurity(
  content: string,
  context: ContentSecurityContext,
  llmProvider?: InjectionLLMProvider,
  config: Partial<ContentSecurityConfig> = {},
): Promise<ContentSecurityResult> {
  const cfg = { ...DEFAULT_CONTENT_SECURITY_CONFIG, ...config };

  // Initialize result
  const result: ContentSecurityResult = {
    allowed: true,
    blocked: false,
    hasWarnings: false,
    warnings: [],
    processedContent: content,
    wrapped: false,
    source: "unknown",
    trustLevel: "low",
    quickFilterFindings: [],
  };

  // If disabled, pass through
  if (!cfg.enabled) {
    result.source = classifySource(context.sessionKey, context.metadata);
    result.trustLevel = getTrustLevel(result.source);
    return result;
  }

  // Step 1: Classify source and determine trust level
  result.source = classifySource(context.sessionKey, context.metadata);
  result.trustLevel = getTrustLevel(result.source);

  // Step 2: Run quick pre-filter
  if (cfg.quickFilterEnabled) {
    const quickScan = scanForInjection(content);

    if (quickScan.detected) {
      result.quickFilterFindings = quickScan.patterns;
      result.hasWarnings = true;
      result.warnings.push(
        `Quick filter detected: ${quickScan.patterns.join(", ")} (severity: ${quickScan.severity})`,
      );

      // Log the detection
      if (cfg.logEvents) {
        logInjectionAttempt({
          ctx: {
            sessionKey: context.sessionKey,
            senderId: context.senderId,
            channel: context.channel,
          },
          scanResult: quickScan,
        });
      }

      // Block on critical patterns if configured
      if (cfg.blockOnCriticalPatterns && quickScan.severity === "critical") {
        result.allowed = false;
        result.blocked = true;
        result.blockReason = `Critical security pattern detected: ${quickScan.patterns.join(", ")}`;

        if (cfg.logEvents) {
          emitSecurityAuditEvent({
            timestamp: Date.now(),
            eventType: "injection_blocked",
            severity: quickScan.severity,
            sessionKey: context.sessionKey,
            senderId: context.senderId,
            channel: context.channel,
            details: {
              patterns: quickScan.patterns,
              reason: result.blockReason,
            },
          });
        }

        return result;
      }
    }

    // Strip dangerous unicode if configured
    if (
      cfg.stripUnicode &&
      quickScan.patterns.some(
        (p) => p.includes("unicode") || p.includes("bidi") || p.includes("zero_width"),
      )
    ) {
      result.processedContent = stripDangerousUnicode(result.processedContent);
    }
  }

  // Step 3: LLM analysis for low-trust sources
  if (
    cfg.llmAnalysisEnabled &&
    llmProvider &&
    result.trustLevel === "low" &&
    requiresLLMAnalysis(result.source) &&
    !canSkipAnalysis(content)
  ) {
    try {
      const analysisConfig = {
        ...DEFAULT_ANALYSIS_CONFIG,
        blockThreshold: cfg.blockThreshold,
        warnThreshold: cfg.warnThreshold,
      };

      result.llmAnalysis = await analyzeForInjection(
        result.processedContent,
        result.source,
        llmProvider,
        analysisConfig,
      );

      // Handle analysis result
      if (result.llmAnalysis.shouldBlock) {
        result.allowed = false;
        result.blocked = true;
        result.blockReason = result.llmAnalysis.explanation;

        if (cfg.logEvents) {
          emitSecurityAuditEvent({
            timestamp: Date.now(),
            eventType: "injection_blocked",
            severity: result.llmAnalysis.riskLevel,
            sessionKey: context.sessionKey,
            senderId: context.senderId,
            channel: context.channel,
            details: {
              intent: result.llmAnalysis.intent,
              category: result.llmAnalysis.category,
              explanation: result.llmAnalysis.explanation,
            },
          });
        }

        return result;
      }

      if (result.llmAnalysis.shouldWarn) {
        result.hasWarnings = true;
        result.warnings.push(`LLM analysis warning: ${result.llmAnalysis.explanation}`);
      }
    } catch (error) {
      // Log error but don't block - fail open for LLM analysis errors
      result.hasWarnings = true;
      result.warnings.push(
        `LLM security analysis failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  // Step 4: Wrap external content if needed
  if (cfg.wrapExternalContent && requiresWrapping(result.source)) {
    result.processedContent = escapeForPrompt(result.processedContent, result.source);
    result.wrapped = true;
  }

  return result;
}

/**
 * Quick check if content should be blocked immediately.
 * Use this for fast path decisions without full analysis.
 */
export function shouldBlockImmediately(content: string): { block: boolean; reason?: string } {
  const scan = scanForInjection(content);

  if (scan.severity === "critical") {
    return {
      block: true,
      reason: `Critical security pattern: ${scan.patterns.join(", ")}`,
    };
  }

  return { block: false };
}

/**
 * Create a simple LLM provider wrapper from a completion function.
 */
export function createLLMProvider(
  completeFn: (prompt: string) => Promise<string>,
): InjectionLLMProvider {
  return { complete: completeFn };
}

// Re-export types for convenience
export type { ContentSource, TrustLevel } from "./source-classifier.js";
export type { InjectionLLMProvider, InjectionAnalysisResult } from "./injection-analyzer.js";
