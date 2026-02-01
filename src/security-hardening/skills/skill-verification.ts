/**
 * DilloBot Skill Verification
 *
 * Provides LLM-based security inspection for skills before installation.
 * Replaces checksum-based verification with intelligent content analysis.
 */

import type { Skill } from "@mariozechner/pi-coding-agent";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import {
  type SkillContent,
  type SkillInspectionResult,
  type InspectionLLMProvider,
  inspectSkill,
  skillToContent,
  quickSecurityCheck,
  formatInspectionResults,
} from "./skill-inspector.js";

/**
 * Result of skill verification.
 */
export interface SkillVerificationResult {
  /** Whether the skill is approved for installation */
  approved: boolean;
  /** Whether user explicitly bypassed warnings */
  bypassed: boolean;
  /** The inspection result */
  inspection: SkillInspectionResult;
  /** Formatted message for display */
  message: string;
}

/**
 * User decision callback for skill installation.
 */
export type SkillInstallDecision = (
  skillName: string,
  inspection: SkillInspectionResult,
  formattedResults: string,
) => Promise<"install" | "skip" | "cancel">;

/**
 * Configuration for skill verification.
 */
export interface SkillVerificationConfig {
  /** Whether verification is enabled */
  enabled: boolean;
  /** LLM provider for inspection */
  llmProvider?: InspectionLLMProvider;
  /** Callback for user decisions */
  onDecisionNeeded?: SkillInstallDecision;
  /** Skip verification for bundled skills */
  trustBundledSkills: boolean;
  /** Skills to always trust (by name) */
  trustedSkills: string[];
  /** Skip LLM analysis and only do quick check */
  quickCheckOnly: boolean;
}

/**
 * Default verification config.
 */
export const DEFAULT_VERIFICATION_CONFIG: SkillVerificationConfig = {
  enabled: true,
  trustBundledSkills: true,
  trustedSkills: [],
  quickCheckOnly: false,
};

/**
 * In-memory cache of verified skills (by content hash).
 */
const verifiedSkillsCache = new Map<string, SkillVerificationResult>();

/**
 * Compute a hash of skill content for caching.
 */
function hashSkillContent(skill: SkillContent): string {
  const content = JSON.stringify({
    name: skill.name,
    prompt: skill.prompt,
    description: skill.description,
  });
  return crypto.createHash("sha256").update(content).digest("hex").slice(0, 16);
}

/**
 * Check if a skill is in the trusted list.
 */
function isSkillTrusted(skillName: string, config: SkillVerificationConfig): boolean {
  return config.trustedSkills.some((trusted) => trusted.toLowerCase() === skillName.toLowerCase());
}

/**
 * Check if a skill path indicates it's a bundled skill.
 */
function isBundledSkill(sourcePath?: string): boolean {
  if (!sourcePath) return false;
  // Bundled skills are typically in node_modules or the package's skills directory
  return (
    sourcePath.includes("node_modules") ||
    sourcePath.includes("/dist/skills/") ||
    sourcePath.includes("/skills/bundled/")
  );
}

/**
 * Verify a skill before installation.
 *
 * @param skill The skill to verify
 * @param sourcePath Source path of the skill
 * @param config Verification configuration
 * @returns Verification result
 */
