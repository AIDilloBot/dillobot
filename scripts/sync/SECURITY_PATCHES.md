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

### 7. Central Dispatch Security Integration (Out-of-Band LLM Security Gate)

**File:** `src/auto-reply/dispatch.ts`

**Imports Required:**
```typescript
import { DEFAULT_PROVIDER } from "../agents/defaults.js";
import { logWarn } from "../logger.js";
import { runSecurityGate } from "../security-hardening/injection/security-gate.js";
```

**LLM Provider Parameter Required** in `dispatchInboundMessage`:
```typescript
/** LLM provider for security analysis (e.g., "claude-code-agent", "anthropic") */
llmProvider?: string;
```

**Security Processing Required** at start of `dispatchInboundMessage` (after `finalizeInboundContext`):
```typescript
// DILLOBOT: Run security gate with LLM analysis
// This checks content OUT-OF-BAND - the agent never sees blocked content
const sessionKey = finalized.SessionKey ?? "unknown";
const bodyToCheck = finalized.BodyForAgent ?? finalized.Body ?? "";

// Resolve the LLM provider for security analysis
const provider = params.llmProvider ?? DEFAULT_PROVIDER;

// Run the security gate
const securityResult = await runSecurityGate(bodyToCheck, {
  provider,
  sessionKey,
  senderId: finalized.From,
  channel: finalized.ChatType,
  apiKeys: {
    anthropic: params.cfg.models?.providers?.anthropic?.apiKey,
    openai: params.cfg.models?.providers?.openai?.apiKey,
  },
  enableLLMAnalysis: params.cfg.security?.llmAnalysis?.enabled !== false,
});

// If blocked, alert the user and don't process
if (securityResult.blocked) {
  logWarn(
    `[security-gate] BLOCKED: ${securityResult.blockReason} ` +
      `(session=${sessionKey}, from=${finalized.From})`,
  );

  // Send alert to user via the dispatcher
  if (securityResult.alertMessage) {
    params.dispatcher.sendFinalReply({ text: securityResult.alertMessage });
  }

  // Return early - the agent NEVER sees this content
  return { queuedFinal: false, counts: { tool: 0, block: 0, final: 0 } };
}

// Content passed security gate - proceed with agent processing
// NOTE: Agent receives CLEAN content, no security markers
```

**Key Features:**
- **Out-of-band analysis:** Security checks run separately from the agent context - the agent never sees blocked content
- **LLM-based detection:** Uses Claude Code CLI (`claude -p`) when provider is "claude-code-agent", otherwise uses configured LLM provider
- **User alerts:** When attacks are blocked, alerts are sent via the dispatcher to the user
- **No content wrapping:** Agent receives clean content without security markers that could pollute context

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
12. [ ] `runSecurityGate` called in dispatch.ts (out-of-band LLM security)
13. [ ] `security-gate.ts` and `llm-security-provider.ts` exist in injection/
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
37. [ ] SDK configured with `getSdkToolsConfig()`, `maxTurns: 1`, `persistSession: false` in claude-code-sdk-stream.ts

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
- `getSdkToolsConfig()` - Returns preset tools when context has tools (enables tool execution)
- `stripToolUseXml()` - Removes `<tool_use>` XML blocks from output (SDK shows these for CLI use)
- Adapts SDK streaming events to pi-ai's `AssistantMessageEventStream` format
- Configures SDK with `getSdkToolsConfig()`, `maxTurns: 1`, `persistSession: false`
- Uses preset tools to enable proper tool_use blocks; maxTurns: 1 returns control for pi-agent-core
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
- 37. [ ] SDK configured with `getSdkToolsConfig()`, `maxTurns: 100`, `persistSession: false`
- 46. [ ] `getSdkToolsConfig()` function returns preset tools when context.tools populated
- 38. [ ] `stripToolUseXml()` function in claude-code-sdk-stream.ts
- 39. [ ] SDK stream buffers text (no text_delta during streaming, emits clean at end)
- 40. [ ] `escapeForPrompt()` has optional `stripUnicode` parameter (default: false)
- 41. [ ] `tag_chars` pattern severity is "low" not "high" in injection-filter.ts
- 42. [ ] `unifyChannels` option in SessionConfig type (types.base.ts)
- 43. [ ] `unifyChannels` in SessionSchema (zod-schema.session.ts)
- 44. [ ] `unifyChannels` handling in buildAgentPeerSessionKey (session-key.ts)
- 45. [ ] `unifyChannels` passed through resolve-route.ts
- 47. [ ] `## Memory (MANDATORY)` section header in system-prompt.ts
- 48. [ ] "At Session Start — DO THIS FIRST" subsection with explicit read instructions
- 49. [ ] "Before Answering Questions — MANDATORY" subsection with memory_search requirement
- 50. [ ] "Do NOT skip this" imperative instruction present

