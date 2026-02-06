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
  // DilloBot model defaults
  "src/agents/defaults.ts",               // Default model (Opus 4.6)
  "src/agents/cli-backends.ts",           // Model aliases
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

// Default timeout for Claude Code CLI (5 minutes)
const CLAUDE_TIMEOUT_MS = 5 * 60 * 1000;

/**
 * Run Claude Code CLI with a prompt and get the response
 *
 * Fixed issues from previous implementation:
 * 1. Added timeout with SIGKILL to prevent indefinite hangs
 * 2. Prompt passed via stdin (not CLI arg) to handle large prompts safely
 * 3. Stdin properly closed after writing to signal EOF
 * 4. Process killed on timeout to prevent orphaned processes
 */
async function askClaude(prompt: string, options?: {
  allowedTools?: string[];
  maxTurns?: number;
  timeoutMs?: number;
}): Promise<string> {
  const timeoutMs = options?.timeoutMs ?? CLAUDE_TIMEOUT_MS;

  // Save prompt to temp file for debugging (optional manual testing)
  const tempDir = process.env.TMPDIR || "/tmp";
  const tempFile = path.join(tempDir, `dillobot-sync-prompt-${Date.now()}.txt`);
  await fs.writeFile(tempFile, prompt, "utf-8");
  console.log(`   📁 Prompt saved to: ${tempFile} (${Math.round(prompt.length / 1024)}KB)`);
  console.log(`   ⏱️  Timeout: ${formatElapsed(timeoutMs)}`);

  return new Promise((resolve, reject) => {
    let resolved = false;
    let timeoutId: ReturnType<typeof setTimeout> | null = null;
    let progressInterval: ReturnType<typeof setInterval> | null = null;

    const claudeArgs: string[] = [
      "--print",  // Non-interactive mode, print response to stdout
    ];

    if (options?.allowedTools) {
      claudeArgs.push("--allowedTools", options.allowedTools.join(","));
    }

    if (options?.maxTurns) {
      claudeArgs.push("--max-turns", String(options.maxTurns));
    }

    // Spawn claude - prompt will be sent via stdin to handle large prompts
    // Using "inherit" for stdin would block, so we use "pipe" and write manually
    const proc = spawn("claude", claudeArgs, {
      stdio: ["pipe", "pipe", "pipe"],
    });

    // Cleanup function to remove temp file and clear intervals
    const cleanup = () => {
      if (timeoutId) {
        clearTimeout(timeoutId);
        timeoutId = null;
      }
      if (progressInterval) {
        clearInterval(progressInterval);
        progressInterval = null;
      }
      fs.unlink(tempFile).catch(() => {});
    };

    // Kill process and reject with timeout error
    const handleTimeout = () => {
      if (resolved) return;
      resolved = true;
      cleanup();

      // Kill the process tree
      try {
        proc.kill("SIGKILL");
      } catch {
        // Process may already be dead
      }

      process.stdout.write(`\r${" ".repeat(80)}\r`);
      console.log(`   ⏱️  Claude Code timed out after ${formatElapsed(timeoutMs)}`);
      reject(new Error(`Claude Code timed out after ${formatElapsed(timeoutMs)}`));
    };

    // Set timeout
    timeoutId = setTimeout(handleTimeout, timeoutMs);

    const startTime = Date.now();
    let stdout = "";
    let stderr = "";
    let lastActivity = Date.now();
    let bytesReceived = 0;

    // Progress indicator
    const progressChars = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
    let progressIndex = 0;

    progressInterval = setInterval(() => {
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

    // Attach stdout/stderr listeners before writing to stdin
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
      if (resolved) return;
      resolved = true;
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
      if (resolved) return;
      resolved = true;
      cleanup();
      process.stdout.write(`\r${" ".repeat(80)}\r`);
      console.log(`   ❌ Failed to start Claude Code: ${err.message}`);
      reject(err);
    });

    // Log process info for debugging
    console.log(`   📍 Started Claude process (PID: ${proc.pid})`);

    // Write prompt to stdin and close it to signal EOF
    // This handles large prompts safely (no shell argument size limits)
    if (proc.stdin) {
      proc.stdin.write(prompt);
      proc.stdin.end(); // Signal EOF so Claude knows input is complete
    }
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
    // Check for Opus 4.6 in model list
    if (!sdkRunner.includes("claude-opus-4-6")) {
      issues.push("CRITICAL: claude-opus-4-6 missing from claude-code-sdk-runner.ts model list");
    }
  } catch {
    issues.push("WARNING: Could not read claude-code-sdk-runner.ts");
  }

  // Check 5d: Default model is Opus 4.6
  try {
    const defaults = await fs.readFile("src/agents/defaults.ts", "utf-8");
    if (!defaults.includes('DEFAULT_MODEL = "claude-opus-4-6"')) {
      issues.push("CRITICAL: DEFAULT_MODEL should be claude-opus-4-6 in defaults.ts");
    }
  } catch {
    issues.push("ERROR: Could not read defaults.ts");
  }

  // Check 5e: CLI backends has Opus 4.6 aliases
  try {
    const cliBackends = await fs.readFile("src/agents/cli-backends.ts", "utf-8");
    if (!cliBackends.includes('"claude-opus-4-6"')) {
      issues.push("CRITICAL: claude-opus-4-6 alias missing from cli-backends.ts");
    }
    if (!cliBackends.includes('"opus-4.6"')) {
      issues.push("CRITICAL: opus-4.6 alias missing from cli-backends.ts");
    }
  } catch {
    issues.push("ERROR: Could not read cli-backends.ts");
  }

  // Check 5f: Auth choice apply uses Opus 4.6
  try {
    const authChoice = await fs.readFile("src/commands/auth-choice.apply.claude-code-sdk.ts", "utf-8");
    if (!authChoice.includes("claude-opus-4-6")) {
      issues.push("CRITICAL: claude-opus-4-6 missing from auth-choice.apply.claude-code-sdk.ts");
    }
  } catch {
    issues.push("ERROR: Could not read auth-choice.apply.claude-code-sdk.ts");
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
 * Merge a single security-critical file by having Claude generate the merged version
 * that preserves DilloBot patches while accepting upstream changes.
 */
async function mergeSecurityFile(
  file: string,
  securityDoc: string,
): Promise<{ success: boolean; error?: string }> {
  console.log(`\n   📄 Merging security file: ${file}`);

  // Get the current DilloBot version (ours)
  let oursContent: string;
  try {
    oursContent = await fs.readFile(file, "utf-8");
  } catch {
    console.log(`      ⚠️  File doesn't exist in DilloBot: ${file}`);
    return { success: true }; // New file from upstream, accept it
  }

  // Get the upstream version (theirs)
  let theirsContent: string;
  try {
    theirsContent = run(`git show upstream/${UPSTREAM_BRANCH}:${file}`, { ignoreError: true });
  } catch {
    console.log(`      ⚠️  File doesn't exist in upstream: ${file}`);
    return { success: true }; // DilloBot-only file, keep it
  }

  if (!theirsContent) {
    console.log(`      ℹ️  File unchanged or not in upstream`);
    return { success: true };
  }

  // If files are identical, no merge needed
  if (oursContent === theirsContent) {
    console.log(`      ✅ Files are identical, no merge needed`);
    return { success: true };
  }

  // Extract the relevant section from security doc for this file
  const fileSection = extractSecurityDocSection(securityDoc, file);

  const prompt = `You are merging a security-critical file for DilloBot (a security-hardened fork of OpenClaw).

FILE: ${file}

DILLOBOT SECURITY REQUIREMENTS FOR THIS FILE:
${fileSection || "See general security patches - all DilloBot-specific code must be preserved."}

CURRENT DILLOBOT VERSION (must preserve security patches):
\`\`\`typescript
${oursContent.slice(0, 50000)}${oursContent.length > 50000 ? "\n// ... truncated" : ""}
\`\`\`

UPSTREAM OPENCLAW VERSION (new features/fixes to incorporate):
\`\`\`typescript
${theirsContent.slice(0, 50000)}${theirsContent.length > 50000 ? "\n// ... truncated" : ""}
\`\`\`

TASK: Generate the MERGED version that:
1. Includes ALL upstream changes (new features, bug fixes, refactors)
2. Preserves ALL DilloBot security patches and additions
3. Resolves any conflicts by keeping BOTH (DilloBot additions + upstream changes)
4. Maintains proper imports for both upstream and DilloBot code

IMPORTANT:
- Look for // DILLOBOT comments marking security-critical code
- Keep all DilloBot-specific imports, types, and function calls
- Accept upstream structural changes but add DilloBot patches on top

Respond with ONLY the merged file content, no explanations or markdown. Start directly with the file content.`;

  try {
    const mergedContent = await askClaude(prompt, {
      timeoutMs: 3 * 60 * 1000, // 3 minutes per file
    });

    // Validate the response looks like valid TypeScript
    if (!mergedContent || mergedContent.length < 100) {
      console.log(`      ❌ Claude returned empty or too-short response`);
      return { success: false, error: "Empty response from Claude" };
    }

    // Write the merged content
    await fs.writeFile(file, mergedContent, "utf-8");
    run(`git add "${file}"`);
    console.log(`      ✅ Merged successfully (${mergedContent.length} chars)`);
    return { success: true };
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    console.log(`      ❌ Failed to merge: ${errorMsg}`);
    return { success: false, error: errorMsg };
  }
}

/**
 * Extract the relevant section from SECURITY_PATCHES.md for a specific file
 */
function extractSecurityDocSection(securityDoc: string, file: string): string {
  const lines = securityDoc.split("\n");
  const sections: string[] = [];
  let inRelevantSection = false;
  let currentSection: string[] = [];

  for (const line of lines) {
    // Check if this line mentions the file
    if (line.includes(file) || line.includes(path.basename(file))) {
      inRelevantSection = true;
    }

    // Track section boundaries
    if (line.startsWith("### ") || line.startsWith("## ")) {
      if (inRelevantSection && currentSection.length > 0) {
        sections.push(currentSection.join("\n"));
      }
      currentSection = [line];
      inRelevantSection = line.includes(file) || line.includes(path.basename(file));
    } else {
      currentSection.push(line);
    }
  }

  // Add last section if relevant
  if (inRelevantSection && currentSection.length > 0) {
    sections.push(currentSection.join("\n"));
  }

  return sections.join("\n\n---\n\n");
}

/**
 * Perform a smart merge that accepts upstream changes and re-applies DilloBot patches
 */
async function smartMergeWithPatches(
  securityFiles: string[],
  securityDoc: string,
): Promise<{ success: boolean; merged: string[]; failed: string[] }> {
  console.log("\n🔧 Starting smart merge with security patch preservation...\n");

  // Step 1: Start merge with upstream, accepting their changes for non-security files
  console.log("   Step 1: Merging upstream (accepting theirs for conflicts)...");
  try {
    // Use -X theirs to accept upstream changes, then we'll re-apply our patches
    run(`git merge upstream/${UPSTREAM_BRANCH} -X theirs --no-commit`, { ignoreError: true });
  } catch {
    // Merge might have conflicts even with -X theirs for some edge cases
  }

  // Check current status
  const status = run("git status --porcelain", { ignoreError: true });
  const hasConflicts = status.split("\n").some((line) => line.startsWith("UU"));

  if (hasConflicts) {
    console.log("   ⚠️  Some conflicts remain, resolving...");
    // For any remaining conflicts, accept theirs first
    const conflictFiles = status
      .split("\n")
      .filter((line) => line.startsWith("UU"))
      .map((line) => line.slice(3).trim());

    for (const file of conflictFiles) {
      run(`git checkout --theirs "${file}"`, { ignoreError: true });
      run(`git add "${file}"`, { ignoreError: true });
    }
  }

  console.log("   ✅ Upstream changes applied\n");

  // Step 2: Re-apply DilloBot patches to security-critical files
  console.log("   Step 2: Re-applying DilloBot security patches...");

  const merged: string[] = [];
  const failed: string[] = [];

  // First, restore our versions of security files from before the merge
  for (const file of securityFiles) {
    // Get our original content from before the merge
    let ourOriginal: string;
    try {
      ourOriginal = run(`git show HEAD:${file}`, { ignoreError: true });
    } catch {
      continue; // File didn't exist in our version
    }

    if (!ourOriginal) continue;

    // Get the current (upstream) content
    let currentContent: string;
    try {
      currentContent = await fs.readFile(file, "utf-8");
    } catch {
      continue; // File doesn't exist
    }

    // If they're the same, no merge needed
    if (ourOriginal === currentContent) {
      console.log(`   ℹ️  ${file}: No changes from upstream`);
      merged.push(file);
      continue;
    }

    // Merge this file
    const result = await mergeSecurityFile(file, securityDoc);
    if (result.success) {
      merged.push(file);
    } else {
      failed.push(file);
    }
  }

  // Step 3: Remove any blocked files
  await removeBlockedFiles();

  return { success: failed.length === 0, merged, failed };
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
        // Update README, website, install script, version file, and bump DilloBot version
        const readmeUpdated = await updateReadmeVersion();
        const websiteUpdated = await updateWebsiteVersion();
        const installCopied = await copyInstallScripts();
        const versionFileUpdated = await updateDilloBotVersionFile();
        const newVersion = await bumpDilloBotVersion();
        if (readmeUpdated || websiteUpdated || installCopied || versionFileUpdated || newVersion || blockedRemoved.length > 0) {
          run('git commit --amend --no-edit');
        }
        console.log(`✅ Simple merge successful! Security patches intact.${newVersion ? ` DilloBot v${newVersion}` : ""}\n`);
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
        // Update README, website, install script, version file, and bump DilloBot version
        const readmeUpdated = await updateReadmeVersion();
        const websiteUpdated = await updateWebsiteVersion();
        const installCopied = await copyInstallScripts();
        const versionFileUpdated = await updateDilloBotVersionFile();
        const newVersion = await bumpDilloBotVersion();
        if (readmeUpdated || websiteUpdated || installCopied || versionFileUpdated || newVersion || blockedRemoved.length > 0) {
          run('git commit --amend --no-edit');
        }
        console.log(`✅ Merge successful! All security patches intact.${newVersion ? ` DilloBot v${newVersion}` : ""}\n`);
        return {
          success: true,
          action: "auto-merged",
          summary: `Successfully merged ${updates.commitCount} upstream commits.${blockedRemoved.length > 0 ? ` Removed ${blockedRemoved.length} blocked files.` : ""}${newVersion ? ` DilloBot v${newVersion}` : ""}`,
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
          // Update README, website, install script, version file, and bump DilloBot version
          await updateReadmeVersion();
          await updateWebsiteVersion();
          await copyInstallScripts();
          await updateDilloBotVersionFile();
          const newVersion = await bumpDilloBotVersion();
          run('git commit -m "Merge upstream OpenClaw (DilloBot auto-sync via Claude Code)"');
          console.log(`\n✅ Merge successful with Claude Code conflict resolution!${newVersion ? ` DilloBot v${newVersion}` : ""}\n`);
          return {
            success: true,
            action: "auto-merged",
            summary: `Merged ${updates.commitCount} commits with Claude Code-assisted resolution.${blockedRemoved.length > 0 ? ` Removed ${blockedRemoved.length} blocked files.` : ""}${newVersion ? ` DilloBot v${newVersion}` : ""}`,
            appliedPatches: Object.keys(analysis.resolutions),
            upstreamChanges: updates.summary,
          };
        }
      }

      // Abort if we couldn't resolve everything
      run("git merge --abort", { ignoreError: true });
    }
  }

  // Step 6: Try smart merge with patch preservation for security files
  if (changedSecurityFiles.length > 0) {
    console.log("\n🔧 Attempting smart merge with security patch preservation...");
    const smartResult = await smartMergeWithPatches(changedSecurityFiles, securityDoc);

    if (smartResult.success) {
      // Verify security patches are intact
      const verification = await verifySecurityPatches();
      if (verification.valid) {
        // Update README, website, install script, version file, and bump DilloBot version
        await updateReadmeVersion();
        await updateWebsiteVersion();
        await copyInstallScripts();
        await updateDilloBotVersionFile();
        const newVersion = await bumpDilloBotVersion();
        run('git commit -m "Merge upstream OpenClaw with DilloBot security patches (smart merge via Claude Code)"');
        console.log(`\n✅ Smart merge successful! All security patches preserved.${newVersion ? ` DilloBot v${newVersion}` : ""}\n`);
        return {
          success: true,
          action: "auto-merged",
          summary: `Merged ${updates.commitCount} commits using smart merge. Preserved patches in ${smartResult.merged.length} security files.${newVersion ? ` DilloBot v${newVersion}` : ""}`,
          appliedPatches: smartResult.merged,
          upstreamChanges: updates.summary,
        };
      } else {
        // Security patches damaged - rollback
        console.log("❌ Security verification failed after smart merge. Issues:");
        verification.issues.forEach((i) => console.log(`   - ${i}`));
        run("git reset --hard HEAD", { ignoreError: true });
        run("git merge --abort", { ignoreError: true });
      }
    } else if (smartResult.failed.length > 0) {
      console.log(`\n❌ Smart merge failed for ${smartResult.failed.length} files:`);
      smartResult.failed.forEach((f) => console.log(`   - ${f}`));
      run("git reset --hard HEAD", { ignoreError: true });
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
 * Get current DilloBot version from package.json
 */
async function getCurrentDilloBotVersion(): Promise<string> {
  try {
    const packageJson = await fs.readFile("package.json", "utf-8");
    const pkg = JSON.parse(packageJson);
    return pkg.version || "0.0.0";
  } catch {
    return "0.0.0";
  }
}

/**
 * Compute the next DilloBot version by bumping the patch segment
 * Version format: YYYY.M.P (e.g., 2026.2.5 -> 2026.2.6)
 */
function computeNextVersion(currentVersion: string): string {
  const parts = currentVersion.split(".");
  if (parts.length >= 3) {
    const patch = parseInt(parts[2], 10) || 0;
    return `${parts[0]}.${parts[1]}.${patch + 1}`;
  }
  // Fallback: just append .1
  return `${currentVersion}.1`;
}

/**
 * Update DilloBot version in package.json
 */
async function updatePackageJsonVersion(newVersion: string): Promise<boolean> {
  try {
    const packageJsonPath = "package.json";
    let content = await fs.readFile(packageJsonPath, "utf-8");

    // Replace the version field
    const versionRegex = /"version":\s*"[^"]+"/;
    if (versionRegex.test(content)) {
      content = content.replace(versionRegex, `"version": "${newVersion}"`);
      await fs.writeFile(packageJsonPath, content, "utf-8");
      run(`git add ${packageJsonPath}`);
      console.log(`📝 Updated package.json version to ${newVersion}`);
      return true;
    }
    return false;
  } catch (error) {
    console.log("⚠️  Could not update package.json:", error);
    return false;
  }
}

/**
 * Update DilloBot version in README.md
 */
async function updateReadmeDilloBotVersion(newVersion: string): Promise<boolean> {
  try {
    const readmePath = "README.md";
    let content = await fs.readFile(readmePath, "utf-8");

    // Match: **DilloBot Version:** `vX.X.X`
    const versionRegex = /\*\*DilloBot Version:\*\* `v[^`]+`/;
    if (versionRegex.test(content)) {
      content = content.replace(versionRegex, `**DilloBot Version:** \`v${newVersion}\``);
      await fs.writeFile(readmePath, content, "utf-8");
      run(`git add ${readmePath}`);
      console.log(`📝 Updated README.md DilloBot version to v${newVersion}`);
      return true;
    }
    return false;
  } catch (error) {
    console.log("⚠️  Could not update README.md DilloBot version:", error);
    return false;
  }
}

