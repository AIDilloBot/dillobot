<!-- DILLOBOT-BRANDING - Protected from upstream sync -->
# Security Policy

DilloBot is a security-hardened fork of OpenClaw. Security is our top priority.

## Reporting Vulnerabilities

**Do not** report security vulnerabilities through public GitHub issues.

### Private Reporting

- **Email**: [security@dillo.bot](mailto:security@dillo.bot)
- **GitHub**: [Report a vulnerability](https://github.com/AIDilloBot/dillobot/security/advisories/new)

Please include:
- Description of the vulnerability
- Steps to reproduce
- Potential impact
- Suggested fix (if any)

We aim to respond within 48 hours and will keep you updated on the fix progress.

## Scope

### In Scope
- Authentication and authorization bypasses
- Encrypted vault vulnerabilities
- Prompt injection bypasses
- Skill verification bypasses
- Remote code execution
- Data exfiltration vulnerabilities
- Credential exposure

### Out of Scope
- Issues in upstream OpenClaw (report those to OpenClaw directly)
- Social engineering attacks
- Physical access attacks
- Denial of service attacks
- Issues requiring unlikely user interaction

## Security Features

DilloBot includes multiple security layers:

1. **Claude Code SDK Auth** - No API keys stored locally
2. **Encrypted Vault** - AES-256-GCM for secrets at rest
3. **Prompt Injection Protection** - Multi-layer filtering
4. **Skill Verification** - LLM analysis before installation
5. **Path Traversal Protection** - Sandboxed file access
6. **Credential Detection** - Prevents accidental exposure
7. **External Content Isolation** - Wrapped untrusted inputs

## Runtime Requirements

### Node.js Version

DilloBot requires **Node.js 20+** (22+ recommended). Keep Node.js updated for security patches.

```bash
node --version  # Should be v20.0.0 or later
```

## Security Scanning

Run the security verification:

```bash
./scripts/sync/verify-security.sh
```

Or use the doctor command:

```bash
dillobot doctor
```

## Bug Bounty

DilloBot is an open-source community project. **There is no paid bug bounty program.** We appreciate responsible disclosure but cannot offer financial compensation for reports.

We will:
- Credit you publicly (if desired) when fixes are released
- Add you to our security hall of fame in the README

## Responsible Disclosure

We follow responsible disclosure practices:
- We will acknowledge receipt within 48 hours
- We will provide an initial assessment within 7 days
- We will work with you to understand and resolve the issue
- We will credit you (if desired) when the fix is released

Thank you for helping keep DilloBot secure.

*Armored AI. No compromises.*