---

### 15. SDK Stream Buffering for Clean Output

**Purpose:** The Claude Code SDK outputs tool invocations in multiple formats as part of its "show your work" behavior. For chatbot use, we buffer all text and strip these before emitting clean output.

**File:** `src/agents/claude-code-sdk-stream.ts` (DilloBot-only file)

**Key Functions:**
- `stripToolUseXml()` - Removes all tool invocation formats from text:
  1. XML format: `<tool_use>...</tool_use>` blocks
  2. Text format: `tool:read\nfilename` style invocations
  3. Status lines: `checking...`, `reading...`, etc.
  4. Leftover file paths from tool arguments
- Text is buffered during streaming (no text_delta events emitted)
- At end, tool output is stripped and clean text is emitted as single text_start/delta/end

**Patterns stripped:**
```typescript
// XML blocks
/<tool_use>[\s\S]*?<\/tool_use>/g

// XML-hybrid format: tool:exec with <command> tags
// Format: tool:exec\n<command>...</command>\n</tool:exec>
/tool:exec\s*\n\s*<command>[\s\S]*?<\/command>\s*\n?\s*<\/tool:exec>/gi

// Empty tool:exec blocks (no content between tags)
// Format: tool:exec\n\n</tool:exec>
/tool:[a-z_-]+\s*[\n\r]+\s*<\/tool:[a-z_-]+>/gi

// Generic hybrid: tool:name ... </tool:name>
/tool:[a-z_-]+\s*\n[\s\S]*?<\/tool:[a-z_-]+>/gi

// Orphaned </tool:*> closing tags
/<\/tool:[a-z_-]+>/gi

// Orphaned <command>...</command> blocks
/<command>[\s\S]*?<\/command>/gi

// Text-format tool invocations with multi-line output (tool:read, tool:exec, tool:bash, etc.)
// Uses negative lookahead to capture all output until next tool: or end
/^tool:[a-z_-]+\s*\n(?:(?!tool:)[^\n]*\n?)*/gim

// Standalone orphaned tool: lines
/^tool:[a-z_-]+\s*$/gim

// Status lines (checking..., reading..., executing..., etc.)
/^(?:checking|reading|looking|searching|writing|creating|updating|deleting|running|executing|fetching|loading|saving|calling)[^\n]*\.{3,}\s*\n?/gim

// Leftover file paths from tool arguments
/^(?:\.\/|\/)?[\w\-./]+\.(?:md|txt|ts|js|json|yaml|yml|sh|py|rb|go|rs)\s*$/gim
```

**Why:** Users should see clean responses, not internal tool mechanics that Claude Code CLI normally shows.

---

### 16. Security Filter Unicode Stripping Fix

**Purpose:** The original code stripped Unicode tag characters from ALL messages, causing legitimate Telegram/Slack content to be lost. Now stripping is selective.

**Files:**
- `src/security-hardening/injection/injection-filter.ts`
- `src/security-hardening/injection/content-security.ts`

**Changes:**
- `escapeForPrompt()` now has optional `stripUnicode` parameter (default: false)
- Only strip on specific dangerous patterns (bidi, zero_width), NOT tag_chars
- `tag_chars` severity downgraded from "high" to "low" (false positives on legitimate messages)

**Why:** Telegram messages were being stripped to empty, causing "NO_REPLY" responses.

---

### 17. Unified Sessions Across Channels

**Purpose:** By default, OpenClaw creates separate sessions per channel. DilloBot needs unified context across all platforms.

**Files:**
- `src/config/types.base.ts` - Added `unifyChannels?: boolean` to SessionConfig
- `src/config/zod-schema.session.ts` - Added `unifyChannels` to schema
- `src/routing/session-key.ts` - Added `unifyChannels` param to buildAgentPeerSessionKey
- `src/routing/resolve-route.ts` - Pass `unifyChannels` through routing

**Config:**
```json
"session": {
  "unifyChannels": true
}
```

**Behavior:** When `unifyChannels: true`, ALL messages (Slack channels, Telegram DMs, etc.) route to `agent:main:main` session, giving unified memory across platforms.

**Why:** Users expect Korah to be the same bot with same memory whether on Slack, Telegram, or other channels.

---

### 18. Source Classifier for Trusted Messaging Channels

**Purpose:** The security content wrapper (`<<<EXTERNAL_UNTRUSTED_CONTENT>>>`) should only wrap untrusted sources (email, webhooks), NOT direct user input from messaging channels.