/**
 * Update DilloBot version in website/index.html (hero badge and footer)
 */
async function updateWebsiteDilloBotVersion(newVersion: string): Promise<boolean> {
  const websitePath = "website/index.html";
  const UPSTREAM_REPO_URL = "https://github.com/openclaw/openclaw";

  try {
    await fs.access(websitePath);
  } catch {
    return false;
  }

  try {
    let html = await fs.readFile(websitePath, "utf-8");
    let updated = false;

    const versionInfo = getUpstreamVersionInfo();
    const tagVersion = versionInfo.version.split("-")[0] || versionInfo.version;

    // Update hero badge: <!-- DILLOBOT-VERSION -->vX.X.X • Based on OpenClaw ...<!-- /DILLOBOT-VERSION -->
    const heroVersionRegex = /<!-- DILLOBOT-VERSION -->.*?<!-- \/DILLOBOT-VERSION -->/;
    const newHeroVersion = `<!-- DILLOBOT-VERSION -->v${newVersion} • Based on OpenClaw <a href="${UPSTREAM_REPO_URL}/commit/${versionInfo.commit}" target="_blank" class="version-link">${tagVersion} (${versionInfo.commitShort})</a><!-- /DILLOBOT-VERSION -->`;

    if (heroVersionRegex.test(html)) {
      html = html.replace(heroVersionRegex, newHeroVersion);
      updated = true;
    }

    // Update footer: <!-- DILLOBOT-FOOTER-VERSION -->...<!-- /DILLOBOT-FOOTER-VERSION -->
    const footerVersionRegex = /<!-- DILLOBOT-FOOTER-VERSION -->.*?<!-- \/DILLOBOT-FOOTER-VERSION -->/;
    const newFooterVersion = `<!-- DILLOBOT-FOOTER-VERSION --><p class="version-info">DilloBot v${newVersion} • Based on OpenClaw commit <a href="${UPSTREAM_REPO_URL}/commit/${versionInfo.commit}" target="_blank"><code>${versionInfo.commitShort}</code></a> • <a href="https://github.com/AIDilloBot/dillobot/blob/main/README.md#upstream-version" target="_blank">View full sync status</a></p><!-- /DILLOBOT-FOOTER-VERSION -->`;

    if (footerVersionRegex.test(html)) {
      html = html.replace(footerVersionRegex, newFooterVersion);
      updated = true;
    }

    if (updated) {
      await fs.writeFile(websitePath, html, "utf-8");
      run(`git add ${websitePath}`);
      console.log(`📝 Updated website DilloBot version to v${newVersion}`);
      return true;
    }
    return false;
  } catch (error) {
    console.log("⚠️  Could not update website DilloBot version:", error);
    return false;
  }
}

/**
 * Bump DilloBot version after successful upstream sync
 * Updates: package.json, README.md, website/index.html
 */
async function bumpDilloBotVersion(): Promise<string | null> {
  const currentVersion = await getCurrentDilloBotVersion();
  const newVersion = computeNextVersion(currentVersion);

  console.log(`\n📦 Bumping DilloBot version: ${currentVersion} → ${newVersion}`);

  const packageUpdated = await updatePackageJsonVersion(newVersion);
  const readmeUpdated = await updateReadmeDilloBotVersion(newVersion);
  const websiteUpdated = await updateWebsiteDilloBotVersion(newVersion);

  if (packageUpdated || readmeUpdated || websiteUpdated) {
    return newVersion;
  }
  return null;
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
