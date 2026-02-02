#!/usr/bin/env npx ts-node
/**
 * Update README.md and website with current upstream version info
 *
 * Usage:
 *   npx ts-node scripts/sync/update-version.ts
 *
 * This is called automatically by the sync agent, but can also be run
 * manually to update the version block.
 */

import { execSync } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";

const UPSTREAM_BRANCH = "main";
const UPSTREAM_REPO_URL = "https://github.com/openclaw/openclaw";

function run(cmd: string): string {
  try {
    return execSync(cmd, { encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"] }).trim();
  } catch {
    return "";
  }
}

interface VersionInfo {
  version: string;
  commit: string;
  commitShort: string;
  upstreamDate: string;
  syncDate: string;
  behindCount: number;
}

async function getVersionInfo(): Promise<VersionInfo> {
  // Ensure upstream remote exists and is fetched
  const remotes = run("git remote -v");
  if (!remotes.includes("upstream")) {
    console.log("Adding upstream remote...");
    run("git remote add upstream https://github.com/openclaw/openclaw.git");
  }

  console.log("Fetching upstream...");
  run("git fetch upstream");

  // Get version info
  const version =
    run(`git describe --tags upstream/${UPSTREAM_BRANCH} 2>/dev/null`) ||
    run(`git log -1 --format=%H upstream/${UPSTREAM_BRANCH}`).slice(0, 12) ||
    "unknown";

  const commit = run(`git rev-parse upstream/${UPSTREAM_BRANCH}`) || "unknown";
  const commitShort = commit.slice(0, 7);

  const dateRaw = run(`git log -1 --format=%ci upstream/${UPSTREAM_BRANCH}`);
  const upstreamDate = dateRaw ? dateRaw.split(" ")[0] : "unknown";

  const behindCount = parseInt(
    run(`git rev-list --count HEAD..upstream/${UPSTREAM_BRANCH}`) || "0",
    10,
  );

  const syncDate = new Date().toISOString().split("T")[0];

  return { version, commit, commitShort, upstreamDate, syncDate, behindCount };
}

async function updateReadme(info: VersionInfo): Promise<boolean> {
  const readmePath = "README.md";

  try {
    let readme = await fs.readFile(readmePath, "utf-8");

    const newVersionBlock = `<!-- DILLOBOT-UPSTREAM-VERSION-START -->
| | |
|---|---|
| **Based on OpenClaw** | \`${info.version}\` |
| **Upstream Commit** | [\`${info.commitShort}\`](${UPSTREAM_REPO_URL}/commit/${info.commit}) |
| **Last Synced** | ${info.syncDate} |
| **Commits Behind** | ${info.behindCount} |
<!-- DILLOBOT-UPSTREAM-VERSION-END -->`;

    const versionRegex =
      /<!-- DILLOBOT-UPSTREAM-VERSION-START -->[\s\S]*?<!-- DILLOBOT-UPSTREAM-VERSION-END -->/;

    if (versionRegex.test(readme)) {
      readme = readme.replace(versionRegex, newVersionBlock);
      await fs.writeFile(readmePath, readme, "utf-8");
      console.log("✅ README.md updated");
      return true;
    } else {
      console.log("⚠️  Could not find version block in README.md");
      return false;
    }
  } catch (err) {
    console.log("⚠️  Could not update README.md:", err);
    return false;
  }
}

async function updateWebsite(info: VersionInfo): Promise<boolean> {
  const websitePath = "website/index.html";

  // Check if website exists
  try {
    await fs.access(websitePath);
  } catch {
    console.log("ℹ️  Website not found, skipping website update");
    return false;
  }

  try {
    let html = await fs.readFile(websitePath, "utf-8");
    let updated = false;

    // Extract just the tag version (e.g., "v2026.1.30" from "v2026.1.30-124-g6c6f1e9")
    const tagVersion = info.version.split("-")[0] || info.version;

    // Update hero badge version
    // <!-- DILLOBOT-VERSION -->...<a>...</a>...<!-- /DILLOBOT-VERSION -->
    const heroVersionRegex =
      /<!-- DILLOBOT-VERSION -->[\s\S]*?<!-- \/DILLOBOT-VERSION -->/;
    const newHeroVersion = `<!-- DILLOBOT-VERSION -->Based on OpenClaw <a href="${UPSTREAM_REPO_URL}/commit/${info.commit}" target="_blank" class="version-link">${tagVersion} (${info.commitShort})</a><!-- /DILLOBOT-VERSION -->`;

    if (heroVersionRegex.test(html)) {
      html = html.replace(heroVersionRegex, newHeroVersion);
      updated = true;
    }

    // Update footer version
    // <!-- DILLOBOT-FOOTER-VERSION -->...<p>...</p>...<!-- /DILLOBOT-FOOTER-VERSION -->
    const footerVersionRegex =
      /<!-- DILLOBOT-FOOTER-VERSION -->[\s\S]*?<!-- \/DILLOBOT-FOOTER-VERSION -->/;
    const newFooterVersion = `<!-- DILLOBOT-FOOTER-VERSION --><p class="version-info">Based on OpenClaw commit <a href="${UPSTREAM_REPO_URL}/commit/${info.commit}" target="_blank"><code>${info.commitShort}</code></a> • <a href="https://github.com/AIDilloBot/dillobot/blob/main/README.md#upstream-version" target="_blank">View full sync status</a></p><!-- /DILLOBOT-FOOTER-VERSION -->`;

    if (footerVersionRegex.test(html)) {
      html = html.replace(footerVersionRegex, newFooterVersion);
      updated = true;
    }

    if (updated) {
      await fs.writeFile(websitePath, html, "utf-8");
      console.log("✅ website/index.html updated");
      return true;
    } else {
      console.log("⚠️  Could not find version markers in website/index.html");
      return false;
    }
  } catch (err) {
    console.log("⚠️  Could not update website:", err);
    return false;
  }
}

async function copyInstallScript(): Promise<boolean> {
  const srcPath = "install.sh";
  const destPath = "website/install.sh";

  try {
    await fs.access("website");
    await fs.copyFile(srcPath, destPath);
    console.log("✅ website/install.sh updated");
    return true;
  } catch {
    return false;
  }
}

async function updateDilloBotVersionFile(info: VersionInfo): Promise<boolean> {
  const versionFilePath = "src/dillobot-version.ts";

  try {
    let content = await fs.readFile(versionFilePath, "utf-8");

    // Extract just the tag version (e.g., "v2026.1.30" from "v2026.1.30-124-g6c6f1e9")
    const tagVersion = info.version.split("-")[0] || info.version;

    const newVersionBlock = `// DILLOBOT-UPSTREAM-INFO-START
// Auto-updated by scripts/sync/upstream-sync-agent.ts
// Run \`npm run dillobot:sync\` or \`npx ts-node scripts/sync/update-version.ts\` to populate
export const UPSTREAM_VERSION = "${tagVersion}";
export const UPSTREAM_COMMIT = "${info.commitShort}";
export const UPSTREAM_COMMIT_FULL = "${info.commit}";
export const LAST_SYNC_DATE = "${info.syncDate}";
// DILLOBOT-UPSTREAM-INFO-END`;

    const versionRegex = /\/\/ DILLOBOT-UPSTREAM-INFO-START[\s\S]*?\/\/ DILLOBOT-UPSTREAM-INFO-END/;

    if (versionRegex.test(content)) {
      content = content.replace(versionRegex, newVersionBlock);
      await fs.writeFile(versionFilePath, content, "utf-8");
      console.log(`✅ src/dillobot-version.ts updated`);
      return true;
    } else {
      console.log("⚠️  Could not find version markers in src/dillobot-version.ts");
      return false;
    }
  } catch (err) {
    console.log("⚠️  Could not update dillobot-version.ts:", err);
    return false;
  }
}

async function main() {
  console.log("📝 Updating version info...\n");

  const info = await getVersionInfo();

  console.log(`  Version: ${info.version}`);
  console.log(`  Commit: ${info.commitShort} (${info.commit})`);
  console.log(`  Upstream date: ${info.upstreamDate}`);
  console.log(`  Commits behind: ${info.behindCount}`);
  console.log(`  Sync date: ${info.syncDate}`);
  console.log("");

  // Update all version references
  await updateReadme(info);
  await updateWebsite(info);
  await copyInstallScript();
  await updateDilloBotVersionFile(info);

  console.log("");

  if (info.behindCount > 0) {
    console.log(`⚠️  You are ${info.behindCount} commits behind upstream.`);
    console.log("   Run: npm run dillobot:sync");
  } else {
    console.log("✅ Up to date with upstream!");
  }
}

main().catch((err) => {
  console.error("Error:", err);
  process.exit(1);
});
