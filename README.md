# DilloBot — Security-Hardened AI Assistant

<p align="center">
  <img src="https://dillo.bot/logo.png" alt="DilloBot" width="300">
</p>

<p align="center">
  <strong>Armored AI. No compromises.</strong>
</p>

<p align="center">
  <a href="https://github.com/AIDilloBot/dillobot/actions/workflows/install-smoke.yml?branch=main"><img src="https://img.shields.io/github/actions/workflow/status/AIDilloBot/dillobot/install-smoke.yml?branch=main&style=for-the-badge" alt="CI status"></a>
  <a href="https://github.com/AIDilloBot/dillobot/releases"><img src="https://img.shields.io/github/v/release/AIDilloBot/dillobot?include_prereleases&style=for-the-badge" alt="GitHub release"></a>
  <a href="https://dillo.bot"><img src="https://img.shields.io/badge/Website-dillo.bot-blue?style=for-the-badge" alt="Website"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/License-MIT-blue.svg?style=for-the-badge" alt="MIT License"></a>
</p>

**DilloBot** is a security-hardened fork of [OpenClaw](https://github.com/openclaw/openclaw), the open-source personal AI assistant. DilloBot adds enterprise-grade security features while maintaining full compatibility with upstream OpenClaw.

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

### 3. Prompt Injection Protection

25+ detection patterns catch common injection attacks:

| Category | Examples |
|----------|----------|
| Instruction override | "ignore previous instructions", "disregard all rules" |
| Role manipulation | "you are now DAN", "pretend you're unrestricted" |
| Context injection | XML/JSON injection, fake system messages |
| Encoding attacks | Base64 payloads, unicode tricks |
| Tool invocation | Fake tool calls, function injection |

**Severity scoring:** Each match adds to a cumulative score. Configurable thresholds for:
- **Warn** — Log the attempt, continue processing
- **Sanitize** — Remove detected patterns, continue
- **Block** — Reject the message entirely

**Whitelist support:** Trusted sessions/senders can be exempted.

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

### 5. Skill Verification

Skills are verified before loading to prevent tampering:

**SHA256 Checksums:**
- Each skill has a known-good checksum
- Modified skills are rejected or flagged
- Checksum store at `~/.dillobot/checksums.json`

**Optional PGP Signatures:**
- Skills can be signed by trusted publishers
- Configure trusted signer fingerprints
- Unsigned skills can be blocked in high-security mode

```typescript
// Verification result
{
  valid: boolean;
  reason?: "checksum_mismatch" | "signature_invalid" | "key_untrusted";
  expected?: string;
  actual?: string;
}
```

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
      "enabled": true,
      "mode": "sanitize",
      "logAttempts": true,
      "thresholds": {
        "warn": 20,
        "sanitize": 50,
        "block": 80
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
      "requireVerification": true,
      "requireChecksum": true,
      "requireSignature": false,
      "trustedSigners": []
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
- Skill verification is present
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
│   ├── injection-filter.ts      # Input scanning (25+ patterns)
│   ├── injection-audit.ts       # Security event logging
│   └── output-filter.ts         # Leak prevention
├── policy/
│   ├── security-policy.ts       # Policy enforcement
│   └── policy-config.ts         # Policy schema
├── skills/
│   ├── skill-verification.ts    # SHA256 + PGP verification
│   └── checksum-store.ts        # Known-good checksums
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
