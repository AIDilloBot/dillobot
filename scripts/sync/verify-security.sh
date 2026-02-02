#!/bin/bash
# DilloBot Security Verification Script
# Run this after any upstream sync to verify security patches are intact

set -e

echo "🔒 DilloBot Security Verification"
echo "=================================="
echo ""

ERRORS=0
WARNINGS=0

# Check 1: Auto-approve disabled
echo "Checking auto-approve status..."
if grep -q "silent: isLocalClient" src/gateway/server/ws-connection/message-handler.ts 2>/dev/null; then
    echo "❌ CRITICAL: Auto-approve is RE-ENABLED in message-handler.ts!"
    echo "   Fix: Change 'silent: isLocalClient' to 'silent: false'"
    ERRORS=$((ERRORS + 1))
elif grep -q "silent: false" src/gateway/server/ws-connection/message-handler.ts 2>/dev/null; then
    echo "✅ Auto-approve disabled (silent: false)"
else
    echo "❌ CRITICAL: Cannot find silent flag in message-handler.ts"
    ERRORS=$((ERRORS + 1))
fi

# Check 2: Security policy enforcement
echo ""
echo "Checking security policy enforcement..."
if grep -q "enforceSecurityPolicy" src/config/io.ts 2>/dev/null; then
    echo "✅ Security policy enforcement present in io.ts"
else
    echo "❌ CRITICAL: enforceSecurityPolicy missing from io.ts!"
    ERRORS=$((ERRORS + 1))
fi

# Check 3: Claude Code SDK types
echo ""
echo "Checking Claude Code SDK integration..."
if grep -q "claude-code-agent" src/config/types.models.ts 2>/dev/null; then
    echo "✅ claude-code-agent type present in ModelApi"
else
    echo "⚠️  WARNING: claude-code-agent missing from ModelApi"
    WARNINGS=$((WARNINGS + 1))
fi

if grep -q '"subscription"' src/config/types.models.ts 2>/dev/null; then
    echo "✅ subscription auth mode present in types.models.ts"
else
    echo "⚠️  WARNING: subscription auth mode missing from types.models.ts"
    WARNINGS=$((WARNINGS + 1))
fi

# Check 3b: SubscriptionCredential type support
if grep -q "SubscriptionCredential" src/agents/auth-profiles/types.ts 2>/dev/null; then
    echo "✅ SubscriptionCredential type present in auth-profiles/types.ts"
else
    echo "⚠️  WARNING: SubscriptionCredential type missing from auth-profiles/types.ts"
    WARNINGS=$((WARNINGS + 1))
fi

if grep -q '"subscription"' src/config/types.auth.ts 2>/dev/null; then
    echo "✅ subscription mode present in AuthProfileConfig"
else
    echo "⚠️  WARNING: subscription mode missing from AuthProfileConfig"
    WARNINGS=$((WARNINGS + 1))
fi

# Check 4: Security config type
echo ""
echo "Checking security config integration..."
if grep -q "SecurityConfig" src/config/types.openclaw.ts 2>/dev/null; then
    echo "✅ SecurityConfig integrated in OpenClawConfig"
else
    echo "⚠️  WARNING: SecurityConfig missing from OpenClawConfig"
    WARNINGS=$((WARNINGS + 1))
fi

# Check 5: Security module
echo ""
echo "Checking security hardening module..."
if [ -d "src/security-hardening" ]; then
    echo "✅ security-hardening directory exists"

    # Check key files
    for file in index.ts types.ts; do
        if [ -f "src/security-hardening/$file" ]; then
            echo "   ✅ $file"
        else
            echo "   ❌ $file missing"
            ERRORS=$((ERRORS + 1))
        fi
    done

    # Check subdirectories
    for dir in policy vault injection skills auth; do
        if [ -d "src/security-hardening/$dir" ]; then
            echo "   ✅ $dir/"
        else
            echo "   ❌ $dir/ missing"
            ERRORS=$((ERRORS + 1))
        fi
    done

    # Check skill inspector (LLM-based inspection)
    if [ -f "src/security-hardening/skills/skill-inspector.ts" ]; then
        echo "   ✅ skills/skill-inspector.ts (LLM-based inspection)"
    else
        echo "   ❌ skills/skill-inspector.ts missing (LLM-based inspection)"
        ERRORS=$((ERRORS + 1))
    fi

    if [ -f "src/security-hardening/skills/skill-verification.ts" ]; then
        echo "   ✅ skills/skill-verification.ts"
    else
        echo "   ❌ skills/skill-verification.ts missing"
        ERRORS=$((ERRORS + 1))
    fi

    # Check LLM-based injection analyzer
    if [ -f "src/security-hardening/injection/injection-analyzer.ts" ]; then
        echo "   ✅ injection/injection-analyzer.ts (LLM-based analysis)"
    else
        echo "   ❌ injection/injection-analyzer.ts missing (LLM-based analysis)"
        ERRORS=$((ERRORS + 1))
    fi

    if [ -f "src/security-hardening/injection/source-classifier.ts" ]; then
        echo "   ✅ injection/source-classifier.ts"
    else
        echo "   ❌ injection/source-classifier.ts missing"
        ERRORS=$((ERRORS + 1))
    fi

    if [ -f "src/security-hardening/injection/content-security.ts" ]; then
        echo "   ✅ injection/content-security.ts (unified entry point)"
    else
        echo "   ❌ injection/content-security.ts missing (unified entry point)"
        ERRORS=$((ERRORS + 1))
    fi
