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
    echo "✅ subscription auth mode present"
else
    echo "⚠️  WARNING: subscription auth mode missing"
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
else
    echo "❌ CRITICAL: security-hardening module missing!"
    ERRORS=$((ERRORS + 1))
fi

# Check 6: Claude Code SDK files
echo ""
echo "Checking Claude Code SDK files..."
for file in src/agents/claude-code-sdk-auth.ts src/agents/claude-code-sdk-runner.ts src/config/types.security.ts; do
    if [ -f "$file" ]; then
        echo "✅ $file"
    else
        echo "⚠️  WARNING: $file missing"
        WARNINGS=$((WARNINGS + 1))
    fi
done

# Check 7: Provider detection
echo ""
echo "Checking provider detection..."
if grep -q "isClaudeCodeSubscriptionAvailable" src/agents/models-config.providers.ts 2>/dev/null; then
    echo "✅ Claude Code SDK provider detection present"
else
    echo "⚠️  WARNING: Claude Code SDK provider detection missing"
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
