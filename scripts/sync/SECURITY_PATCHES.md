# DilloBot Security Patches

This document describes the security modifications made to OpenClaw that MUST be preserved during upstream syncs.

## Critical Patches

### 1. First-Run Only Local Auto-Approve

**File:** `src/gateway/server/ws-connection/message-handler.ts`
**Line:** ~640

```typescript
// DilloBot: Only auto-approve local on first run (no paired devices yet)
silent: isLocalClient && (await isFirstRun()), // Auto-approve local on first run only
```

**File:** `src/infra/device-pairing.ts`
**Added function:**
```typescript
export async function isFirstRun(baseDir?: string): Promise<boolean> {
  const state = await loadState(baseDir);
  return Object.keys(state.pairedByDeviceId).length === 0;
}
```

**Security rationale:**
- First connection from local loopback is auto-approved (bootstrapping)
- Once ANY device is paired, all subsequent connections require explicit pairing
- Prevents VPS port-forwarding attack (attacker would need to be the very first connection)
- Dashboard refresh works because the device is already in `paired.json`

**Flow:**
1. First run, no devices paired → local auto-approve → device saved to `paired.json`
2. Dashboard refresh → device found in `paired.json` → allowed (no pairing needed)
3. New device after first run → requires explicit pairing (no auto-approve)

---

### 2. Security Policy Enforcement on Config Load

**File:** `src/config/io.ts`
**Import Required:**
```typescript
import { enforceSecurityPolicy } from "../security-hardening/policy/security-policy.js";
```

**Call Required:** Before returning config in `loadConfig()`:
```typescript
const securedCfg = enforceSecurityPolicy(cfg);
return applyConfigOverrides(securedCfg);
```

**Why:** Blocks dangerous configuration overrides that could weaken security.

---

### 3. Claude Code SDK Provider Type

**File:** `src/config/types.models.ts`

**ModelApi must include:**
```typescript
| "claude-code-agent"
```

**ModelProviderAuthMode must include:**
```typescript
| "subscription"
```

**Why:** Enables Claude Code SDK as a provider option.

---

### 4. Zod Schema Auth Mode

**File:** `src/config/zod-schema.ts`

**Mode union must include `subscription`:**
```typescript
mode: z.union([z.literal("api_key"), z.literal("oauth"), z.literal("token"), z.literal("subscription")]),
```

**Why:** The Zod schema validates config at runtime. Without `subscription` in the mode union, Claude Code SDK auth profiles fail validation during onboarding.

---

### 5. Security Config Type Integration

**File:** `src/config/types.openclaw.ts`

**Import Required:**
```typescript
import type { SecurityConfig } from "./types.security.js";
```

**Field Required in OpenClawConfig:**
```typescript
security?: SecurityConfig;
```

**Why:** Allows security configuration in openclaw.json.

---

### 5. Claude Code SDK as Default Auth

**Files:**
- `src/commands/onboard-types.ts` — Added `claude-code-sdk` AuthChoice
- `src/commands/auth-choice-options.ts` — Claude Code SDK as first/recommended option
- `src/commands/auth-choice.apply.ts` — Claude Code SDK handler registered first
- `src/commands/auth-choice.apply.claude-code-sdk.ts` — **NEW** Handler for Claude Code SDK

**Why:** DilloBot uses Claude Code SDK as the preferred authentication method. No API keys to manage or leak.

---

### 6. Claude Code SDK Provider Detection

**File:** `src/agents/models-config.providers.ts`

**Imports Required:**
```typescript
import { isClaudeCodeSubscriptionAvailable, getClaudeCodeAuth } from "./claude-code-sdk-auth.js";
import { getClaudeCodeSdkProviderConfig } from "./claude-code-sdk-runner.js";
```

**Provider Detection Block Required** in `resolveImplicitProviders()`:
```typescript
// DILLOBOT: Claude Code SDK provider (preferred when available)
const claudeCodeAvailable = await isClaudeCodeSubscriptionAvailable();
if (claudeCodeAvailable) {
  const auth = await getClaudeCodeAuth();
  if (auth) {
    providers["claude-code-agent"] = {
      ...getClaudeCodeSdkProviderConfig(),
      apiKey: "subscription",
    };
  }
}
```

**Why:** Auto-detects and registers Claude Code SDK when subscription is available.

---

## DilloBot Branding

### 6. CLI Alias

**File:** `package.json`

