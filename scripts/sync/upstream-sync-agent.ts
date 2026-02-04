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

// Files that must NEVER be merged from upstream (security risk)
const BLOCKED_FILES = [
  "src/hooks/soul-evil.ts",
  "src/hooks/soul-evil.test.ts",
  "docs/hooks/soul-evil.md",
];

// Files that contain DilloBot security modifications
const SECURITY_CRITICAL_FILES = [
  "src/gateway/server/ws-connection/message-handler.ts",
  "src/config/io.ts",
  "src/config/types.models.ts",
  "src/config/types.openclaw.ts",
  "src/config/types.auth.ts",             // SubscriptionCredential mode
  "src/config/zod-schema.ts",             // Must include subscription in auth mode union
  "src/agents/models-config.providers.ts",
  "src/agents/auth-profiles/types.ts",    // SubscriptionCredential type definition
  "src/auto-reply/dispatch.ts",           // Central security integration for ALL channels
  "src/cron/isolated-agent/run.ts",       // Security for email/webhook hooks
  "src/infra/device-pairing.ts",          // isFirstRun function for first-run only auto-approve
  "src/cli/devices-cli.ts",               // Local-only device approval commands
  "ui/src/ui/views/overview.ts",          // Dashboard pairing instructions + branding
  "ui/src/ui/app-render.ts",              // Dashboard branding (logo, title, docs links)
  "ui/src/ui/app.ts",                     // Custom element registration
  "ui/src/styles/base.css",               // DilloBot colors and custom element styles
  "ui/index.html",                        // Page title and custom element
  // Claude Agent SDK integration (core DilloBot feature)
  "src/agents/claude-code-sdk-auth.ts",   // SDK authentication helpers
  "src/agents/claude-code-sdk-runner.ts", // SDK query runner
  "src/agents/pi-embedded-runner/run.ts", // SDK integration hook
  "src/commands/auth-choice.apply.claude-code-sdk.ts", // SDK auth choice handler
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
 * Format elapsed time in human-readable format
 */
function formatElapsed(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  if (minutes > 0) {
    return `${minutes}m ${remainingSeconds}s`;
  }
  return `${seconds}s`;
}

/**
 * Run Claude Code CLI with a prompt and get the response
 * Spawns claude directly (no shell) to avoid backtick/variable interpretation issues
 */
async function askClaude(prompt: string, options?: {
  allowedTools?: string[];
  maxTurns?: number;
}): Promise<string> {
  // Save prompt to temp file for debugging (optional manual testing)
  const tempDir = process.env.TMPDIR || "/tmp";
  const tempFile = path.join(tempDir, `dillobot-sync-prompt-${Date.now()}.txt`);
  await fs.writeFile(tempFile, prompt, "utf-8");
  console.log(`   📁 Prompt saved to: ${tempFile} (${Math.round(prompt.length / 1024)}KB)`);

  return new Promise((resolve, reject) => {
    const claudeArgs: string[] = [
      "--print",  // Non-interactive mode, print response to stdout
    ];

    if (options?.allowedTools) {
      claudeArgs.push("--allowedTools", options.allowedTools.join(","));
    }

    if (options?.maxTurns) {
      claudeArgs.push("--max-turns", String(options.maxTurns));
    }

    // Spawn claude directly (no shell) - this passes the prompt as a raw argument
    // without any shell interpretation of backticks, $, etc.
    const proc = spawn("claude", [...claudeArgs, "--", prompt], {
      stdio: ["pipe", "pipe", "pipe"],
    });

    // Cleanup temp file when done
    const cleanup = () => {
      fs.unlink(tempFile).catch(() => {});
    };

    const startTime = Date.now();
    let stdout = "";
    let stderr = "";
    let lastActivity = Date.now();
    let bytesReceived = 0;

    // Progress indicator
    const progressChars = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
    let progressIndex = 0;

    const progressInterval = setInterval(() => {
      const elapsed = Date.now() - startTime;
      const sinceActivity = Date.now() - lastActivity;
      const spinner = progressChars[progressIndex % progressChars.length];
      progressIndex++;

      // Build status line
      let status = `   ${spinner} Claude Code analyzing... (${formatElapsed(elapsed)})`;
      if (bytesReceived > 0) {
        status += ` | ${bytesReceived} bytes received`;
      }
      if (sinceActivity > 10000) {
        status += ` | waiting for API response...`;
      }

      // Clear line and write status
      process.stdout.write(`\r${status.padEnd(80)}`);
    }, 250);

    proc.stdout.on("data", (data) => {
      const chunk = data.toString();
      stdout += chunk;
      bytesReceived += chunk.length;
      lastActivity = Date.now();
    });

    proc.stderr.on("data", (data) => {
      const chunk = data.toString();
      stderr += chunk;
      lastActivity = Date.now();
      // Show any error output immediately
      if (chunk.trim()) {
        process.stdout.write(`\r   ⚠️  ${chunk.trim().slice(0, 60).padEnd(70)}\n`);
      }
    });

    proc.on("close", (code) => {
      clearInterval(progressInterval);
      cleanup();
      const elapsed = Date.now() - startTime;
      // Clear the progress line
      process.stdout.write(`\r${" ".repeat(80)}\r`);

      if (code === 0) {
        console.log(`   ✅ Claude Code completed in ${formatElapsed(elapsed)}`);
        resolve(stdout.trim());
      } else {
        console.log(`   ❌ Claude Code failed after ${formatElapsed(elapsed)}`);
        reject(new Error(`Claude Code exited with code ${code}: ${stderr}`));
      }
    });

    proc.on("error", (err) => {
      clearInterval(progressInterval);
      cleanup();
      process.stdout.write(`\r${" ".repeat(80)}\r`);
      console.log(`   ❌ Failed to start Claude Code: ${err.message}`);
      reject(err);
    });

    // Log process info for debugging
    console.log(`   📍 Started shell process (PID: ${proc.pid})`);
    console.log(`   💡 To check Claude: ps aux | grep claude`);
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
 * Create a timestamped backup branch before sync
 */
function createBackupBranch(): string | null {
  try {
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
    const branchName = `backup-before-sync-${timestamp}`;
    run(`git branch ${branchName}`);
    return branchName;
  } catch (error) {
    console.log("⚠️  Could not create backup branch:", error);
    return null;
  }
}

/**
 * Check if upstream is trying to add blocked files
 */
async function checkBlockedFileChanges(): Promise<string[]> {
  const changedFiles = await getChangedFiles();
  return BLOCKED_FILES.filter((f) => changedFiles.includes(f));
}

/**
 * Remove blocked files if they exist after merge
 */
async function removeBlockedFiles(): Promise<string[]> {
  const removed: string[] = [];
  for (const file of BLOCKED_FILES) {
    try {
      await fs.access(file);
      await fs.unlink(file);
      run(`git add ${file}`, { ignoreError: true });
      removed.push(file);
      console.log(`   🗑️  Removed blocked file: ${file}`);
    } catch {
      // File doesn't exist, which is good
    }
  }
  return removed;
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

  console.log("   📤 Sending to Claude Code for merge analysis...");
  console.log(`   📊 Prompt size: ${Math.round(prompt.length / 1024)}KB | Security files: ${changedSecurityFiles.length} | Diff size: ${Math.round(upstreamDiff.length / 1024)}KB`);
  console.log("");

  const response = await askClaude(prompt, {
    allowedTools: ["Read", "Grep", "Glob"],  // Allow Claude to read files if needed
  });

  console.log(`   📥 Response received: ${Math.round(response.length / 1024)}KB`);

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

  // Check 1: First-run only auto-approve
  try {
    const messageHandler = await fs.readFile(
      "src/gateway/server/ws-connection/message-handler.ts",
      "utf-8",
    );
    // Check for first-run only auto-approve (isLocalClient && isFirstRun)
    if (messageHandler.includes("isLocalClient && (await isFirstRun())")) {
      // Good - first-run only auto-approve is in place
    } else if (messageHandler.includes("silent: isLocalClient,") || messageHandler.includes("silent: isLocalClient ")) {
      // Bad - unrestricted local auto-approve (VPS vulnerability)
      issues.push("CRITICAL: Unsafe auto-approve! isLocalClient without isFirstRun check");
    } else if (!messageHandler.includes("isFirstRun")) {
      issues.push("WARNING: isFirstRun not found in message-handler.ts - check auto-approve logic");
    }
  } catch {
    issues.push("ERROR: Could not read message-handler.ts");
  }

  // Check 1b: isFirstRun function in device-pairing.ts
  try {
    const devicePairing = await fs.readFile("src/infra/device-pairing.ts", "utf-8");
    if (!devicePairing.includes("export async function isFirstRun")) {
      issues.push("CRITICAL: isFirstRun function missing from device-pairing.ts");
    }
  } catch {
    issues.push("ERROR: Could not read device-pairing.ts");
  }

  // Check 1c: Local-only device CLI commands
  try {
    const devicesCli = await fs.readFile("src/cli/devices-cli.ts", "utf-8");
    if (!devicesCli.includes("local-list")) {
      issues.push("CRITICAL: local-list command missing from devices-cli.ts");
    }
    if (!devicesCli.includes("local-approve")) {
      issues.push("CRITICAL: local-approve command missing from devices-cli.ts");
    }
  } catch {
    issues.push("ERROR: Could not read devices-cli.ts");
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

  // Check 3b: Zod schema includes subscription mode
  try {
    const zodSchema = await fs.readFile("src/config/zod-schema.ts", "utf-8");
    if (!zodSchema.includes('z.literal("subscription")')) {
      issues.push("CRITICAL: subscription mode missing from Zod schema - config validation will fail");
    }
  } catch {
    issues.push("ERROR: Could not read zod-schema.ts");
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

  // Check 5b: Claude Agent SDK integration in pi-embedded-runner
  try {
    const runTs = await fs.readFile("src/agents/pi-embedded-runner/run.ts", "utf-8");
    if (!runTs.includes("isClaudeCodeSdkProvider")) {
      issues.push("CRITICAL: isClaudeCodeSdkProvider import missing from pi-embedded-runner/run.ts");
    }
    if (!runTs.includes("runClaudeCodeSdkAgent")) {
      issues.push("CRITICAL: runClaudeCodeSdkAgent call missing from pi-embedded-runner/run.ts");
    }
  } catch {
    issues.push("ERROR: Could not read pi-embedded-runner/run.ts");
  }

  // Check 5c: SDK query usage in runner
  try {
    const sdkRunner = await fs.readFile("src/agents/claude-code-sdk-runner.ts", "utf-8");
    if (!sdkRunner.includes("sdk.query")) {
      issues.push("WARNING: sdk.query() call missing from claude-code-sdk-runner.ts");
    }
    if (!sdkRunner.includes("bypassPermissions")) {
      issues.push("WARNING: permissionMode bypassPermissions missing from SDK options");
    }
  } catch {
    issues.push("WARNING: Could not read claude-code-sdk-runner.ts");
  }

  // Check 5d: Claude Agent SDK package
  try {
    const packageJson = await fs.readFile("package.json", "utf-8");
    if (!packageJson.includes("@anthropic-ai/claude-agent-sdk")) {
      issues.push("WARNING: @anthropic-ai/claude-agent-sdk missing from package.json");
    }
  } catch {
    issues.push("WARNING: Could not read package.json");
  }

  // Check 6: Dashboard pairing hint
  try {
    const overview = await fs.readFile("ui/src/ui/views/overview.ts", "utf-8");
    if (!overview.includes("pairingHint")) {
      issues.push("WARNING: pairingHint missing from dashboard overview.ts");
    }
    if (!overview.includes("dillobot devices local-list")) {
      issues.push("WARNING: Local CLI instructions not shown in pairing hint");
    }
  } catch {
    issues.push("WARNING: Could not read ui/src/ui/views/overview.ts");
  }

  // Check 7: Dashboard UI branding
  try {
    const indexHtml = await fs.readFile("ui/index.html", "utf-8");
    if (!indexHtml.includes("DilloBot Control")) {
      issues.push("WARNING: Dashboard title may still say OpenClaw");
    }
    if (!indexHtml.includes("dillobot-app")) {
      issues.push("WARNING: Custom element may still be openclaw-app in index.html");
    }
  } catch {
    issues.push("WARNING: Could not read ui/index.html");
  }

  try {
    const appTs = await fs.readFile("ui/src/ui/app.ts", "utf-8");
    if (!appTs.includes('@customElement("dillobot-app")')) {
      issues.push("WARNING: Custom element registration may still be openclaw-app");
    }
  } catch {
    issues.push("WARNING: Could not read ui/src/ui/app.ts");
  }

  try {
    const appRender = await fs.readFile("ui/src/ui/app-render.ts", "utf-8");
    if (!appRender.includes("DILLOBOT")) {
      issues.push("WARNING: Brand title may still say OPENCLAW");
    }
    if (!appRender.includes("/dillobot-logo.svg")) {
      issues.push("WARNING: Logo may still reference OpenClaw lobster");
    }
  } catch {
    issues.push("WARNING: Could not read ui/src/ui/app-render.ts");
  }

  try {
    await fs.access("ui/public/dillobot-logo.svg");
  } catch {
    issues.push("WARNING: ui/public/dillobot-logo.svg missing");
  }

  try {
    const baseCss = await fs.readFile("ui/src/styles/base.css", "utf-8");
    if (!baseCss.includes("#4ade80")) {
      issues.push("WARNING: DilloBot green accent color missing from base.css");
    }
    if (!baseCss.includes("dillobot-app")) {
      issues.push("WARNING: Custom element style may still use openclaw-app");
    }
  } catch {
    issues.push("WARNING: Could not read ui/src/styles/base.css");
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
  const syncStartTime = Date.now();
  console.log("🔄 DilloBot Upstream Sync Agent (Claude Code)");
  console.log(`   Started at: ${new Date().toLocaleTimeString()}\n`);

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

  // Create timestamped backup branch before any merge operations
  const backupBranch = createBackupBranch();
  if (backupBranch) {
    console.log(`💾 Backup branch created: ${backupBranch}`);
    console.log(`   To restore if needed: git reset --hard ${backupBranch}\n`);
  }

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
      // Remove any blocked files that may have been merged
      const blockedRemoved = await removeBlockedFiles();
      const verification = await verifySecurityPatches();
      if (verification.valid) {
        // Update README, website, install script, and version file, then amend the merge commit
        const readmeUpdated = await updateReadmeVersion();
        const websiteUpdated = await updateWebsiteVersion();
        const installCopied = await copyInstallScripts();
        const versionFileUpdated = await updateDilloBotVersionFile();
        if (readmeUpdated || websiteUpdated || installCopied || versionFileUpdated || blockedRemoved.length > 0) {
          run('git commit --amend --no-edit');
        }
        console.log("✅ Simple merge successful! Security patches intact.\n");
        return {
          success: true,
          action: "auto-merged",
          summary: `Successfully merged ${updates.commitCount} upstream commits (no conflicts).${blockedRemoved.length > 0 ? ` Removed ${blockedRemoved.length} blocked files.` : ""}`,
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
      // Simple merge worked - remove any blocked files
      const blockedRemoved = await removeBlockedFiles();
      const verification = await verifySecurityPatches();
      if (verification.valid) {
        // Update README, website, install script, and version file, then amend the merge commit
        const readmeUpdated = await updateReadmeVersion();
        const websiteUpdated = await updateWebsiteVersion();
        const installCopied = await copyInstallScripts();
        const versionFileUpdated = await updateDilloBotVersionFile();
        if (readmeUpdated || websiteUpdated || installCopied || versionFileUpdated || blockedRemoved.length > 0) {
          run('git commit --amend --no-edit');
        }
        console.log("✅ Merge successful! All security patches intact.\n");
        return {
          success: true,
          action: "auto-merged",
          summary: `Successfully merged ${updates.commitCount} upstream commits.${blockedRemoved.length > 0 ? ` Removed ${blockedRemoved.length} blocked files.` : ""}`,
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
        // Remove any blocked files and verify
        const blockedRemoved = await removeBlockedFiles();
        const verification = await verifySecurityPatches();
        if (verification.valid) {
          // Update README, website, install script, and version file before committing
          await updateReadmeVersion();
          await updateWebsiteVersion();
          await copyInstallScripts();
          await updateDilloBotVersionFile();
          run('git commit -m "Merge upstream OpenClaw (DilloBot auto-sync via Claude Code)"');
          console.log("\n✅ Merge successful with Claude Code conflict resolution!\n");
          return {
            success: true,
            action: "auto-merged",
            summary: `Merged ${updates.commitCount} commits with Claude Code-assisted resolution.${blockedRemoved.length > 0 ? ` Removed ${blockedRemoved.length} blocked files.` : ""}`,
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
 * Update website with upstream version info
 */
async function updateWebsiteVersion(): Promise<boolean> {
  const websitePath = "website/index.html";
  const UPSTREAM_REPO_URL = "https://github.com/openclaw/openclaw";

  try {
    await fs.access(websitePath);
  } catch {
    console.log("ℹ️  Website not found, skipping website update");
    return false;
  }

  try {
    let html = await fs.readFile(websitePath, "utf-8");
    let updated = false;

    const versionInfo = getUpstreamVersionInfo();

    // Extract just the tag version (e.g., "v2026.1.30" from "v2026.1.30-124-g6c6f1e9")
    const tagVersion = versionInfo.version.split("-")[0] || versionInfo.version;

    // Update hero badge version
    const heroVersionRegex =
      /<!-- DILLOBOT-VERSION -->[\s\S]*?<!-- \/DILLOBOT-VERSION -->/;
    const newHeroVersion = `<!-- DILLOBOT-VERSION -->Based on OpenClaw <a href="${UPSTREAM_REPO_URL}/commit/${versionInfo.commit}" target="_blank" class="version-link">${tagVersion} (${versionInfo.commitShort})</a><!-- /DILLOBOT-VERSION -->`;

    if (heroVersionRegex.test(html)) {
      html = html.replace(heroVersionRegex, newHeroVersion);
      updated = true;
    }

    // Update footer version
    const footerVersionRegex =
      /<!-- DILLOBOT-FOOTER-VERSION -->[\s\S]*?<!-- \/DILLOBOT-FOOTER-VERSION -->/;
    const newFooterVersion = `<!-- DILLOBOT-FOOTER-VERSION --><p class="version-info">Based on OpenClaw commit <a href="${UPSTREAM_REPO_URL}/commit/${versionInfo.commit}" target="_blank"><code>${versionInfo.commitShort}</code></a> • <a href="https://github.com/AIDilloBot/dillobot/blob/main/README.md#upstream-version" target="_blank">View full sync status</a></p><!-- /DILLOBOT-FOOTER-VERSION -->`;

    if (footerVersionRegex.test(html)) {
      html = html.replace(footerVersionRegex, newFooterVersion);
      updated = true;
    }

    if (updated) {
      await fs.writeFile(websitePath, html, "utf-8");
      run(`git add ${websitePath}`);
      console.log(`📝 Updated website/index.html with upstream version: ${tagVersion} (${versionInfo.commitShort})`);
      return true;
    } else {
      console.log("⚠️  Could not find version markers in website/index.html");
      return false;
    }
  } catch (error) {
    console.log("⚠️  Could not update website:", error);
    return false;
  }
}

/**
 * Copy install scripts to website folder
 */
async function copyInstallScripts(): Promise<boolean> {
  try {
    await fs.access("website");

    // Copy bash installer
    await fs.copyFile("install.sh", "website/install.sh");
    run("git add website/install.sh");
    console.log("📝 Copied install.sh to website/");

    // Copy PowerShell installer
    await fs.copyFile("install.ps1", "website/install.ps1");
    run("git add website/install.ps1");
    console.log("📝 Copied install.ps1 to website/");

    return true;
  } catch {
    return false;
  }
}

/**
 * Update src/dillobot-version.ts with upstream version info
 */
async function updateDilloBotVersionFile(): Promise<boolean> {
  const versionFilePath = "src/dillobot-version.ts";

  try {
    let content = await fs.readFile(versionFilePath, "utf-8");

    const versionInfo = getUpstreamVersionInfo();
    const today = new Date().toISOString().split("T")[0];

    // Extract just the tag version (e.g., "v2026.1.30" from "v2026.1.30-124-g6c6f1e9")
    const tagVersion = versionInfo.version.split("-")[0] || versionInfo.version;

    const newVersionBlock = `// DILLOBOT-UPSTREAM-INFO-START
// Auto-updated by scripts/sync/upstream-sync-agent.ts
export const UPSTREAM_VERSION = "${tagVersion}";
export const UPSTREAM_COMMIT = "${versionInfo.commitShort}";
export const UPSTREAM_COMMIT_FULL = "${versionInfo.commit}";
export const LAST_SYNC_DATE = "${today}";
// DILLOBOT-UPSTREAM-INFO-END`;

    const versionRegex = /\/\/ DILLOBOT-UPSTREAM-INFO-START[\s\S]*?\/\/ DILLOBOT-UPSTREAM-INFO-END/;

    if (versionRegex.test(content)) {
      content = content.replace(versionRegex, newVersionBlock);
      await fs.writeFile(versionFilePath, content, "utf-8");
      run(`git add ${versionFilePath}`);
      console.log(`📝 Updated src/dillobot-version.ts with upstream: ${tagVersion} (${versionInfo.commitShort})`);
      return true;
    } else {
      console.log("⚠️  Could not find version markers in src/dillobot-version.ts");
      return false;
    }
  } catch (error) {
    console.log("⚠️  Could not update dillobot-version.ts:", error);
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
    console.log(`   Finished at: ${new Date().toLocaleTimeString()}`);
    console.log("=".repeat(50));

    // Exit with appropriate code
    process.exit(result.success ? 0 : 1);
  } catch (error) {
    console.error("❌ Sync failed with error:", error);
    process.exit(1);
  }
}

main();
