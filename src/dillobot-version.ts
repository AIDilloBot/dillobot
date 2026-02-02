/**
 * DilloBot version and upstream tracking
 *
 * This file is auto-updated by the sync script.
 * DO NOT EDIT MANUALLY - changes will be overwritten.
 */

// DILLOBOT-UPSTREAM-INFO-START
// Auto-updated by scripts/sync/upstream-sync-agent.ts
// Run `npm run dillobot:sync` or `npx ts-node scripts/sync/update-version.ts` to populate
export const UPSTREAM_VERSION = "v2026.2.1";
export const UPSTREAM_COMMIT = "c429ccb";
export const UPSTREAM_COMMIT_FULL = "c429ccb64fc319babf4f8adc95df6d658a2d6b2f";
export const LAST_SYNC_DATE = "2026-02-02";
// DILLOBOT-UPSTREAM-INFO-END

export const DILLOBOT_PRODUCT_NAME = "DilloBot";
export const DILLOBOT_TAGLINE = "Armored AI. No compromises.";
export const DILLOBOT_EMOJI = "🛡️";

/**
 * Format the full version string for display
 */
export function formatDilloBotVersion(dilloBotVersion: string): string {
  return `${DILLOBOT_PRODUCT_NAME} ${dilloBotVersion} (OpenClaw ${UPSTREAM_VERSION})`;
}

/**
 * Get upstream info for display
 */
export function getUpstreamInfo(): { version: string; commit: string; syncDate: string } {
  return {
    version: UPSTREAM_VERSION,
    commit: UPSTREAM_COMMIT,
    syncDate: LAST_SYNC_DATE,
  };
}
