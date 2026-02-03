---
summary: "CLI reference for `openclaw security` (audit, vault management, and security fixes)"
read_when:
  - You want to run a quick security audit on config/state
  - You want to apply safe "fix" suggestions (chmod, tighten defaults)
  - You want to check vault status or manage credentials
title: "security"
---

# `openclaw security`

Security tools: audit, vault management, and fixes.

Related:

- Security guide: [Security](/gateway/security)

## Audit

```bash
openclaw security audit
openclaw security audit --deep
openclaw security audit --fix
```

The audit warns when multiple DM senders share the main session and recommends `session.dmScope="per-channel-peer"` (or `per-account-channel-peer` for multi-account channels) for shared inboxes.
It also warns when small models (`<=300B`) are used without sandboxing and with web/browser tools enabled.

## Vault

DilloBot stores credentials in an encrypted vault using AES-256-GCM. No password is required - the encryption key is derived from machine identity.

```bash
# Check vault status
openclaw security vault status

# List stored credential keys
openclaw security vault list

# Force re-migration from plaintext files
openclaw security vault migrate
```

### Vault Features

- **AES-256-GCM encryption**: Authenticated encryption protects credentials at rest
- **PBKDF2 key derivation**: 310,000 iterations for key derivation
- **Machine binding**: Key derived from hostname + homedir + platform (credentials won't decrypt elsewhere)
- **No password required**: Seamless operation without user prompts
- **Corruption recovery**: Auto-backup and fresh start on corrupted vault files
- **Channel credentials**: Telegram, Discord, Slack, WhatsApp tokens stored encrypted

### Migration

On first run, DilloBot automatically migrates plaintext credentials to the vault:
- `~/.openclaw/auth-profiles.json` → API keys, OAuth tokens
- `~/.openclaw/identity/device.json` → Ed25519 private keys
- `~/.openclaw/identity/device-auth.json` → Device auth tokens
- `~/.openclaw/.env` → API keys (OPENAI_API_KEY, etc.)

After migration, plaintext files are securely deleted.