**File:** `src/security-hardening/injection/source-classifier.ts`

**Change:** Added `agent:` pattern to SESSION_KEY_PATTERNS to classify messaging channel sessions as trusted:

```typescript
// DILLOBOT: Agent session keys are trusted user_direct input
// These come from authenticated messaging channels (Slack, Telegram, Discord, webchat, etc.)
// Format: agent:{agentId}:{channel}:{type}:{peerId} or agent:{agentId}:main
{ pattern: /^agent:/i, source: "user_direct" },
```

**Session keys now classified as `user_direct` (high trust, no wrapping):**
- `agent:main:telegram:default:dm:xxx` → Telegram
- `agent:main:slack:channel:xxx` → Slack
- `agent:main:discord:dm:xxx` → Discord
- `agent:main:webchat:dm:xxx` → Dashboard/webchat
- `agent:main:main` → Unified session

**Still classified as low trust (wrapped):**
- `hook:gmail:...` → Email (injection risk)
- `hook:webhook:...` → External webhooks (injection risk)
- `api:...` → External API calls
- `unknown` → Unrecognized sources

**Why:** Without this fix, users saw `<<<EXTERNAL_UNTRUSTED_CONTENT>>>` tags in all their chat messages because session keys like `agent:main:telegram:...` defaulted to "unknown" trust level.

---

### 19. SDK Tool Execution via Preset Tools

**Purpose:** Enable actual tool execution when using Claude Code SDK provider. The SDK handles the full agentic loop including tool execution internally.

**File:** `src/agents/claude-code-sdk-stream.ts`

**Key Architecture Understanding:**
- The Claude Agent SDK is designed to handle the complete agentic loop
- When using preset tools, the SDK executes tools internally using Claude Code's implementations
- The SDK manages: API calls → tool_use blocks → tool execution → tool results → Claude response
- We do NOT intercept tool execution - the SDK handles it end-to-end

**Key Changes:**

1. **`getSdkToolsConfig()` function:**
```typescript
function getSdkToolsConfig(tools: Tool[] | undefined): SdkToolsConfig {
  // Use preset tools so SDK can execute Claude Code tools internally
  if (tools && tools.length > 0) {
    return { type: "preset", preset: "claude_code" };
  }
  return [];
}
```

2. **SDK query configuration with proper maxTurns:**
```typescript
const queryIterator = sdk.query({
  prompt,
  options: {
    tools: toolsConfig,  // preset: "claude_code" when tools present
    // Let Claude work until done - no artificial turn limit
    // Each "turn" = Claude response + tool execution + result processing
    // Complex tasks may need many turns (reading files, running commands, etc.)
    maxTurns: 100,  // Safety limit against infinite loops
    // ...
  },
});
```

**How it works:**
1. When `context.tools` is populated, use `{ type: "preset", preset: "claude_code" }`
2. Claude outputs proper `tool_use` blocks (Bash, Read, Edit, etc.)
3. SDK executes tools internally using Claude Code's tool implementations
4. SDK sends tool results back to Claude
5. Claude processes results and either calls more tools or responds
6. Loop continues until Claude finishes (stop_reason: end_turn) or maxTurns hit

**Critical: maxTurns must be high enough:**
- `maxTurns: 1` = BROKEN - stops after tool_use before Claude can respond
- `maxTurns: 100` = allows complex multi-tool workflows to complete
- Each "turn" includes: Claude response → tool execution → result back to Claude

**Before this fix:**
- SDK was configured with `tools: []` or `maxTurns: 1`
- Claude either output text syntax ("tool:exec") or got cut off after tool execution
- Tools never completed and Claude never gave final answers

**After this fix:**
- SDK uses preset tools with high maxTurns
- SDK handles full agentic loop internally
- Claude can execute multiple tools and respond with final answer

**Why:** Users were seeing partial responses like "Let me check:" followed by nothing, because maxTurns: 1 stopped the SDK before Claude could process tool results and respond.

**Verification:**
- Check `getSdkToolsConfig()` returns preset when tools present
- Check `maxTurns` is 100 (not 1)
- Check SDK query uses `toolsConfig` variable

---

### 20. Real-Time Streaming for SDK Responses

**Purpose:** Provide responsive UX by streaming text as it arrives instead of buffering until the end. Show typing indicators during tool execution.

**File:** `src/agents/claude-code-sdk-stream.ts`

**Key Changes:**