else
    echo "❌ CRITICAL: security-hardening module missing!"
    ERRORS=$((ERRORS + 1))
fi

# Check 6: Claude Code SDK files
echo ""
echo "Checking Claude Code SDK files..."
for file in src/agents/claude-code-sdk-auth.ts src/agents/claude-code-sdk-runner.ts src/config/types.security.ts src/commands/auth-choice.apply.claude-code-sdk.ts; do
    if [ -f "$file" ]; then
        echo "✅ $file"
    else
        echo "⚠️  WARNING: $file missing"
        WARNINGS=$((WARNINGS + 1))
    fi
done

# Check: Claude Code SDK is default auth option
if grep -q "claude-code-sdk" src/commands/auth-choice-options.ts 2>/dev/null; then
    echo "✅ Claude Code SDK is available as auth option"
else
    echo "⚠️  WARNING: Claude Code SDK not in auth options"
    WARNINGS=$((WARNINGS + 1))
fi

# Check 7: Provider detection
echo ""
echo "Checking provider detection..."
if grep -q "isClaudeCodeSubscriptionAvailable" src/agents/models-config.providers.ts 2>/dev/null; then
    echo "✅ Claude Code SDK provider detection present"
else
    echo "⚠️  WARNING: Claude Code SDK provider detection missing"
    WARNINGS=$((WARNINGS + 1))
fi

# Check 8: DilloBot CLI alias
echo ""
echo "Checking DilloBot CLI alias..."
if grep -q '"dillobot"' package.json 2>/dev/null; then
    echo "✅ dillobot CLI alias present in package.json"
else
    echo "⚠️  WARNING: dillobot CLI alias missing from package.json"
    WARNINGS=$((WARNINGS + 1))
fi

# Check 9: Central dispatch security integration
echo ""
echo "Checking central dispatch security integration..."
if grep -q "processContentSecurity" src/auto-reply/dispatch.ts 2>/dev/null; then
    echo "✅ processContentSecurity integrated in dispatch.ts"
else
    echo "❌ CRITICAL: processContentSecurity missing from dispatch.ts!"
    echo "   This is required to protect ALL message channels."
    ERRORS=$((ERRORS + 1))
fi

if grep -q "shouldBlockImmediately" src/auto-reply/dispatch.ts 2>/dev/null; then
    echo "✅ shouldBlockImmediately integrated in dispatch.ts"
else
    echo "❌ CRITICAL: shouldBlockImmediately missing from dispatch.ts!"
    ERRORS=$((ERRORS + 1))
fi

# Check 10: Cron/isolated agent security integration
echo ""
echo "Checking cron agent security integration..."
if grep -q "shouldBlockImmediately" src/cron/isolated-agent/run.ts 2>/dev/null; then
    echo "✅ Security checks present in cron/isolated-agent/run.ts"
else
    echo "⚠️  WARNING: Security checks missing from cron/isolated-agent/run.ts"
    WARNINGS=$((WARNINGS + 1))
fi

# Summary
echo ""
echo "=================================="
echo "Verification Summary"
echo "=================================="

if [ $ERRORS -eq 0 ] && [ $WARNINGS -eq 0 ]; then
    echo "🎉 All checks passed! DilloBot security is intact."
    exit 0
elif [ $ERRORS -eq 0 ]; then
    echo "⚠️  $WARNINGS warnings (non-critical)"
    echo "   Security is intact but some features may be missing."
    exit 0
else
    echo "❌ $ERRORS critical errors, $WARNINGS warnings"
    echo "   SECURITY PATCHES ARE DAMAGED - FIX IMMEDIATELY!"
    exit 1
fi