**bin section must include:**
```json
"bin": {
  "openclaw": "openclaw.mjs",
  "dillobot": "openclaw.mjs"
}
```

**Why:** Provides `dillobot` command as an alias for users.

---

### 7. Central Dispatch Security Integration

**File:** `src/auto-reply/dispatch.ts`

**Imports Required:**
```typescript
import {
  processContentSecurity,
  shouldBlockImmediately,
  type ContentSecurityConfig,
} from "../security-hardening/index.js";
import { logWarn } from "../logger.js";
```

**Security Parameter Required** in `dispatchInboundMessage`:
```typescript
/** DILLOBOT: Security config overrides */
securityConfig?: Partial<ContentSecurityConfig>;
```

**Security Processing Required** at start of `dispatchInboundMessage` (after `finalizeInboundContext`):
```typescript
// DILLOBOT: Process content through security pipeline
const sessionKey = finalized.SessionKey ?? "unknown";
const bodyToCheck = finalized.BodyForAgent ?? finalized.Body ?? "";

// Quick check for critical patterns that should block immediately
const quickBlock = shouldBlockImmediately(bodyToCheck);
if (quickBlock.block) {
  logWarn(`[security] BLOCKED inbound message...`);
  return { queuedFinal: false, counts: { tool: 0, block: 0, final: 0 } };
}

// Run full security processing
const securityResult = await processContentSecurity(bodyToCheck, {...});
if (securityResult.blocked) {
  return { queuedFinal: false, counts: { tool: 0, block: 0, final: 0 } };
}

// Use processed content if modified
if (securityResult.processedContent !== bodyToCheck) {
  finalized.BodyForAgent = securityResult.processedContent;
}
```

**Why:** This is the central entry point for ALL message channels. Security processing here protects Discord, Slack, Telegram, Signal, Line, iMessage, WhatsApp, webhooks, API, and web interface.

---

### 8. Cron/Isolated Agent Security Integration

**File:** `src/cron/isolated-agent/run.ts`

**Imports Required:**
```typescript
import {
  processContentSecurity,
  shouldBlockImmediately,
} from "../../security-hardening/index.js";
```

**Security Processing Required** in `runCronAgentTurn` (before agent execution):
```typescript
// DILLOBOT: Quick security check
const quickBlock = shouldBlockImmediately(params.message);
if (quickBlock.block) {
  logWarn(`[security] BLOCKED external content...`);
  return { status: "error", error: `Security: Content blocked - ${quickBlock.reason}` };
}

// DILLOBOT: Full security processing
const securityResult = await processContentSecurity(params.message, {...});
if (securityResult.blocked) {
  return { status: "error", error: `Security: ${securityResult.blockReason}` };
}
```

**Why:** Protects email hooks and external webhook triggers that bypass the main dispatch flow.

---

### 9. Subscription Credential Type Support

**Files:**
- `src/agents/auth-profiles/types.ts` — Added `SubscriptionCredential` type to union
- `src/config/types.auth.ts` — Added `"subscription"` to `AuthProfileConfig.mode`
- `src/agents/auth-health.ts` — Added subscription handling in health checks
- `src/agents/auth-profiles/store.ts` — Added subscription type validation and migration
- `src/agents/auth-profiles/oauth.ts` — Added subscription handling before OAuth fallback
- `src/agents/tools/session-status-tool.ts` — Added subscription type display
- `src/auto-reply/reply/commands-status.ts` — Added subscription type display

**Key Types:**
```typescript
// In auth-profiles/types.ts
export type SubscriptionCredential = {
  type: "subscription";
  provider: string;
  token: string;
  expires?: number;
  email?: string;
};

// Union includes:
export type AuthProfileCredential = ApiKeyCredential | TokenCredential | OAuthCredential | SubscriptionCredential;
```

**Pattern for handling:** When checking credential types, always add explicit `if (cred.type === "subscription")` check before falling through to OAuth handling.

**Why:** Required for Claude Code SDK authentication. Subscription credentials are like tokens (static, no OAuth refresh) but distinct for DilloBot tracking.

---

## Security Module

**Directory:** `src/security-hardening/`

This entire directory is DilloBot-specific and must be preserved. It contains:
- Encrypted credential vault
- Prompt injection protection
- LLM-based skill inspection (NOT checksum-based)
- Security policy enforcement
- Challenge-response authentication

**Key files:**
- `skills/skill-inspector.ts` — LLM-based security analysis
- `skills/skill-verification.ts` — Verification orchestration

---

## Verification Checklist