export async function verifySkillForInstallation(
  skill: Skill,
  sourcePath: string | undefined,
  config: SkillVerificationConfig = DEFAULT_VERIFICATION_CONFIG,
): Promise<SkillVerificationResult> {
  // Check if verification is disabled
  if (!config.enabled) {
    return {
      approved: true,
      bypassed: false,
      inspection: {
        safe: true,
        riskLevel: "none",
        findings: [],
        summary: "Verification disabled.",
        bypassAllowed: true,
      },
      message: "Skill verification is disabled.",
    };
  }

  // Check if skill is trusted
  if (isSkillTrusted(skill.name, config)) {
    return {
      approved: true,
      bypassed: false,
      inspection: {
        safe: true,
        riskLevel: "none",
        findings: [],
        summary: "Skill is in trusted list.",
        bypassAllowed: true,
      },
      message: `Skill "${skill.name}" is trusted.`,
    };
  }

  // Check if it's a bundled skill and we trust those
  if (config.trustBundledSkills && isBundledSkill(sourcePath)) {
    return {
      approved: true,
      bypassed: false,
      inspection: {
        safe: true,
        riskLevel: "none",
        findings: [],
        summary: "Bundled skill - trusted by default.",
        bypassAllowed: true,
      },
      message: `Skill "${skill.name}" is bundled and trusted.`,
    };
  }

  // Convert to content for inspection (reads the skill file)
  const content = await skillToContent(skill, sourcePath);
  const contentHash = hashSkillContent(content);

  // Check cache
  const cached = verifiedSkillsCache.get(contentHash);
  if (cached) {
    return cached;
  }

  // Quick security check first (fast, no LLM needed)
  const quickCheck = quickSecurityCheck(content.prompt);
  if (quickCheck.hasRedFlags) {
    const inspection: SkillInspectionResult = {
      safe: false,
      riskLevel: "high",
      findings: quickCheck.flags.map((flag) => ({
        type: "suspicious_pattern" as const,
        severity: "high" as const,
        description: `Detected red flag: ${flag}`,
      })),
      summary: `Quick scan found ${quickCheck.flags.length} security red flag(s).`,
      bypassAllowed: true,
    };

    // If no LLM provider or quick check only, return quick check results
    if (!config.llmProvider || config.quickCheckOnly) {
      const formattedResults = formatInspectionResults(inspection, skill.name);

      // Ask user if decision callback is provided
      if (config.onDecisionNeeded && inspection.bypassAllowed) {
        const decision = await config.onDecisionNeeded(skill.name, inspection, formattedResults);

        const result: SkillVerificationResult = {
          approved: decision === "install",
          bypassed: decision === "install",
          inspection,
          message: formattedResults,
        };

        if (result.approved) {
          verifiedSkillsCache.set(contentHash, result);
        }

        return result;
      }

      return {
        approved: false,
        bypassed: false,
        inspection,
        message: formattedResults,
      };
    }
  }

  // Full LLM inspection
  if (config.llmProvider) {
    const inspection = await inspectSkill(content, config.llmProvider);
    const formattedResults = formatInspectionResults(inspection, skill.name);

    // If safe, approve automatically
    if (inspection.safe) {
      const result: SkillVerificationResult = {
        approved: true,
        bypassed: false,
        inspection,
        message: formattedResults,
      };
      verifiedSkillsCache.set(contentHash, result);
      return result;
    }

    // Not safe - ask user if callback provided
    if (config.onDecisionNeeded && inspection.bypassAllowed) {
      const decision = await config.onDecisionNeeded(skill.name, inspection, formattedResults);

      const result: SkillVerificationResult = {
        approved: decision === "install",
        bypassed: decision === "install",
        inspection,
        message: formattedResults,
      };

      if (result.approved) {
        verifiedSkillsCache.set(contentHash, result);
      }

      return result;
    }

    // Critical issues or no callback - block installation
    return {
      approved: false,
      bypassed: false,
      inspection,
      message: formattedResults,
    };
  }

  // No LLM provider and no red flags in quick check - allow with warning
  const noLlmInspection: SkillInspectionResult = {
    safe: true,
    riskLevel: "low",
    findings: [],
    summary: "Quick scan passed. Full LLM analysis not available.",
    bypassAllowed: true,
  };

  return {
    approved: true,
    bypassed: false,
    inspection: noLlmInspection,
    message: `Skill "${skill.name}" passed quick security scan. LLM analysis unavailable.`,
  };
}

/**
 * Clear the verification cache.
 */
export function clearVerificationCache(): void {
  verifiedSkillsCache.clear();
}

/**
 * Add a skill to the trusted list.
 */
export function trustSkill(skillName: string, config: SkillVerificationConfig): void {
  if (!config.trustedSkills.includes(skillName)) {
    config.trustedSkills.push(skillName);
  }
}

/**
 * Remove a skill from the trusted list.
 */
export function untrustSkill(skillName: string, config: SkillVerificationConfig): void {
  const index = config.trustedSkills.indexOf(skillName);
  if (index >= 0) {
    config.trustedSkills.splice(index, 1);
  }
}

// Re-export inspector types and functions
export {
  type SkillContent,
  type SkillInspectionResult,
  type SkillSecurityFinding,
  type SkillRiskLevel,
  type InspectionLLMProvider,
  inspectSkill,
  skillToContent,
  quickSecurityCheck,
  formatInspectionResults,
} from "./skill-inspector.js";
