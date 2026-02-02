#!/usr/bin/env npx ts-node
/**
 * Update README.md with current upstream version info
 *
 * Usage:
 *   npx ts-node scripts/sync/update-version.ts
 *
 * This is called automatically by the sync agent, but can also be run
 * manually to update the version block.
 */

import { execSync } from "node:child_process";
import fs from "node:fs/promises";

const UPSTREAM_BRANCH = "main";

function run(cmd: string): string {
  try {
    return execSync(cmd, { encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"] }).trim();
  } catch {
    return "";
  }
}

async function main() {
  console.log("📝 Updating README.md with upstream version info...\n");

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

  const today = new Date().toISOString().split("T")[0];

  console.log(`  Version: ${version}`);
  console.log(`  Commit: ${commitShort} (${commit})`);
  console.log(`  Upstream date: ${upstreamDate}`);
  console.log(`  Commits behind: ${behindCount}`);
  console.log(`  Sync date: ${today}`);
  console.log("");

  // Read and update README
  const readmePath = "README.md";
  let readme = await fs.readFile(readmePath, "utf-8");

  const newVersionBlock = `<!-- DILLOBOT-UPSTREAM-VERSION-START -->
| | |
|---|---|
| **Based on OpenClaw** | \`${version}\` |
| **Upstream Commit** | [\`${commitShort}\`](https://github.com/openclaw/openclaw/commit/${commit}) |
| **Last Synced** | ${today} |
| **Commits Behind** | ${behindCount} |
<!-- DILLOBOT-UPSTREAM-VERSION-END -->`;

  const versionRegex =
    /<!-- DILLOBOT-UPSTREAM-VERSION-START -->[\s\S]*?<!-- DILLOBOT-UPSTREAM-VERSION-END -->/;

  if (versionRegex.test(readme)) {
    readme = readme.replace(versionRegex, newVersionBlock);
    await fs.writeFile(readmePath, readme, "utf-8");
    console.log("✅ README.md updated successfully!");

    if (behindCount > 0) {
      console.log(`\n⚠️  You are ${behindCount} commits behind upstream.`);
      console.log("   Run: npm run dillobot:sync");
    }
  } else {
    console.log("❌ Could not find version block in README.md");
    console.log("   Expected markers: <!-- DILLOBOT-UPSTREAM-VERSION-START/END -->");
    process.exit(1);
  }
}

main().catch((err) => {
  console.error("Error:", err);
  process.exit(1);
});
