# DilloBot Security Patches

This document describes the security modifications made to OpenClaw that MUST be preserved during upstream syncs.

## Critical Patches

### 1. Disable Auto-Approve for Local Connections

**File:** `src/gateway/server/ws-connection/message-handler.ts`
**Line:** ~640
**Change:** `silent: isLocalClient` → `silent: false`

```typescript
// MUST BE:
silent: false, // DILLOBOT: Never auto-approve, even local connections

// MUST NOT BE:
silent: isLocalClient,
```

**Why:** Prevents automatic authentication bypass for local connections. All connections must go through challenge-response pairing.

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

### 4. Security Config Type Integration

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

1. [ ] `silent: false` in message-handler.ts (not `silent: isLocalClient`)
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
