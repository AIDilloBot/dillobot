#!/usr/bin/env npx ts-node
/**
 * DilloBot Upstream Sync Agent
 *
 * Uses Claude Code CLI to intelligently sync with upstream OpenClaw
 * while preserving DilloBot security patches.
 *
 * This uses YOUR Claude Code subscription - no API key needed.
 *
 * Usage:
 *   npx ts-node scripts/sync/upstream-sync-agent.ts
 *
 * Requirements:
 *   - Claude Code CLI installed and authenticated (`claude` command available)
 */

import { spawn, execSync } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

// ES module compatibility
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Configuration
const UPSTREAM_REPO = "https://github.com/openclaw/openclaw.git";
const UPSTREAM_BRANCH = "main";
const SECURITY_PATCHES_DOC = path.join(__dirname, "SECURITY_PATCHES.md");

// Files that contain DilloBot security modifications
const SECURITY_CRITICAL_FILES = [
  "src/gateway/server/ws-connection/message-handler.ts",
  "src/config/io.ts",
  "src/config/types.models.ts",
  "src/config/types.openclaw.ts",
  "src/config/types.auth.ts",             // SubscriptionCredential mode
  "src/agents/models-config.providers.ts",
  "src/agents/auth-profiles/types.ts",    // SubscriptionCredential type definition
  "src/auto-reply/dispatch.ts",           // Central security integration for ALL channels
  "src/cron/isolated-agent/run.ts",       // Security for email/webhook hooks
];

interface SyncResult {
  success: boolean;
  action: "no-updates" | "auto-merged" | "needs-review" | "error";
  summary: string;
  conflicts?: string[];
  appliedPatches?: string[];
  upstreamChanges?: string;
}

/**
 * Run a shell command and return output
 */
function run(cmd: string, options?: { cwd?: string; ignoreError?: boolean }): string {
  try {
    return execSync(cmd, {
      cwd: options?.cwd ?? process.cwd(),
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
    }).trim();
  } catch (error) {
    if (options?.ignoreError) {
      return "";
    }
    throw error;
  }
}

/**
 * Check if Claude Code CLI is available
 */
function isClaudeCodeAvailable(): boolean {
  try {
    run("claude --version");
    return true;
  } catch {
    return false;
  }
}

/**
 * Run Claude Code CLI with a prompt and get the response
 */