1. **Real-time text streaming:**
```typescript
// Emit text_start immediately when text block starts
if (streamEvent.event?.type === "content_block_start") {
  if (streamEvent.event.content_block?.type === "text") {
    stream.push({ type: "text_start", ... });
    textStartEmitted = true;
  }
}

// Stream text_delta as it arrives (with light stripping)
if (streamEvent.event?.type === "content_block_delta") {
  // Emit cleaned delta for real-time streaming
  const cleanedCurrent = stripToolSyntaxLight(currentText);
  if (cleanedCurrent.length > lastEmittedLength) {
    stream.push({ type: "text_delta", delta: newContent, ... });
  }
}
```

2. **Tool execution handling (no text fragmentation):**
```typescript
if (streamEvent.event.content_block?.type === "tool_use") {
  // Note: We do NOT emit text_end here to avoid fragmenting the response.
  // The complete text will be emitted at the end, ensuring proper markdown formatting.
  // Users see streaming text via text_delta events; the final text_end sends to Telegram.
  isInToolExecution = true;
}
```

**Important:** We previously emitted `text_end` when `tool_use` blocks started, which sent partial text to Telegram before tools ran. This caused text fragmentation where markdown formatting could be split across messages (e.g., "**Bottom" in one message, "line:**" in another). The fix is to accumulate all text and only emit `text_end` at the end with the complete response.

3. **Light stripping function for streaming:**
```typescript
function stripToolSyntaxLight(text: string): string {
  // Only removes obvious tool patterns, less aggressive than full strip
  result = result.replace(/\s*tool:[a-z_-]*$/gi, "");
  result = result.replace(/:\s*$/g, " ");
  return result;
}
```

**Before this fix:**
- All text buffered until the end
- User saw nothing while Claude worked (30+ seconds of silence)
- No indication that tool execution was in progress

**After this fix:**
- Text streams to internal UIs in real-time via `text_delta` events
- Complete response sent to messaging channels (Telegram, etc.) at the end
- Proper markdown formatting preserved (no mid-formatting splits)
- Final cleanup removes any tool syntax that slipped through

**Why:** Users were waiting 30+ seconds with no feedback, not knowing if the bot was working or broken. Now they see immediate responses and status updates.

**Verification:**
- Check `textStartEmitted` variable tracks text streaming state
- Check `lastEmittedLength` tracks what's been sent to user
- Check `stripToolSyntaxLight()` function exists for real-time stripping
- Check "_Working..._" status emitted when tool_use block starts

---

### 21. Immediate Block Reply Delivery (Coalescer Flush on text_end)

**Purpose:** Ensure block replies are delivered immediately when `text_end` is emitted, instead of waiting for the coalescer's idle timeout.

**File:** `src/agents/pi-embedded-subscribe.handlers.messages.ts`

**Problem:**
When Claude Code SDK emits `text_end` before tool execution:
1. The event triggers `onBlockReply` which enqueues payload to the pipeline
2. If coalescing is enabled, the coalescer buffers content waiting for more
3. Coalescer only flushes after `idleMs` timeout (typically 800-2500ms)
4. During tool execution, no new text arrives, so user sees nothing
5. By the time coalescer flushes, the entire tool workflow may be complete

**Root Cause:**
- `text_end` drains the block chunker but NOT the coalescer
- `tool_execution_start` events trigger coalescer flush via `onBlockReplyFlush`
- But SDK executes tools internally - no `tool_execution_start` events are emitted
- So coalescer never gets explicitly flushed, waits for idle timeout

**Solution:**
Call `flushBlockReplyBuffer()` and `onBlockReplyFlush()` when receiving `text_end` events:

```typescript
if (evtType === "text_end" && ctx.state.blockReplyBreak === "text_end") {
  // ... existing chunker drain logic ...

  // DILLOBOT: Also flush the coalescer to ensure messages are sent immediately
  // This is critical for Claude Code SDK where tools execute internally -
  // without this, the coalescer waits for idleMs timeout before sending,
  // causing the user to see nothing until the entire tool execution completes.
  ctx.flushBlockReplyBuffer();
  if (ctx.params.onBlockReplyFlush) {
    void ctx.params.onBlockReplyFlush();
  }
}
```

**Why this works:**
1. SDK emits `text_end` when it detects `tool_use` content block starting
2. This now triggers both chunker drain AND coalescer flush
3. Content is delivered to messaging channel immediately
4. User sees "Let me check..." before tool execution begins
5. Tool execution happens with user already having partial response

**Before this fix:**
- User saw nothing for 30+ seconds (entire tool execution time)
- Text was buffered in coalescer waiting for idle timeout
- Timeout eventually fired but by then entire workflow was done

