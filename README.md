# DilloBot — Security-Hardened AI Assistant

<p align="center">
  <img src="https://dillo.bot/logo.png" alt="DilloBot" width="300">
</p>

<p align="center">
  <strong>Armored AI. No compromises.</strong>
</p>

<p align="center">
  <a href="https://github.com/AIDilloBot/dillobot/actions/workflows/ci.yml?branch=main"><img src="https://img.shields.io/github/actions/workflow/status/AIDilloBot/dillobot/ci.yml?branch=main&style=for-the-badge" alt="CI status"></a>
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
| Prompt injection protection | Basic | Advanced pattern detection |
| Skill verification | None | SHA256 checksums |
| Security policy | Configurable | Enforced defaults |
| Default LLM provider | API keys | Claude Code subscription |

## Security Features

### Mandatory Authentication
All connections require challenge-response pairing — even local ones. No more `silent: isLocalClient` bypasses.

### Encrypted Credential Vault
Credentials are stored in your OS keychain:
- **macOS**: Keychain
- **Windows**: Credential Manager
- **Linux**: Secret Service (D-Bus)
- **Fallback**: AES-256-GCM encrypted file with PBKDF2 key derivation

### Prompt Injection Protection
25+ detection patterns with severity scoring. Suspicious inputs are logged and can be sanitized or blocked.

### Skill Verification
Skills are verified against SHA256 checksums before loading. Optional PGP signature verification for high-security deployments.

### Security Policy Enforcement
Dangerous configuration options are blocked at load time. You can't accidentally disable security features.

### Claude Code SDK Integration
Uses your Claude Code subscription as the default LLM provider — no API keys to manage or leak.

## Quick Start

```bash
# Install
npm install -g dillobot@latest

# Run onboarding (sets up secure defaults)
dillobot onboard --install-daemon

# Verify security patches are intact
npm run dillobot:verify
```

## Claude Code Integration

DilloBot prefers Claude Code subscription authentication over API keys:

1. Install and authenticate [Claude Code CLI](https://claude.ai/code)
2. DilloBot automatically detects your subscription
3. No API keys needed — uses your existing Claude Code auth

```bash
# Check if Claude Code is available
claude --version

# DilloBot will auto-detect and use it
dillobot gateway
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
      "mode": "sanitize",
      "logAttempts": true
    },
    "skills": {
      "requireVerification": true
    }
  }
}
```

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
1. Checks for upstream OpenClaw updates daily
2. Uses Claude Code CLI to analyze and merge changes
3. Preserves all security patches
4. Creates issues for manual review when needed

## Security Verification

After any update, verify security patches are intact:

```bash
npm run dillobot:verify
```

This checks:
- Auto-approve is disabled
- Security policy enforcement is active
- Claude Code SDK integration is present
- Vault module is complete
- All security files exist

## Architecture

DilloBot's security enhancements are isolated in `/src/security-hardening/`:

```
src/security-hardening/
  index.ts              # Module exports
  types.ts              # Type definitions
  policy/               # Security policy enforcement
  vault/                # Encrypted credential storage
  injection/            # Prompt injection protection
  skills/               # Skill verification
  auth/                 # Challenge-response auth
```

This isolation minimizes merge conflicts with upstream OpenClaw.

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
