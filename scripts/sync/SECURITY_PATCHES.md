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

### 5. Claude Code SDK Provider Detection

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