After any upstream sync, verify:

1. [ ] `silent: isLocalClient && (await isFirstRun())` in message-handler.ts (first-run only)
2. [ ] `enforceSecurityPolicy()` called in io.ts
3. [ ] `claude-code-agent` in ModelApi union
4. [ ] `subscription` in ModelProviderAuthMode union
5. [ ] `security?: SecurityConfig` in OpenClawConfig
6. [ ] Claude Code SDK provider detection in models-config.providers.ts
7. [ ] `/src/security-hardening/` directory exists and is complete
8. [ ] `/src/agents/claude-code-sdk-auth.ts` exists
9. [ ] `/src/agents/claude-code-sdk-runner.ts` exists
10. [ ] `/src/config/types.security.ts` exists
11. [ ] `dillobot` CLI alias in package.json bin section
12. [ ] `processContentSecurity` called in dispatch.ts (central security integration)
13. [ ] `shouldBlockImmediately` called in dispatch.ts (quick filter)
14. [ ] Security imports present in cron/isolated-agent/run.ts
15. [ ] `SubscriptionCredential` type in auth-profiles/types.ts
16. [ ] `"subscription"` in AuthProfileConfig.mode (types.auth.ts)
17. [ ] DilloBot branding in banner.ts (not OpenClaw)
18. [ ] DilloBot branding in dashboard.ts
19. [ ] Process title "dillobot" in entry.ts
20. [ ] `src/dillobot-version.ts` exists with upstream version
21. [ ] `local-list`, `local-approve`, `local-reject` commands in devices-cli.ts
22. [ ] `pairingHint` in ui/src/ui/views/overview.ts (dashboard pairing instructions)
23. [ ] `isFirstRun` function exported from infra/device-pairing.ts
24. [ ] Dashboard title "DilloBot Control" in ui/index.html
25. [ ] Custom element `dillobot-app` in ui/index.html and ui/src/ui/app.ts
26. [ ] DilloBot colors in ui/src/styles/base.css (green accent #4ade80, forest bg #0a120a)
27. [ ] Brand title "DILLOBOT" in ui/src/ui/app-render.ts
28. [ ] `/dillobot-logo.svg` referenced in ui/src/ui/app-render.ts
29. [ ] `ui/public/dillobot-logo.svg` exists
30. [ ] `ui/public/favicon.svg` has DilloBot armadillo (not lobster)
31. [ ] `@anthropic-ai/claude-agent-sdk` in package.json dependencies
32. [ ] `src/agents/claude-code-sdk-stream.ts` exists
33. [ ] `resolveStreamFnForProvider` import in `src/agents/pi-embedded-runner/run/attempt.ts`
34. [ ] `resolveStreamFnForProvider()` call in attempt.ts streamFn assignment
35. [ ] `claude-code-agent` bypass in `src/agents/model-auth.ts` resolveApiKeyForProvider()
36. [ ] `z.literal("subscription")` in `src/config/zod-schema.ts` auth mode union
37. [ ] SDK configured with `tools: []`, `maxTurns: 1`, `persistSession: false` in claude-code-sdk-stream.ts

---

### 10. DilloBot Branding

**Purpose:** Users must know they are running DilloBot, not OpenClaw. The CLI displays "DilloBot" with the upstream OpenClaw version it's based on.

**Files with `// DILLOBOT-BRANDING-*` markers:**

**`src/cli/banner.ts`:**
- Import from `../dillobot-version.js`
- Title shows `🛡️ DilloBot` instead of `🦞 OpenClaw`
- Banner shows `[OpenClaw vX.X.X]` to indicate upstream version
- ASCII art says "DILLOBOT" with "Armored AI. No compromises."

**`src/cli/tagline.ts`:**
- Default tagline: "Armored AI. No compromises."

**`src/commands/dashboard.ts`:**
- Message says "control DilloBot" not "control OpenClaw"

**`src/entry.ts`:**
- Process title: `"dillobot"` not `"openclaw"`

**`src/dillobot-version.ts`:**
- Exports `UPSTREAM_VERSION`, `UPSTREAM_COMMIT`, etc.
- Auto-updated by sync script

**Why:** Users should clearly know they're running the security-hardened DilloBot fork, not vanilla OpenClaw. The upstream version display helps them understand what base version they're on.

---

### 11. Local-Only Device CLI Commands

**File:** `src/cli/devices-cli.ts`

**Commands Added:**
```typescript
// List devices without gateway connection
devices.command("local-list")
  .description("List pending and paired devices (local files, no gateway needed)")

// Approve a pending device without gateway connection
devices.command("local-approve")
  .description("Approve a pending device (local files, no gateway needed)")
  .argument("<requestId>", "Pending request ID (from local-list)")

// Reject a pending device without gateway connection
devices.command("local-reject")
  .description("Reject a pending device (local files, no gateway needed)")
  .argument("<requestId>", "Pending request ID (from local-list)")
```

**Imports Required:**
```typescript
import {
  approveDevicePairing,
  listDevicePairing,
  rejectDevicePairing,
} from "../infra/device-pairing.js";
```

**Why:** These commands allow device pairing recovery when the user cannot connect to the gateway (bootstrap deadlock scenario). They work directly with local `paired.json` and `pending.json` files.

**Flow:**
1. User visits dashboard → gets "Pairing Required" error
2. User runs `dillobot devices local-list` → sees pending request
3. User runs `dillobot devices local-approve <requestId>` → device is paired
4. User refreshes dashboard → connected

---

### 12. Dashboard Pairing Instructions

**File:** `ui/src/ui/views/overview.ts`

**Added Function:**
```typescript
// DILLOBOT: Pairing hint for when device pairing is required
const pairingHint = (() => {
  if (props.connected || !props.lastError) return null;
  const lower = props.lastError.toLowerCase();
  if (!lower.includes("pairing required")) return null;
  return html`
    <div style="margin-top: 12px; padding: 12px; background: var(--bg-secondary); border-radius: 6px;">
      <div style="font-weight: 500; margin-bottom: 8px;">Device Pairing Required</div>
      <div class="muted" style="margin-bottom: 8px">
        Your browser needs to be paired with the gateway. Run these commands in your terminal:
      </div>
      <div style="font-family: monospace; font-size: 12px; ...">
        <div style="color: var(--text-muted);"># List pending pairing requests</div>
        <div>dillobot devices local-list</div>
        <div style="margin-top: 8px; color: var(--text-muted);"># Approve this browser</div>
        <div>dillobot devices local-approve &lt;requestId&gt;</div>
      </div>
      <div class="muted">Then refresh this page to reconnect.</div>
    </div>
  `;
})();
```

**Rendered In:** Error callout section (after `authHint` and `insecureContextHint`)

**Why:** When users get a "Pairing Required" error, they need clear instructions on how to approve their browser. This surfaces the local-only CLI commands directly in the UI.

---

### 13. Dashboard UI Branding

**Purpose:** The dashboard must show DilloBot branding, colors, and logo instead of OpenClaw.

**Files with `DILLOBOT-BRANDING-*` markers:**

**`ui/src/styles/base.css`:**
- All CSS variables prefixed with `/* DILLOBOT: */` comments
- Color scheme: Forest green backgrounds (#0a120a), green accent (#4ade80), shell/gold secondary (#d4b896)
- Custom element: `dillobot-app` instead of `openclaw-app`

**`ui/index.html`:**
- Title: "DilloBot Control" instead of "OpenClaw Control"
- Custom element: `<dillobot-app>` instead of `<openclaw-app>`

**`ui/src/ui/app.ts`:**
- Custom element registration: `@customElement("dillobot-app")`

**`ui/src/ui/app-render.ts`:**
- Brand logo: `/dillobot-logo.svg` instead of pixel-lobster
- Brand title: "DILLOBOT" instead of "OPENCLAW"
- Docs link: `https://dillobot.ai` instead of `docs.openclaw.ai`

**`ui/src/ui/views/overview.ts`:**
- CLI commands: `dillobot` instead of `openclaw`
- Docs links: `https://dillobot.ai` instead of `docs.openclaw.ai`

**`ui/public/favicon.svg`:**
- DilloBot armadillo logo with shell bands and shield accent

**`ui/public/dillobot-logo.svg`:**
- **NEW** DilloBot armadillo logo for dashboard header

**Test files updated:**
- `ui/src/ui/focus-mode.browser.test.ts`
- `ui/src/ui/chat-markdown.browser.test.ts`
- `ui/src/ui/navigation.browser.test.ts`

**Color Palette:**
```css
/* Shell tones (from website) */
--shell-light: #D4B896;
--shell-mid: #B8956E;
--shell-dark: #8B7355;

/* Security green accent */
--accent: #4ade80;
--accent-hover: #86efac;

/* Forest backgrounds */
--bg: #0a120a;
--bg-elevated: #121f12;
```

**Why:** Users must clearly see they are running DilloBot, not OpenClaw. Consistent branding across CLI and dashboard builds trust.

---

### 14. Claude Agent SDK Integration

**Purpose:** DilloBot uses the Claude Agent SDK (`@anthropic-ai/claude-agent-sdk`) to run agents using the user's Claude subscription instead of requiring API keys.

**Package Required:**
```json
"@anthropic-ai/claude-agent-sdk": "^0.2.29"
```

**Files:**

**`src/agents/claude-code-sdk-auth.ts`:** (DilloBot-only file)
- Checks if Claude CLI is installed (`claude --version`)
- Provides `isClaudeCodeSubscriptionAvailable()` and `getClaudeCodeAuth()`
- Exports `runClaudeCodeCli()` for direct CLI usage

**`src/agents/claude-code-sdk-runner.ts`:** (DilloBot-only file)
- `isClaudeCodeSdkProvider()` - Checks if provider is claude-code-agent
- `getClaudeCodeSdkProviderConfig()` - Returns provider config

**`src/agents/claude-code-sdk-stream.ts`:** (DilloBot-only file)
- `createClaudeCodeSdkStreamFn()` - Creates a streamFn that uses Claude SDK
- `resolveStreamFnForProvider()` - Returns SDK streamFn for claude-code-agent, default otherwise
- `stripToolUseXml()` - Removes `<tool_use>` XML blocks from output (SDK shows these for CLI use)
- Adapts SDK streaming events to pi-ai's `AssistantMessageEventStream` format
- Configures SDK with `tools: []`, `maxTurns: 1`, `persistSession: false` for single-turn completion
- Strips Claude Code's tool-use display XML for clean chatbot output

**`src/agents/pi-embedded-runner/run/attempt.ts`:** (MINIMAL CHANGE - sync-safe)
- Line ~90: Import `resolveStreamFnForProvider` from claude-code-sdk-stream.ts
- Line ~510-511: Single function call replacing streamFn assignment:
```typescript
// DILLOBOT: resolveStreamFnForProvider handles Claude SDK provider detection
activeSession.agent.streamFn = resolveStreamFnForProvider(params.provider, streamSimple);
```

**`src/agents/model-auth.ts`:** (MINIMAL CHANGE - sync-safe)
- Early return at start of `resolveApiKeyForProvider()`:
```typescript
// DILLOBOT: Claude Code SDK uses subscription auth, not API keys
if (provider === "claude-code-agent") {
  return {
    apiKey: "claude-code-subscription", // Marker - SDK handles auth
    source: "claude-code-sdk:subscription",
    mode: "token",
  };
}
```

**`src/commands/auth-choice.apply.claude-code-sdk.ts`:** (DilloBot-only file)
- Handles "claude-code-sdk" auth choice during onboarding
- Creates subscription auth profile with marker token

**`src/agents/models-config.providers.ts`:**
- Detects Claude Code SDK availability
- Registers `claude-code-agent` provider when available

**Config Required:**
User's `~/.openclaw/openclaw.json` should have:
```json
"agents": {
  "defaults": {
    "model": {
      "primary": "claude-code-agent/claude-sonnet-4-5"
    }
  }
}
```

**Why:** This is the core DilloBot feature - using Claude subscription without API keys. The SDK integrates at the `streamFn` level so it uses OpenClaw's full infrastructure (system prompt, tools, session management).

**Upstream Sync Strategy:**
- DilloBot-only files: Safe, won't conflict
- `attempt.ts`: 2 lines changed (import + function call) - low conflict risk
- `model-auth.ts`: Early return at function start - low conflict risk

**Verification Checklist Items (add to main checklist):**
- 31. [ ] `@anthropic-ai/claude-agent-sdk` in package.json dependencies
- 32. [ ] `resolveStreamFnForProvider` import in `src/agents/pi-embedded-runner/run/attempt.ts`
- 33. [ ] `resolveStreamFnForProvider()` call in attempt.ts streamFn assignment
- 34. [ ] `src/agents/claude-code-sdk-stream.ts` exists
- 35. [ ] `claude-code-agent` bypass in `src/agents/model-auth.ts` resolveApiKeyForProvider()
- 36. [ ] `sdk.query()` usage in `src/agents/claude-code-sdk-stream.ts`
- 37. [ ] SDK configured with `tools: []`, `maxTurns: 1`, `persistSession: false`
