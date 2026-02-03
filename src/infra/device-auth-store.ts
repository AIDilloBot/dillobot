import fs from "node:fs";
import path from "node:path";
import { resolveStateDir } from "../config/paths.js";
import { storeDeviceAuth, retrieveDeviceAuth, hasCredential } from "../security-hardening/index.js";

export type DeviceAuthEntry = {
  token: string;
  role: string;
  scopes: string[];
  updatedAtMs: number;
};

type DeviceAuthStore = {
  version: 1;
  deviceId: string;
  tokens: Record<string, DeviceAuthEntry>;
};

const DEVICE_AUTH_FILE = "device-auth.json";

function resolveDeviceAuthPath(env: NodeJS.ProcessEnv = process.env): string {
  return path.join(resolveStateDir(env), "identity", DEVICE_AUTH_FILE);
}

function normalizeRole(role: string): string {
  return role.trim();
}

function normalizeScopes(scopes: string[] | undefined): string[] {
  if (!Array.isArray(scopes)) {
    return [];
  }
  const out = new Set<string>();
  for (const scope of scopes) {
    const trimmed = scope.trim();
    if (trimmed) {
      out.add(trimmed);
    }
  }
  return [...out].toSorted();
}

function readStore(filePath: string): DeviceAuthStore | null {
  try {
    if (!fs.existsSync(filePath)) {
      return null;
    }
    const raw = fs.readFileSync(filePath, "utf8");
    const parsed = JSON.parse(raw) as DeviceAuthStore;
    if (parsed?.version !== 1 || typeof parsed.deviceId !== "string") {
      return null;
    }
    if (!parsed.tokens || typeof parsed.tokens !== "object") {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

function writeStore(filePath: string, store: DeviceAuthStore): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(store, null, 2)}\n`, { mode: 0o600 });
  try {
    fs.chmodSync(filePath, 0o600);
  } catch {
    // best-effort
  }
}

export function loadDeviceAuthToken(params: {
  deviceId: string;
  role: string;
  env?: NodeJS.ProcessEnv;
}): DeviceAuthEntry | null {
  const filePath = resolveDeviceAuthPath(params.env);
  const store = readStore(filePath);
  if (!store) {
    return null;
  }
  if (store.deviceId !== params.deviceId) {
    return null;
  }
  const role = normalizeRole(params.role);
  const entry = store.tokens[role];
  if (!entry || typeof entry.token !== "string") {
    return null;
  }
  return entry;
}

export function storeDeviceAuthToken(params: {
  deviceId: string;
  role: string;
  token: string;
  scopes?: string[];
  env?: NodeJS.ProcessEnv;
}): DeviceAuthEntry {
  const filePath = resolveDeviceAuthPath(params.env);
  const existing = readStore(filePath);
  const role = normalizeRole(params.role);
  const next: DeviceAuthStore = {
    version: 1,
    deviceId: params.deviceId,
    tokens:
      existing && existing.deviceId === params.deviceId && existing.tokens
        ? { ...existing.tokens }
        : {},
  };
  const entry: DeviceAuthEntry = {
    token: params.token,
    role,
    scopes: normalizeScopes(params.scopes),
    updatedAtMs: Date.now(),
  };
  next.tokens[role] = entry;
  writeStore(filePath, next);
  return entry;
}

export function clearDeviceAuthToken(params: {
  deviceId: string;
  role: string;
  env?: NodeJS.ProcessEnv;
}): void {
  const filePath = resolveDeviceAuthPath(params.env);
  const store = readStore(filePath);
  if (!store || store.deviceId !== params.deviceId) {
    return;
  }
  const role = normalizeRole(params.role);
  if (!store.tokens[role]) {
    return;
  }
  const next: DeviceAuthStore = {
    version: 1,
    deviceId: store.deviceId,
    tokens: { ...store.tokens },
  };
  delete next.tokens[role];
  writeStore(filePath, next);

  // DILLOBOT: Also clear from vault (fire-and-forget)
  storeDeviceAuth(params.deviceId, next).catch(() => {
    // best-effort
  });
}

// =============================================================================
// DILLOBOT: Async Vault-Based Functions
// =============================================================================

/**
 * Load device auth token from secure vault.
 * Falls back to JSON file if vault is empty.
 */
export async function loadDeviceAuthTokenFromVault(params: {
  deviceId: string;
  role: string;
  env?: NodeJS.ProcessEnv;
}): Promise<DeviceAuthEntry | null> {
  const vaultStore = await retrieveDeviceAuth<DeviceAuthStore>(params.deviceId);
  if (vaultStore?.deviceId === params.deviceId) {
    const role = normalizeRole(params.role);
    const entry = vaultStore.tokens?.[role];
    if (entry?.token) {
      return entry;
    }
  }

  // Fallback to JSON file
  return loadDeviceAuthToken(params);
}

/**
 * Store device auth token to secure vault.
 * Also saves to JSON file for backward compatibility.
 */
export async function storeDeviceAuthTokenToVault(params: {
  deviceId: string;
  role: string;
  token: string;
  scopes?: string[];
  env?: NodeJS.ProcessEnv;
}): Promise<DeviceAuthEntry> {
  const filePath = resolveDeviceAuthPath(params.env);
  const existing = readStore(filePath);
  const role = normalizeRole(params.role);
  const next: DeviceAuthStore = {
    version: 1,
    deviceId: params.deviceId,
    tokens:
      existing && existing.deviceId === params.deviceId && existing.tokens
        ? { ...existing.tokens }
        : {},
  };
  const entry: DeviceAuthEntry = {
    token: params.token,
    role,
    scopes: normalizeScopes(params.scopes),
    updatedAtMs: Date.now(),
  };
  next.tokens[role] = entry;

  // Save to vault (primary)
  await storeDeviceAuth(params.deviceId, next);

  // Save to JSON file (backward compatibility)
  writeStore(filePath, next);

  return entry;
}

/**
 * Check if device auth exists in vault.
 */
export async function hasVaultDeviceAuth(deviceId: string): Promise<boolean> {
  return hasCredential("deviceAuth", deviceId);
}

/**
 * Migrate existing plaintext device auth to vault.
 */
export async function migrateDeviceAuthToVault(
  env: NodeJS.ProcessEnv = process.env,
): Promise<boolean> {
  const filePath = resolveDeviceAuthPath(env);
  const store = readStore(filePath);
  if (!store?.deviceId || !store.tokens) {
    return false;
  }

  // Check if already in vault
  const inVault = await hasCredential("deviceAuth", store.deviceId);
  if (inVault) {
    return false;
  }

  // Store in vault
  await storeDeviceAuth(store.deviceId, store);
  return true;
}
