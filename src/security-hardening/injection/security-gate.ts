/**
 * Security Gate
 *
 * Main entry point for LLM-based security analysis.
 * Checks content for prompt injection and blocks if detected.
 *
 * This runs OUT-OF-BAND from the main agent - the full agent system
 * never sees potentially malicious content.
 */

import { logWarn } from "../../logger.js";
import {
  analyzeForInjection,
  canSkipAnalysis,
  type InjectionAnalysisResult,
} from "./injection-analyzer.js";
import { scanForInjection } from "./injection-filter.js";
import { isClaudeAgentSdkProvider, resolveSecurityLLMProvider } from "./llm-security-provider.js";
import { classifySource, getTrustLevel, type ContentSource } from "./source-classifier.js";

/**
 * Result of security gate check.
 */
export interface SecurityGateResult {
  /** Whether the content is allowed to proceed */
  allowed: boolean;
  /** Whether content was blocked */
  blocked: boolean;
  /** Alert message to send to user (if blocked) */
  alertMessage?: string;
  /** Reason for blocking */
  blockReason?: string;
  /** Source classification */
  source: ContentSource;
  /** Trust level */
  trustLevel: "high" | "medium" | "low";
  /** LLM analysis result (if performed) */
  llmAnalysis?: InjectionAnalysisResult;
  /** Quick filter patterns detected */
  quickFilterPatterns: string[];
}

/**
 * Configuration for security gate.
 */
export interface SecurityGateConfig {
  /** The LLM provider being used (e.g., "claude-code-agent", "anthropic") */
  provider: string;
  /** Session key for source classification */
  sessionKey: string;
  /** Sender ID for logging */
  senderId?: string;
  /** Channel for logging */
  channel?: string;
  /** API keys for non-Claude providers */
  apiKeys?: {
    anthropic?: string;
    openai?: string;
  };
  /** Model to use for security analysis */
  model?: string;
  /** Whether to run LLM analysis (default: true for low-trust sources) */
  enableLLMAnalysis?: boolean;
}

/**
 * Format alert message for blocked injection attempt.
 */
function formatBlockedAlert(result: SecurityGateResult, senderId?: string): string {
  const lines: string[] = ["⚠️ **Security Alert: Prompt Injection Blocked**", ""];

  if (result.llmAnalysis) {
    lines.push(`Risk Level: ${result.llmAnalysis.riskLevel.toUpperCase()}`);
    lines.push(`Intent: ${result.llmAnalysis.intent}`);
    if (result.llmAnalysis.category) {
      lines.push(`Category: ${result.llmAnalysis.category}`);
    }
    lines.push("");
    lines.push(result.llmAnalysis.explanation);
  } else if (result.quickFilterPatterns.length > 0) {
    lines.push(`Detected patterns: ${result.quickFilterPatterns.join(", ")}`);
  }

  lines.push("");
  lines.push("The message was blocked and not processed by the agent.");

  if (senderId) {
    lines.push("");
    lines.push(`Source: ${senderId}`);
  }

  return lines.join("\n");
}

/**
 * Run security gate check on content.
 *
 * This is the main entry point for security analysis. It:
 * 1. Classifies the source and determines trust level
 * 2. Runs quick regex filter for critical patterns
 * 3. For low-trust or suspicious content, runs LLM analysis
 * 4. If injection detected, blocks and returns alert message
 *
 * The agent system NEVER sees blocked content.
 *
 * @param content The content to check
 * @param config Security gate configuration
 * @returns Security gate result
 */
export async function runSecurityGate(
  content: string,
  config: SecurityGateConfig,
): Promise<SecurityGateResult> {
  const result: SecurityGateResult = {
    allowed: true,
    blocked: false,
    source: "unknown",
    trustLevel: "low",
    quickFilterPatterns: [],
  };

  // Step 1: Classify source
  result.source = classifySource(config.sessionKey);
  result.trustLevel = getTrustLevel(result.source);

  // Step 2: Run quick filter
  const quickScan = scanForInjection(content);
  if (quickScan.detected) {
    result.quickFilterPatterns = quickScan.patterns;

    // Only log medium+ severity patterns to avoid spam from benign patterns
    // like tag_chars which appear in legitimate Slack/Telegram messages
    if (quickScan.severity !== "low") {
      logWarn(
        `[security-gate] Quick filter detected: ${quickScan.patterns.join(", ")} ` +
          `(severity: ${quickScan.severity}, session: ${config.sessionKey})`,
      );
    }

    // Block on critical patterns immediately
    if (quickScan.severity === "critical") {
      result.allowed = false;
      result.blocked = true;
      result.blockReason = `Critical security pattern: ${quickScan.patterns.join(", ")}`;
      result.alertMessage = formatBlockedAlert(result, config.senderId);
      return result;
    }
  }

  // Step 3: Determine if LLM analysis is needed
  const shouldRunLLMAnalysis =
    config.enableLLMAnalysis !== false && // Not explicitly disabled
    !canSkipAnalysis(content) && // Content is substantial enough
    (result.trustLevel === "low" || // Low-trust source
      quickScan.severity === "medium" || // Medium-risk patterns detected
      quickScan.severity === "high"); // High-risk patterns detected

  if (!shouldRunLLMAnalysis) {
    return result;
  }

  // Step 4: Get LLM provider for security analysis
  const llmProvider = resolveSecurityLLMProvider(config.provider, {
    anthropicApiKey: config.apiKeys?.anthropic,
    openaiApiKey: config.apiKeys?.openai,
    model: config.model,
  });

  if (!llmProvider) {
    logWarn(
      `[security-gate] No LLM provider available for security analysis ` +
        `(provider: ${config.provider})`,
    );
    return result;
  }

  // Step 5: Run LLM analysis
  try {
    result.llmAnalysis = await analyzeForInjection(content, result.source, llmProvider, {
      blockThreshold: "high", // Block on high or critical
      warnThreshold: "medium",
      maxContentLength: 50000,
    });

    // Step 6: Check if we should block
    if (result.llmAnalysis.shouldBlock) {
      result.allowed = false;
      result.blocked = true;
      result.blockReason = result.llmAnalysis.explanation;
      result.alertMessage = formatBlockedAlert(result, config.senderId);

      logWarn(
        `[security-gate] BLOCKED by LLM analysis: ${result.llmAnalysis.explanation} ` +
          `(intent: ${result.llmAnalysis.intent}, category: ${result.llmAnalysis.category}, ` +
          `session: ${config.sessionKey})`,
      );
    } else if (result.llmAnalysis.shouldWarn) {
      logWarn(
        `[security-gate] LLM analysis warning: ${result.llmAnalysis.explanation} ` +
          `(session: ${config.sessionKey})`,
      );
    }
  } catch (error) {
    // Log error but don't block - fail open for LLM analysis errors
    logWarn(
      `[security-gate] LLM analysis failed: ${error instanceof Error ? error.message : String(error)} ` +
        `(session: ${config.sessionKey})`,
    );
  }

  return result;
}

/**
 * Quick check for immediate blocking without LLM analysis.
 * Use this for fast-path decisions.
 */
export function shouldBlockQuickly(content: string): {
  block: boolean;
  reason?: string;
  patterns?: string[];
} {
  const scan = scanForInjection(content);

  if (scan.severity === "critical") {
    return {
      block: true,
      reason: `Critical security pattern: ${scan.patterns.join(", ")}`,
      patterns: scan.patterns,
    };
  }

  return { block: false };
}
