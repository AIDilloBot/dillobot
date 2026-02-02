<p align="center">
  <img src="website/logo.png" alt="DilloBot - Security-hardened fork of OpenClaw" width="500">
</p>

<p align="center">
  <strong>Security-hardened fork of <a href="https://github.com/openclaw/openclaw">OpenClaw</a></strong><br>
  Enterprise-grade security without sacrificing power.
</p>

---

## Upstream Version

<!-- DILLOBOT-UPSTREAM-VERSION-START -->
| | |
|---|---|
| **Based on OpenClaw** | `v2026.2.1-11-gc429ccb64` |
| **Upstream Commit** | [`c429ccb`](https://github.com/openclaw/openclaw/commit/c429ccb64fc319babf4f8adc95df6d658a2d6b2f) |
| **Last Synced** | 2026-02-02 |
| **Commits Behind** | 117 |
<!-- DILLOBOT-UPSTREAM-VERSION-END -->

> This section is automatically updated by the sync agent. See [Upstream Sync](#upstream-sync) for details.

## Why DilloBot?

OpenClaw is excellent, but defaults to convenience over security. DilloBot flips that:

| Feature | OpenClaw | DilloBot |
|---------|----------|----------|
| Local connection auth | Auto-approved | Challenge-response required |
| Credential storage | Plaintext files | Encrypted vault (OS keychain) |
| Prompt injection protection | Basic | 25+ patterns with severity scoring |
| Output filtering | None | Prevents system prompt/config leaks |
| Skill verification | None | SHA256 checksums + optional PGP |
| Security policy | Configurable | Enforced defaults (can't disable) |
| Security audit logging | None | All security events logged |
| Default LLM provider | API keys | Claude Code subscription |

---

## Security Features

### 1. Mandatory Challenge-Response Authentication

All connections require cryptographic challenge-response pairing — even local ones.

**What changed:** `silent: isLocalClient` → `silent: false`

**How it works:**
1. Client connects and receives a random nonce
2. Client signs nonce with device private key
3. Server verifies signature against registered public key
4. New devices must be explicitly approved

**Rate limiting:** Max pairing requests per hour per device (prevents brute force).

---

### 2. Encrypted Credential Vault

Credentials are never stored in plaintext. Platform-specific secure storage:

| Platform | Backend | Encryption |
|----------|---------|------------|
| macOS | Keychain | Hardware-backed |
| Windows | Credential Manager | DPAPI |
| Linux | Secret Service (D-Bus) | libsecret |
| Fallback | Encrypted file | AES-256-GCM |

**AES Fallback Details:**
- Algorithm: AES-256-GCM (authenticated encryption)
- Key derivation: PBKDF2 with 310,000 iterations
- Unique salt and IV per credential
- Keys can be rotated without re-entering credentials

**Auto-migration:** On first run, DilloBot automatically migrates any plaintext credentials from `~/.openclaw/identity/` to the secure vault.

---

### 3. LLM-Based Prompt Injection Protection

DilloBot uses the LLM itself to detect injection attempts semantically, rather than relying on easily-bypassed regex patterns. This catches novel attacks, encoding tricks, and sophisticated social engineering.

**Layered Defense:**

```
Input → Quick Pre-Filter → Source Classification → LLM Analysis → Safe Content
```

**Layer 1: Quick Pre-Filter (15 patterns)**
Only catches things that are NEVER legitimate:
- Dangerous unicode (zero-width chars, RTL overrides, tag characters)
- Known exfil endpoints (Discord/Slack webhooks, requestbin)
- Credential patterns (AWS keys, GitHub tokens, API keys)

**Layer 2: Source Classification**
Different trust levels based on content origin:

| Source | Trust Level | Treatment |
|--------|-------------|-----------|
| Direct user input | High | Quick filter only |
| Skill content | Medium | LLM skill inspection |
| Email content | Low | Full LLM analysis |
| Webhook/API | Low | Full LLM analysis |
| Web content | Low | Full LLM analysis |

**Layer 3: LLM Security Analysis**
For low-trust sources, the LLM analyzes content for:

| Category | What It Detects |
|----------|-----------------|
| Instruction override | "ignore previous", "forget your guidelines" |
| Role manipulation | "you are now DAN", "enable developer mode" |
| Context escape | Fake system tags, delimiter abuse, JSON injection |
| Data exfiltration | "send this to webhook", "forward to my email" |
| Hidden instructions | HTML comments, encoded content, invisible text |
| Social engineering | False claims of authority, urgency, permissions |

**Why LLM-Based?**
- Understands **intent**, not just patterns
- Catches **novel attacks** without pattern updates
- Resistant to **encoding tricks** (LLM sees decoded content)
- **Low false positives** (semantic understanding)
- Different treatment for **trusted vs. untrusted sources**

**Protected Channels:**
All message channels go through the security pipeline:
- Discord, Slack, Telegram, Signal, Line, iMessage
- WhatsApp (via web bridge)
- Email hooks (Gmail, etc.)
- Webhooks and API calls
- Web interface

---

### 4. Output Filtering

Prevents the AI from accidentally leaking sensitive information:

| Leak Type | What's Filtered |
|-----------|-----------------|
| System prompts | Safety instructions, persona definitions |
| Config values | API keys, tokens, internal settings |
| Environment variables | `OPENCLAW_*`, `DILLOBOT_*` patterns |

Output is scanned before delivery. Matches are redacted and logged.

---

### 5. LLM-Based Skill Inspection

Skills are analyzed by your LLM before installation to detect malicious content:

**How it works:**
1. When you install a skill, DilloBot sends it to your LLM for security analysis
2. The LLM scans for prompt injections, data exfiltration, dangerous commands, etc.
3. If issues are found, you're shown the findings and asked to approve or reject
4. Critical issues block installation entirely (no bypass allowed)

**Quick Pre-Check (No LLM needed):**
Before LLM analysis, a fast pattern scan catches obvious red flags:
- Instruction override attempts ("ignore previous instructions")
- Jailbreak patterns ("you are now DAN")
- Encoded payloads (base64 blocks)
- Dangerous shell commands (`curl | sh`, `rm -rf /`)
- Credential access patterns

**Risk Levels:**
| Level | Action |
|-------|--------|
| None/Low | Auto-approved |
| Medium | Warning shown, user can bypass |
| High | Warning shown, user can bypass |
| Critical | Blocked, no bypass allowed |

**Detection Categories:**
- `prompt_injection` — Attempts to override AI behavior
- `data_exfiltration` — Sending data to external services
- `privilege_escalation` — Gaining elevated access
- `obfuscated_code` — Hidden/encoded payloads
- `credential_access` — Reading API keys, tokens
- `system_command` — Dangerous shell commands

**Trusted Skills:**
- Bundled skills are trusted by default
- Add skills to trusted list to skip inspection
- Inspection results are cached per skill content hash

---

### 6. Security Policy Enforcement

Dangerous configuration options are blocked at load time:

```typescript
// These are ALWAYS enforced, regardless of config
{
  connections: {
    allowLocalAutoApprove: false,  // Can't re-enable auto-approve
  },
  credentials: {
    allowPlaintextFallback: false, // Can't store plaintext
  }
}
```

**Blocked config keys:**
- `dangerouslyDisableDeviceAuth`
- `dangerouslyAllowPlaintextStorage`
- Any attempt to set `silent: true` for local connections

---

### 7. Security Audit Logging

All security-relevant events are logged:

| Event Type | When Logged |
|------------|-------------|
| `injection_detected` | Suspicious input found |
| `injection_blocked` | Message rejected |
| `injection_sanitized` | Patterns removed |
| `output_filtered` | Leak prevented |
| `skill_verification_failed` | Tampered skill detected |
| `pairing_attempt` | New device connection |
| `pairing_rejected` | Device denied |
| `vault_access` | Credential retrieved |

Logs include: timestamp, session ID, severity, details.

---

### 8. Secure Memory Handling

Optional hardened memory management:

- **Secure buffers:** Sensitive data in mlock'd memory (can't be swapped to disk)
- **Zero-on-free:** Memory is zeroed before release
- **No logging of secrets:** Credentials never appear in logs

---

### 9. Claude Code SDK Integration

Uses your Claude Code subscription instead of API keys:

**Benefits:**
- No API keys to manage or leak
- Uses existing Claude Code authentication
- Automatic token refresh
- Falls back to Anthropic API if unavailable

**How it works:**
1. DilloBot checks for Claude Code CLI authentication
2. Reads token from `~/.claude/credentials.json`
3. Registers as `claude-code-agent` provider
4. Uses subscription-based auth (no API key needed)

---

## Quick Start

```bash
# Install
npm install -g dillobot@latest

# Run onboarding (sets up secure defaults)
dillobot onboard --install-daemon

# Verify security patches are intact
npm run dillobot:verify
```

## Configuration

DilloBot adds a `security` section to your config:

```json
{
  "security": {
    "vault": {
      "backend": "auto"
    },
    "injection": {
      "quickFilter": {
        "enabled": true,
        "logAttempts": true
      },
      "llmAnalysis": {
        "enabled": true,
        "analyzeAllSources": false,
        "blockThreshold": "critical",
        "warnThreshold": "medium"
      }
    },
    "output": {
      "enabled": true,
      "patterns": {
        "systemPromptLeaks": true,
        "configLeaks": true,
        "tokenLeaks": true
      }
    },
    "skills": {
      "inspectBeforeInstall": true,
      "trustBundledSkills": true,
      "trustedSkills": [],
      "quickCheckOnly": false,
      "blockCritical": true
    },
    "memory": {
      "useSecureBuffers": false,
      "zeroOnFree": true
    }
  }
}
```

---

## Upstream Sync

DilloBot automatically syncs with upstream OpenClaw while preserving security patches:

```bash
# Check for upstream updates
npm run dillobot:sync:check

# Run intelligent sync (uses Claude Code CLI)
npm run dillobot:sync

# Verify security after sync
npm run dillobot:verify
```

The sync agent uses Claude Code to analyze upstream changes and intelligently merge them while ensuring security modifications remain intact.

### Automated Daily Sync

The repository includes a GitHub Actions workflow that:
1. Checks for upstream OpenClaw updates daily at 6 AM UTC
2. Uses Claude Code CLI to analyze and merge changes
3. Preserves all security patches documented in `SECURITY_PATCHES.md`
4. Creates GitHub issues for manual review when conflicts detected

---

## Security Verification

After any update, verify security patches are intact:

```bash
npm run dillobot:verify
```

This checks:
- Auto-approve is disabled (`silent: false`)
- Security policy enforcement is active
- Claude Code SDK integration is present
- Vault module is complete
- Injection filter is present
- Output filter is present
- Skill inspector is present
- All security files exist
- `dillobot` CLI alias is present

---

## Architecture

DilloBot's security enhancements are isolated in `/src/security-hardening/`:

```
src/security-hardening/
├── index.ts                 # Module exports
├── types.ts                 # Type definitions
├── auth/
│   └── challenge-response.ts    # Cryptographic auth
├── injection/
│   ├── content-security.ts      # Unified security entry point
│   ├── injection-filter.ts      # Quick pre-filter (15 critical patterns)
│   ├── injection-analyzer.ts    # LLM-based semantic analysis
│   ├── source-classifier.ts     # Content source/trust classification
│   ├── injection-audit.ts       # Security event logging
│   └── output-filter.ts         # Leak prevention
├── policy/
│   ├── security-policy.ts       # Policy enforcement
│   └── policy-config.ts         # Policy schema
├── skills/
│   ├── skill-verification.ts    # Verification orchestration
│   └── skill-inspector.ts       # LLM-based security analysis
└── vault/
    ├── vault.ts                 # Unified interface
    ├── aes-fallback.ts          # AES-256-GCM encrypted storage
    └── migration.ts             # Plaintext → vault migration
```

This isolation minimizes merge conflicts with upstream OpenClaw.

---

## Files Modified from OpenClaw

| File | Change |
|------|--------|
| `src/gateway/.../message-handler.ts` | `silent: false` (was `isLocalClient`) |
| `src/config/io.ts` | Calls `enforceSecurityPolicy()` |
| `src/config/types.models.ts` | Added `claude-code-agent` provider |
| `src/config/types.openclaw.ts` | Added `security` config section |
| `src/agents/models-config.providers.ts` | Claude Code SDK detection |
| `package.json` | Added `dillobot` CLI alias |

---

## Credits

DilloBot is built on top of [OpenClaw](https://github.com/openclaw/openclaw) by the OpenClaw team. We're grateful for their excellent work on the core assistant platform.

## License

MIT — same as OpenClaw.

---

<p align="center">
  <a href="https://dillo.bot">Website</a> •
  <a href="https://github.com/AIDilloBot/dillobot/issues">Issues</a> •
  <a href="https://github.com/openclaw/openclaw">Upstream OpenClaw</a>
</p>