async function askClaude(prompt: string, options?: {
  allowedTools?: string[];
  maxTurns?: number;
}): Promise<string> {
  return new Promise((resolve, reject) => {
    const args = [
      "--print",  // Non-interactive mode, print response to stdout
    ];

    if (options?.allowedTools) {
      args.push("--allowedTools", options.allowedTools.join(","));
    }

    if (options?.maxTurns) {
      args.push("--max-turns", String(options.maxTurns));
    }

    // Add the prompt (must be last, as positional argument)
    args.push(prompt);

    const claude = spawn("claude", args, {
      stdio: ["pipe", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";

    claude.stdout.on("data", (data) => {
      stdout += data.toString();
    });

    claude.stderr.on("data", (data) => {
      stderr += data.toString();
    });

    claude.on("close", (code) => {
      if (code === 0) {
        resolve(stdout.trim());
      } else {
        reject(new Error(`Claude Code exited with code ${code}: ${stderr}`));
      }
    });

    claude.on("error", (err) => {
      reject(err);
    });
  });
}

/**
 * Check if upstream has new commits
 */
async function checkUpstreamUpdates(): Promise<{ hasUpdates: boolean; commitCount: number; summary: string }> {
  // Ensure upstream remote exists
  const remotes = run("git remote -v");
  if (!remotes.includes("upstream")) {
    run(`git remote add upstream ${UPSTREAM_REPO}`);
  }

  // Fetch upstream
  console.log("   Fetching upstream...");
  run("git fetch upstream");

  // Check for new commits
  const behindCount = run(`git rev-list --count HEAD..upstream/${UPSTREAM_BRANCH}`, { ignoreError: true });
  const commitCount = parseInt(behindCount || "0", 10);

  if (commitCount === 0) {
    return { hasUpdates: false, commitCount: 0, summary: "Already up to date with upstream." };
  }

  // Get commit summary
  const summary = run(`git log --oneline HEAD..upstream/${UPSTREAM_BRANCH}`);

  return { hasUpdates: true, commitCount, summary };
}

/**
 * Get the diff of upstream changes (limited to security-critical files to avoid buffer overflow)
 */
async function getUpstreamDiff(): Promise<string> {
  // Only get diff for security-critical files to avoid buffer overflow on large syncs
  const criticalFilesDiff = SECURITY_CRITICAL_FILES.map(
    (f) => run(`git diff HEAD..upstream/${UPSTREAM_BRANCH} -- "${f}"`, { ignoreError: true }),
  )
    .filter(Boolean)
    .join("\n");

  if (criticalFilesDiff) {
    return criticalFilesDiff;
  }

  // If no critical files changed, get a summary of all changes (stat only)
  return run(`git diff --stat HEAD..upstream/${UPSTREAM_BRANCH}`);
}

/**
 * Get list of files changed in upstream
 */
async function getChangedFiles(): Promise<string[]> {
  const output = run(`git diff --name-only HEAD..upstream/${UPSTREAM_BRANCH}`);
  return output.split("\n").filter(Boolean);
}

/**
 * Check which security-critical files have upstream changes
 */
async function checkSecurityFileChanges(): Promise<string[]> {
  const changedFiles = await getChangedFiles();
  return SECURITY_CRITICAL_FILES.filter((f) => changedFiles.includes(f));
}

/**
 * Load the security patches documentation
 */
async function loadSecurityPatchesDoc(): Promise<string> {
  return fs.readFile(SECURITY_PATCHES_DOC, "utf-8");
}

/**
 * Use Claude Code to analyze and plan the merge
 */
async function analyzeWithClaudeCode(
  upstreamDiff: string,
  changedSecurityFiles: string[],
  securityDoc: string,
): Promise<{
  canAutoMerge: boolean;
  plan: string;
  warnings: string[];
  filesToReview: string[];
  resolutions: Record<string, string>;
}> {
  const prompt = `You are helping maintain DilloBot, a security-hardened fork of OpenClaw.

CRITICAL SECURITY DOCUMENT - These patches MUST be preserved:
${securityDoc}

UPSTREAM CHANGES TO ANALYZE:

Security-Critical Files Changed: ${changedSecurityFiles.length > 0 ? changedSecurityFiles.join(", ") : "None"}

Diff (truncated if large):
\`\`\`diff
${upstreamDiff.slice(0, 30000)}${upstreamDiff.length > 30000 ? "\n... (truncated)" : ""}
\`\`\`

TASK: Analyze these upstream changes and determine:

1. Can these be safely auto-merged while preserving ALL security patches?
2. Which files need special attention or manual review?
3. For any conflicts in security-critical files, provide the EXACT merged content that preserves security.

Respond with a JSON object (no markdown, just raw JSON):
{
  "canAutoMerge": true/false,
  "plan": "description of merge strategy",
  "warnings": ["list of warnings"],
  "filesToReview": ["files needing manual review"],
  "resolutions": {
    "path/to/file.ts": "exact merged content if conflict resolution needed"
  }
}`;

  console.log("   Sending to Claude Code for analysis...");

  const response = await askClaude(prompt, {
    allowedTools: ["Read", "Grep", "Glob"],  // Allow Claude to read files if needed
    maxTurns: 3,
  });

  // Parse JSON from response (handle potential markdown wrapping)
  let jsonStr = response;
  const jsonMatch = jsonStr.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (jsonMatch) {
    jsonStr = jsonMatch[1];
  }

  // Try to find JSON object in response
  const jsonObjectMatch = jsonStr.match(/\{[\s\S]*\}/);
  if (jsonObjectMatch) {
    jsonStr = jsonObjectMatch[0];
  }

  try {
    return JSON.parse(jsonStr);
  } catch (e) {
    console.log("   Claude response (could not parse as JSON):", response.slice(0, 500));
    // Return safe defaults if parsing fails
    return {
      canAutoMerge: false,
      plan: "Could not parse Claude response - manual review recommended",
      warnings: ["Failed to parse Claude Code analysis"],
      filesToReview: changedSecurityFiles,
      resolutions: {},
    };
  }
}

/**
 * Verify security patches are intact after merge
 */
async function verifySecurityPatches(): Promise<{ valid: boolean; issues: string[] }> {
  const issues: string[] = [];

  // Check 1: Auto-approve disabled
  try {
    const messageHandler = await fs.readFile(
      "src/gateway/server/ws-connection/message-handler.ts",
      "utf-8",
    );
    if (messageHandler.includes("silent: isLocalClient")) {
      issues.push("CRITICAL: Auto-approve re-enabled in message-handler.ts");
    }
    if (!messageHandler.includes("silent: false")) {
      issues.push("CRITICAL: silent: false missing in message-handler.ts");
    }
  } catch {
    issues.push("ERROR: Could not read message-handler.ts");
  }

  // Check 2: Security policy enforcement
  try {
    const ioTs = await fs.readFile("src/config/io.ts", "utf-8");
    if (!ioTs.includes("enforceSecurityPolicy")) {
      issues.push("CRITICAL: enforceSecurityPolicy missing from io.ts");
    }
  } catch {
    issues.push("ERROR: Could not read io.ts");
  }

  // Check 3: Claude Code SDK types
  try {
    const typesModels = await fs.readFile("src/config/types.models.ts", "utf-8");
    if (!typesModels.includes("claude-code-agent")) {
      issues.push("WARNING: claude-code-agent missing from ModelApi");
    }
    if (!typesModels.includes("subscription")) {
      issues.push("WARNING: subscription missing from ModelProviderAuthMode");
    }
  } catch {
    issues.push("ERROR: Could not read types.models.ts");
  }

  // Check 4: Security module exists
  try {
    await fs.access("src/security-hardening/index.ts");
  } catch {
    issues.push("CRITICAL: security-hardening module missing");
  }

  // Check 5: Claude Code SDK files
  try {
    await fs.access("src/agents/claude-code-sdk-auth.ts");
    await fs.access("src/agents/claude-code-sdk-runner.ts");
  } catch {
    issues.push("WARNING: Claude Code SDK files missing");
  }

  return {
    valid: issues.filter((i) => i.startsWith("CRITICAL")).length === 0,
    issues,
  };
}

/**
 * Attempt automatic merge with security preservation
 */
async function attemptAutoMerge(): Promise<{ success: boolean; conflicts: string[] }> {
  try {
    // Try to merge upstream
    run(`git merge upstream/${UPSTREAM_BRANCH} --no-edit`);
    return { success: true, conflicts: [] };
  } catch {
    // Get list of conflicted files
    const status = run("git status --porcelain", { ignoreError: true });
    const conflicts = status
      .split("\n")
      .filter((line) => line.startsWith("UU") || line.startsWith("AA"))
      .map((line) => line.slice(3).trim());

    // Abort the merge
    run("git merge --abort", { ignoreError: true });

    return { success: false, conflicts };
  }
}

/**
 * Apply a resolved conflict
 */
async function applyResolution(file: string, content: string): Promise<void> {
  await fs.writeFile(file, content, "utf-8");
  run(`git add ${file}`);
}

/**
 * Main sync function
 */
async function syncWithUpstream(): Promise<SyncResult> {
  console.log("🔄 DilloBot Upstream Sync Agent (Claude Code)\n");

  // Check Claude Code CLI is available
  if (!isClaudeCodeAvailable()) {
    console.log("❌ Claude Code CLI not found!");
    console.log("   Install: npm install -g @anthropic-ai/claude-code");
    console.log("   Then authenticate: claude login");
    return {
      success: false,
      action: "error",
      summary: "Claude Code CLI not available. Install and authenticate first.",
    };
  }
  console.log("✅ Claude Code CLI available\n");

  // Step 1: Check for upstream updates
  console.log("📡 Checking for upstream updates...");
  const updates = await checkUpstreamUpdates();

  if (!updates.hasUpdates) {
    console.log("✅ Already up to date with upstream OpenClaw\n");
    return {
      success: true,
      action: "no-updates",
      summary: "No upstream updates available.",
    };
  }

  console.log(`📦 Found ${updates.commitCount} new commits from upstream:\n`);
  console.log(updates.summary);
  console.log("");

  // Step 2: Analyze changes
  console.log("🔍 Analyzing upstream changes...");
  const changedSecurityFiles = await checkSecurityFileChanges();
  const securityDoc = await loadSecurityPatchesDoc();

  if (changedSecurityFiles.length > 0) {
    console.log(`⚠️  Security-critical files changed: ${changedSecurityFiles.join(", ")}\n`);
  }

  // Step 3: If no security files changed, try simple merge first
  if (changedSecurityFiles.length === 0) {
    console.log("🔀 No security files affected, attempting simple merge...");
    const mergeResult = await attemptAutoMerge();

    if (mergeResult.success) {
      const verification = await verifySecurityPatches();
      if (verification.valid) {
        // Update README with version info and amend the merge commit
        const readmeUpdated = await updateReadmeVersion();
        if (readmeUpdated) {
          run('git commit --amend --no-edit');
        }
        console.log("✅ Simple merge successful! Security patches intact.\n");
        return {
          success: true,
          action: "auto-merged",
          summary: `Successfully merged ${updates.commitCount} upstream commits (no conflicts).`,
          upstreamChanges: updates.summary,
        };
      }
    }
  }

  // Step 4: Use Claude Code to analyze and plan merge
  console.log("🤖 Consulting Claude Code for merge strategy...");
  const upstreamDiff = await getUpstreamDiff();
  const analysis = await analyzeWithClaudeCode(upstreamDiff, changedSecurityFiles, securityDoc);

  console.log(`\n📋 Claude's Merge Plan:\n${analysis.plan}\n`);

  if (analysis.warnings.length > 0) {
    console.log("⚠️  Warnings:");
    analysis.warnings.forEach((w) => console.log(`   - ${w}`));
    console.log("");
  }

  // Step 5: Attempt merge with Claude's guidance
  if (analysis.canAutoMerge) {
    console.log("🔀 Attempting merge with Claude Code guidance...");

    // Start merge (may have conflicts)
    const mergeResult = await attemptAutoMerge();

    if (mergeResult.success) {
      // Simple merge worked
      const verification = await verifySecurityPatches();
      if (verification.valid) {
        // Update README with version info and amend the merge commit
        const readmeUpdated = await updateReadmeVersion();
        if (readmeUpdated) {
          run('git commit --amend --no-edit');
        }
        console.log("✅ Merge successful! All security patches intact.\n");
        return {
          success: true,
          action: "auto-merged",
          summary: `Successfully merged ${updates.commitCount} upstream commits.`,
          upstreamChanges: updates.summary,
        };
      } else {
        // Rollback - security damaged
        console.log("❌ Security patches damaged! Rolling back...");
        run("git reset --hard HEAD~1");
      }
    } else if (Object.keys(analysis.resolutions).length > 0) {
      // Apply Claude's resolutions
      console.log("📝 Applying Claude Code's conflict resolutions...");

      run(`git merge upstream/${UPSTREAM_BRANCH} --no-commit`, { ignoreError: true });

      for (const [file, content] of Object.entries(analysis.resolutions)) {
        if (content && mergeResult.conflicts.includes(file)) {
          await applyResolution(file, content);
          console.log(`   ✅ Applied resolution for ${file}`);
        }
      }

      // Check remaining conflicts
      const status = run("git status --porcelain", { ignoreError: true });
      const remainingConflicts = status
        .split("\n")
        .filter((line) => line.startsWith("UU"))
        .map((line) => line.slice(3).trim());

      if (remainingConflicts.length === 0) {
        // Verify and commit
        const verification = await verifySecurityPatches();
        if (verification.valid) {
          // Update README with version info before committing
          await updateReadmeVersion();
          run('git commit -m "Merge upstream OpenClaw (DilloBot auto-sync via Claude Code)"');
          console.log("\n✅ Merge successful with Claude Code conflict resolution!\n");
          return {
            success: true,
            action: "auto-merged",
            summary: `Merged ${updates.commitCount} commits with Claude Code-assisted resolution.`,
            appliedPatches: Object.keys(analysis.resolutions),
            upstreamChanges: updates.summary,
          };
        }
      }

      // Abort if we couldn't resolve everything
      run("git merge --abort", { ignoreError: true });
    }
  }

  // Manual review needed
  console.log("\n⚠️  Manual review required\n");
  return {
    success: false,
    action: "needs-review",
    summary: `${analysis.filesToReview.length} files need manual review.`,
    conflicts: [
      ...analysis.filesToReview.map((f) => `File needs review: ${f}`),
      ...analysis.warnings,
    ],
    upstreamChanges: updates.summary,
  };
}

/**
 * Get upstream version info
 */
function getUpstreamVersionInfo(): {
  version: string;
  commit: string;
  commitShort: string;
  date: string;
  behindCount: number;
} {
  // Get the latest upstream tag/version
  const version = run(`git describe --tags upstream/${UPSTREAM_BRANCH} 2>/dev/null || echo "unknown"`, {
    ignoreError: true,
  }) || "unknown";

  // Get the upstream HEAD commit
  const commit = run(`git rev-parse upstream/${UPSTREAM_BRANCH}`, { ignoreError: true }) || "unknown";
  const commitShort = commit.slice(0, 7);

  // Get the commit date
  const dateRaw = run(`git log -1 --format=%ci upstream/${UPSTREAM_BRANCH}`, { ignoreError: true });
  const date = dateRaw ? dateRaw.split(" ")[0] : new Date().toISOString().split("T")[0];

  // Get how many commits we're behind (should be 0 after sync)
  const behindCount = parseInt(
    run(`git rev-list --count HEAD..upstream/${UPSTREAM_BRANCH}`, { ignoreError: true }) || "0",
    10,
  );

  return { version, commit, commitShort, date, behindCount };
}

/**
 * Update README with upstream version info
 */
async function updateReadmeVersion(): Promise<boolean> {
  const readmePath = "README.md";

  try {
    let readme = await fs.readFile(readmePath, "utf-8");

    const versionInfo = getUpstreamVersionInfo();
    const today = new Date().toISOString().split("T")[0];

    // Build the new version block
    const newVersionBlock = `<!-- DILLOBOT-UPSTREAM-VERSION-START -->
| | |
|---|---|
| **Based on OpenClaw** | \`${versionInfo.version}\` |
| **Upstream Commit** | [\`${versionInfo.commitShort}\`](https://github.com/openclaw/openclaw/commit/${versionInfo.commit}) |
| **Last Synced** | ${today} |
| **Commits Behind** | ${versionInfo.behindCount} |
<!-- DILLOBOT-UPSTREAM-VERSION-END -->`;

    // Replace the version block
    const versionRegex = /<!-- DILLOBOT-UPSTREAM-VERSION-START -->[\s\S]*?<!-- DILLOBOT-UPSTREAM-VERSION-END -->/;

    if (versionRegex.test(readme)) {
      readme = readme.replace(versionRegex, newVersionBlock);
      await fs.writeFile(readmePath, readme, "utf-8");

      // Stage the README change
      run(`git add ${readmePath}`);

      console.log(`📝 Updated README.md with upstream version: ${versionInfo.version} (${versionInfo.commitShort})`);
      return true;
    } else {
      console.log("⚠️  Could not find version block in README.md");
      return false;
    }
  } catch (error) {
    console.log("⚠️  Could not update README.md:", error);
    return false;
  }
}

/**
 * Generate sync report
 */
function generateReport(result: SyncResult): string {
  const timestamp = new Date().toISOString();
  let report = `# DilloBot Sync Report (Claude Code)\n\n`;
  report += `**Timestamp:** ${timestamp}\n`;
  report += `**Status:** ${result.success ? "✅ Success" : "❌ Action Required"}\n`;
  report += `**Action:** ${result.action}\n\n`;
  report += `## Summary\n\n${result.summary}\n\n`;

  if (result.upstreamChanges) {
    report += `## Upstream Changes\n\n\`\`\`\n${result.upstreamChanges}\n\`\`\`\n\n`;
  }

  if (result.conflicts && result.conflicts.length > 0) {
    report += `## Conflicts / Issues\n\n`;
    result.conflicts.forEach((c) => {
      report += `- ${c}\n`;
    });
    report += "\n";
  }

  if (result.appliedPatches && result.appliedPatches.length > 0) {
    report += `## Applied Resolutions\n\n`;
    result.appliedPatches.forEach((p) => {
      report += `- ${p}\n`;
    });
  }

  return report;
}

// Main execution
async function main() {
  try {
    const result = await syncWithUpstream();
    const report = generateReport(result);

    // Save report
    const reportPath = `sync-report-${Date.now()}.md`;
    await fs.writeFile(reportPath, report, "utf-8");
    console.log(`📄 Report saved to: ${reportPath}`);

    // Print summary
    console.log("\n" + "=".repeat(50));
    console.log(result.success ? "✅ SYNC COMPLETE" : "⚠️ ACTION REQUIRED");
    console.log("=".repeat(50));

    // Exit with appropriate code
    process.exit(result.success ? 0 : 1);
  } catch (error) {
    console.error("❌ Sync failed with error:", error);
    process.exit(1);
  }
}

main();
