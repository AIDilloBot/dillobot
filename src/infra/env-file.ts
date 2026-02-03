import fs from "node:fs";
import path from "node:path";
import { storeCredential, retrieveCredential } from "../security-hardening/index.js";
import { resolveConfigDir } from "../utils.js";

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function upsertSharedEnvVar(params: {
  key: string;
  value: string;
  env?: NodeJS.ProcessEnv;
}): { path: string; updated: boolean; created: boolean } {
  const env = params.env ?? process.env;
  const dir = resolveConfigDir(env);
  const filepath = path.join(dir, ".env");
  const key = params.key.trim();
  const value = params.value;

  let raw = "";
  if (fs.existsSync(filepath)) {
    raw = fs.readFileSync(filepath, "utf8");
  }

  const lines = raw.length ? raw.split(/\r?\n/) : [];
  const matcher = new RegExp(`^(\\s*(?:export\\s+)?)${escapeRegExp(key)}\\s*=`);
  let updated = false;
  let replaced = false;

  const nextLines = lines.map((line) => {
    const match = line.match(matcher);
    if (!match) {
      return line;
    }
    replaced = true;
    const prefix = match[1] ?? "";
    const next = `${prefix}${key}=${value}`;
    if (next !== line) {
      updated = true;
    }
    return next;
  });

  if (!replaced) {
    nextLines.push(`${key}=${value}`);
    updated = true;
  }

  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  }

  const output = `${nextLines.join("\n")}\n`;
  fs.writeFileSync(filepath, output, "utf8");
  fs.chmodSync(filepath, 0o600);

  // DILLOBOT: Also save to vault for sensitive keys
  const sensitiveKeys = ["OPENAI_API_KEY", "ANTHROPIC_API_KEY", "GEMINI_API_KEY"];
  if (sensitiveKeys.includes(key)) {
    storeCredential("openaiKey", key, { value }).catch(() => {
      // best-effort
    });
  }

  return { path: filepath, updated, created: !raw };
}

// =============================================================================
// DILLOBOT: Vault-Based Functions
// =============================================================================

/**
 * Load a sensitive env var from vault.
 * Falls back to process.env if not in vault.
 */
export async function loadEnvVarFromVault(key: string): Promise<string | null> {
  try {
    const stored = await retrieveCredential<{ value: string }>("openaiKey", key);
    if (stored?.value) {
      return stored.value;
    }
  } catch {
    // Fall back to process.env
  }
  return process.env[key] ?? null;
}

/**
 * Inject sensitive env vars from vault into process.env.
 * Call this early in startup.
 */
export async function injectVaultEnvVars(): Promise<void> {
  const sensitiveKeys = ["OPENAI_API_KEY", "ANTHROPIC_API_KEY", "GEMINI_API_KEY"];
  for (const key of sensitiveKeys) {
    if (process.env[key]) {
      continue; // Already set, don't override
    }
    const value = await loadEnvVarFromVault(key);
    if (value) {
      process.env[key] = value;
    }
  }
}