**After this fix:**
- Text is delivered immediately when `text_end` is emitted
- User sees partial responses before tool execution starts
- Responsive UX even during long tool workflows

**Verification:**
- Check `handleMessageUpdate` calls `flushBlockReplyBuffer()` on text_end
- Check `handleMessageUpdate` calls `onBlockReplyFlush()` on text_end
- Check both calls are inside the `text_end` condition block

---

### 22. SDK Tool Call Filtering (Prevent Infinite Loop)

**Purpose:** Prevent pi-agent-core from re-executing tools that the Claude Code SDK has already executed internally.

**File:** `src/agents/claude-code-sdk-stream.ts`

**Problem:**
The Claude Code SDK handles tools internally with `maxTurns: 100`. By the time we receive the final result, all tools have been executed. However, if the returned message contains `toolCall` content blocks and `stopReason: "toolUse"`, pi-agent-core interprets this as "tools need execution" and attempts to execute them again, causing an infinite loop.

**Root Cause:**
```typescript
// ORIGINAL (BROKEN) CODE:
const hasToolCalls = partialMessage.content.some((c) => c.type === "toolCall");
partialMessage.stopReason = hasToolCalls ? "toolUse" : "stop";
```

This signaled `stopReason: "toolUse"` when tool calls existed, which told pi-agent-core to execute tools that were already executed by the SDK.

**Symptoms:**
- Bot repeats the same answer multiple times
- Gateway shows continuous tool execution in logs
- Same response sent to messaging channel repeatedly
- Loop continues until timeout or manual intervention

**Solution:**
Always set `stopReason: "stop"` and filter out tool call content blocks:

```typescript
// FIXED CODE:
// IMPORTANT: Claude Code SDK handles tools internally with maxTurns.
// By the time we receive the final result, all tools have been executed.
// We must NOT signal "toolUse" or pi-agent-core will try to execute them again.
// Filter out tool call content blocks to prevent downstream code from re-executing.
partialMessage.content = partialMessage.content.filter((c) => c.type !== "toolCall");
partialMessage.stopReason = "stop";
```

**Why this works:**
1. SDK executes tools internally during `sdk.query()`
2. When we receive the final message, tools are already done
3. By filtering out `toolCall` blocks and using `stopReason: "stop"`:
   - pi-agent-core sees no tools to execute
   - Processing completes normally
   - No infinite loop

**Before this fix:**
- Bot entered infinite loop
- Same response repeated indefinitely
- Tools re-executed over and over

**After this fix:**
- Single response delivered
- No duplicate tool execution
- Clean completion flow

**Verification:**
- Check `stopReason` is always set to `"stop"` (never `"toolUse"`)
- Check `partialMessage.content` filters out `type: "toolCall"` blocks
- Check no condition sets `stopReason` based on tool call presence

---

### 23. Mandatory Memory System Prompt

**Purpose:** Ensure the agent proactively uses its memory system at session start and before answering questions about prior context.

**File:** `src/agents/system-prompt.ts`

**Key Changes in `buildMemorySection()`:**

1. **Section header made mandatory:**
```typescript
"## Memory (MANDATORY)",
```

2. **Session start instructions:**
```typescript
"### At Session Start — DO THIS FIRST",
"1. Read `MEMORY.md` (long-term memory)",
"2. Read today's daily file: `memory/YYYY-MM-DD.md` (e.g., `memory/2026-02-02.md`)",
"3. Read yesterday's daily file if relevant context might be there",
"",
"Do NOT skip this. Do NOT ask if you should do it. Just do it silently at session start.",
```

3. **Mandatory before answering:**
```typescript
"### Before Answering Questions — MANDATORY",
"When the user asks about ANY of these, you MUST run `memory_search` FIRST:",
"- Prior work, projects, or decisions",
"- Dates, deadlines, or schedules",
"- People, contacts, or relationships",
"- Preferences or past choices",
"- Todos, tasks, or reminders",
"- \"What did we...\", \"Did I mention...\", \"Remember when...\"",
"",
"After `memory_search`, use `memory_get` to pull the specific lines you need.",
"If you skip this and guess wrong, you will give the user incorrect information.",
```

**Why:** Without forceful imperative language, the LLM knows what it *should* do but doesn't do it automatically. Using "MANDATORY", "MUST", and "DO THIS FIRST" with explicit triggers ensures consistent memory usage.

**Verification:**
- Check `## Memory (MANDATORY)` section header in buildMemorySection
- Check "At Session Start — DO THIS FIRST" subsection exists
- Check "Before Answering Questions — MANDATORY" subsection exists
- Check "Do NOT skip this" instruction is present
