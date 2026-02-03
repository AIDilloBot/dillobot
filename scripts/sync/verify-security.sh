#!/bin/bash
# DilloBot Security Verification Script
# Run this after any upstream sync to verify security patches are intact

set -e

echo "🔒 DilloBot Security Verification"
echo "=================================="
echo ""

ERRORS=0
WARNINGS=0

# Check 1: First-run only auto-approve
echo "Checking first-run only auto-approve..."
if grep -q "isLocalClient && (await isFirstRun())" src/gateway/server/ws-connection/message-handler.ts 2>/dev/null; then
    echo "✅ First-run only auto-approve (isLocalClient && isFirstRun)"
elif grep -q "silent: isLocalClient," src/gateway/server/ws-connection/message-handler.ts 2>/dev/null; then
    echo "❌ CRITICAL: Unsafe auto-approve! isLocalClient without isFirstRun check"
    echo "   Fix: Change to 'silent: isLocalClient && (await isFirstRun())'"
    ERRORS=$((ERRORS + 1))
elif grep -q "silent: false" src/gateway/server/ws-connection/message-handler.ts 2>/dev/null; then
    echo "⚠️  WARNING: Auto-approve completely disabled (silent: false)"
    echo "   Expected: isLocalClient && isFirstRun for first-run bootstrap"
    WARNINGS=$((WARNINGS + 1))
else
    echo "❌ CRITICAL: Cannot find silent flag in message-handler.ts"
    ERRORS=$((ERRORS + 1))
fi

# Check 1b: isFirstRun function
if grep -q "export async function isFirstRun" src/infra/device-pairing.ts 2>/dev/null; then
    echo "✅ isFirstRun function exported from device-pairing.ts"
else
    echo "❌ CRITICAL: isFirstRun function missing from device-pairing.ts"
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

# Check 3c: Zod schema includes subscription mode
if grep -q 'z.literal("subscription")' src/config/zod-schema.ts 2>/dev/null; then
    echo "✅ subscription mode in Zod schema"
else
    echo "❌ CRITICAL: subscription mode missing from Zod schema (zod-schema.ts)"
    echo "   Config validation will reject Claude Code SDK auth profiles!"
    ERRORS=$((ERRORS + 1))
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

    # Check skill installation security integration
    if grep -q "verifySkillForInstallation" src/agents/skills-install.ts 2>/dev/null; then
        echo "   ✅ skills-install.ts imports verifySkillForInstallation"
    else
        echo "   ❌ skills-install.ts missing verifySkillForInstallation import"
        echo "      Skill security verification will NOT run during installation!"
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

    # Check security gate (out-of-band LLM analysis)
    if [ -f "src/security-hardening/injection/security-gate.ts" ]; then
        echo "   ✅ injection/security-gate.ts (out-of-band LLM security)"
    else
        echo "   ❌ injection/security-gate.ts missing (out-of-band LLM security)"
        ERRORS=$((ERRORS + 1))
    fi

    if [ -f "src/security-hardening/injection/llm-security-provider.ts" ]; then
        echo "   ✅ injection/llm-security-provider.ts (LLM provider abstraction)"
    else
        echo "   ❌ injection/llm-security-provider.ts missing (LLM provider abstraction)"
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

# Check: Claude Agent SDK package
if grep -q "@anthropic-ai/claude-agent-sdk" package.json 2>/dev/null; then
    echo "✅ Claude Agent SDK package in dependencies"
else
    echo "⚠️  WARNING: @anthropic-ai/claude-agent-sdk missing from package.json"
    WARNINGS=$((WARNINGS + 1))
fi

# Check: SDK integration at streamFn level (new architecture)
# The SDK is now integrated via resolveStreamFnForProvider in attempt.ts
if grep -q "resolveStreamFnForProvider" src/agents/pi-embedded-runner/run/attempt.ts 2>/dev/null; then
    echo "✅ resolveStreamFnForProvider import in attempt.ts (streamFn-level SDK integration)"
else
    echo "❌ CRITICAL: resolveStreamFnForProvider missing from attempt.ts"
    echo "   The Claude Agent SDK streamFn integration is missing!"
    ERRORS=$((ERRORS + 1))
fi

# Check: SDK stream module exists and has provider detection
if grep -q "isClaudeCodeSdkProvider" src/agents/claude-code-sdk-stream.ts 2>/dev/null; then
    echo "✅ isClaudeCodeSdkProvider used in claude-code-sdk-stream.ts"
else
    echo "❌ CRITICAL: isClaudeCodeSdkProvider missing from claude-code-sdk-stream.ts"
    ERRORS=$((ERRORS + 1))
fi

# Check: SDK stream has clean output stripping (no tool_use XML in chat)
if grep -q "stripToolUseXml" src/agents/claude-code-sdk-stream.ts 2>/dev/null; then
    echo "✅ stripToolUseXml function in claude-code-sdk-stream.ts (clean output)"
else
    echo "⚠️  WARNING: stripToolUseXml missing - tool_use XML may appear in chat"
    WARNINGS=$((WARNINGS + 1))
fi

# Check: SDK stream strips text-format tool invocations (tool:read, tool:exec, etc.)
if grep -q 'tool:\[a-z_-\]' src/agents/claude-code-sdk-stream.ts 2>/dev/null; then
    echo "✅ Text-format tool stripping (tool:read, tool:exec) in claude-code-sdk-stream.ts"
else
    echo "⚠️  WARNING: Text-format tool stripping missing - tool:read/exec may appear in chat"
    WARNINGS=$((WARNINGS + 1))
fi

# Check: SDK stream handles multi-line tool output with negative lookahead
if grep -q '(?!tool:)' src/agents/claude-code-sdk-stream.ts 2>/dev/null; then
    echo "✅ Multi-line tool output stripping (negative lookahead) present"
else
    echo "⚠️  WARNING: Multi-line tool output stripping may be incomplete"
    WARNINGS=$((WARNINGS + 1))
fi

# Check: SDK stream strips XML-hybrid format (tool:exec with <command> tags)
if grep -q '<command>' src/agents/claude-code-sdk-stream.ts 2>/dev/null; then
    echo "✅ XML-hybrid tool format stripping (tool:exec <command>) present"
else
    echo "⚠️  WARNING: XML-hybrid tool format stripping missing - tool:exec blocks may appear"
    WARNINGS=$((WARNINGS + 1))
fi

# Check: SDK stream has getSdkToolsConfig for proper tool execution
# This function enables tool_use blocks by using preset tools when context has tools
if grep -q "getSdkToolsConfig" src/agents/claude-code-sdk-stream.ts 2>/dev/null; then
    echo "✅ getSdkToolsConfig function present (enables tool execution)"
else
    echo "❌ CRITICAL: getSdkToolsConfig missing - tools will not execute!"
    echo "   Without this, SDK uses tools: [] and Claude outputs text-based tool syntax"
    ERRORS=$((ERRORS + 1))
fi

# Check: SDK stream uses preset tools when context has tools
if grep -q 'preset.*claude_code' src/agents/claude-code-sdk-stream.ts 2>/dev/null; then
    echo "✅ Preset tools used for tool execution (preset: claude_code)"
else
    echo "⚠️  WARNING: Preset tools configuration may be missing"
    WARNINGS=$((WARNINGS + 1))
fi

# Check: SDK stream has high maxTurns for multi-tool workflows
# maxTurns: 1 is BROKEN - stops before Claude can respond after tool execution
if grep -q 'maxTurns: 100' src/agents/claude-code-sdk-stream.ts 2>/dev/null; then
    echo "✅ maxTurns: 100 (allows multi-tool workflows)"
elif grep -q 'maxTurns: 1' src/agents/claude-code-sdk-stream.ts 2>/dev/null; then
    echo "❌ CRITICAL: maxTurns: 1 will break tool execution!"
    echo "   SDK stops after tool_use before Claude can process results and respond"
    echo "   Change to maxTurns: 100 to allow complete agentic workflows"
    ERRORS=$((ERRORS + 1))
else
    echo "⚠️  WARNING: maxTurns setting not found or unexpected value"
    WARNINGS=$((WARNINGS + 1))
fi

# Check: SDK runner has provider detection function
if grep -q "export function isClaudeCodeSdkProvider" src/agents/claude-code-sdk-runner.ts 2>/dev/null; then
    echo "✅ isClaudeCodeSdkProvider exported from claude-code-sdk-runner.ts"
else
    echo "⚠️  WARNING: isClaudeCodeSdkProvider export missing from claude-code-sdk-runner.ts"
    WARNINGS=$((WARNINGS + 1))
fi

# Check: SDK stream has real-time streaming support
if grep -q "textStartEmitted" src/agents/claude-code-sdk-stream.ts 2>/dev/null; then
    echo "✅ Real-time text streaming support (textStartEmitted tracking)"
else
    echo "⚠️  WARNING: Real-time streaming may not be implemented"
    WARNINGS=$((WARNINGS + 1))
fi

# Check: SDK stream has light stripping for streaming
if grep -q "stripToolSyntaxLight" src/agents/claude-code-sdk-stream.ts 2>/dev/null; then
    echo "✅ Light stripping function for real-time streaming"
else
    echo "⚠️  WARNING: stripToolSyntaxLight function missing - streaming may show tool syntax"
    WARNINGS=$((WARNINGS + 1))
fi

# Check: SDK stream emits typing indicator during tool execution
if grep -q "_Working\.\.\._" src/agents/claude-code-sdk-stream.ts 2>/dev/null; then
    echo "✅ Typing indicator during tool execution (_Working..._)"
else
    echo "⚠️  WARNING: No typing indicator during tool execution"
    WARNINGS=$((WARNINGS + 1))
fi

# Check: Coalescer flush on text_end for immediate delivery
# Without this, messages wait for coalescer idle timeout before sending
if grep -q "flushBlockReplyBuffer" src/agents/pi-embedded-subscribe.handlers.messages.ts 2>/dev/null; then
    echo "✅ flushBlockReplyBuffer called in message handlers"
else
    echo "⚠️  WARNING: flushBlockReplyBuffer not found - messages may be delayed"
    WARNINGS=$((WARNINGS + 1))
fi

if grep -q "onBlockReplyFlush" src/agents/pi-embedded-subscribe.handlers.messages.ts 2>/dev/null; then
    echo "✅ onBlockReplyFlush called in message handlers"
else
    echo "⚠️  WARNING: onBlockReplyFlush not in message handlers - coalescer may not flush"
    WARNINGS=$((WARNINGS + 1))
fi

# Check: SDK tool call filtering (prevent infinite loop)
# The SDK handles tools internally - we must NOT signal "toolUse" stopReason
if grep -q 'stopReason = "stop"' src/agents/claude-code-sdk-stream.ts 2>/dev/null; then
    echo "✅ SDK always returns stopReason: stop (not toolUse)"
else
    echo "❌ CRITICAL: SDK may return stopReason: toolUse causing infinite loop!"
    ERRORS=$((ERRORS + 1))
fi

if grep -q 'filter.*toolCall' src/agents/claude-code-sdk-stream.ts 2>/dev/null; then
    echo "✅ SDK filters out toolCall content blocks"
else
    echo "⚠️  WARNING: SDK may not filter toolCall blocks - could cause duplicate execution"
    WARNINGS=$((WARNINGS + 1))
fi

# Verify NO condition sets stopReason based on hasToolCalls
if grep -q 'hasToolCalls.*toolUse' src/agents/claude-code-sdk-stream.ts 2>/dev/null; then
    echo "❌ CRITICAL: SDK sets stopReason based on hasToolCalls - will cause infinite loop!"
    echo "   Fix: Always use stopReason = 'stop' for SDK responses"
    ERRORS=$((ERRORS + 1))
else
    echo "✅ SDK does not set stopReason based on hasToolCalls"
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
if grep -q "runSecurityGate" src/auto-reply/dispatch.ts 2>/dev/null; then
    echo "✅ runSecurityGate integrated in dispatch.ts (out-of-band LLM security)"
else
    echo "❌ CRITICAL: runSecurityGate missing from dispatch.ts!"
    echo "   This is required to protect ALL message channels with LLM-based analysis."
    ERRORS=$((ERRORS + 1))
fi

if grep -q "securityResult.blocked" src/auto-reply/dispatch.ts 2>/dev/null; then
    echo "✅ Security blocking logic present in dispatch.ts"
else
    echo "❌ CRITICAL: Security blocking logic missing from dispatch.ts!"
    ERRORS=$((ERRORS + 1))
fi

if grep -q "sendFinalReply.*alertMessage" src/auto-reply/dispatch.ts 2>/dev/null; then
    echo "✅ Security alert notification integrated in dispatch.ts"
else
    echo "⚠️  WARNING: Security alert notification may be missing from dispatch.ts"
    WARNINGS=$((WARNINGS + 1))
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

# Check 10b: Source classifier trusts messaging channels
echo ""
echo "Checking source classifier for trusted channels..."
if grep -q 'pattern.*agent:.*user_direct' src/security-hardening/injection/source-classifier.ts 2>/dev/null; then
    echo "✅ Agent session keys classified as user_direct (trusted)"
else
    echo "❌ CRITICAL: agent: pattern missing from source-classifier.ts"
    echo "   Dashboard/Telegram/Slack messages will show security wrapper tags!"
    ERRORS=$((ERRORS + 1))
fi

# Check 11: Mandatory memory system prompt
echo ""
echo "Checking mandatory memory system prompt..."
if grep -q "## Memory (MANDATORY)" src/agents/system-prompt.ts 2>/dev/null; then
    echo "✅ Memory section marked as MANDATORY in system-prompt.ts"
else
    echo "❌ CRITICAL: Memory section not marked MANDATORY!"
    echo "   Agent will not proactively use memory system."
    ERRORS=$((ERRORS + 1))
fi

if grep -q "At Session Start" src/agents/system-prompt.ts 2>/dev/null; then
    echo "✅ Session start memory instructions present"
else
    echo "❌ CRITICAL: Session start memory instructions missing!"
    ERRORS=$((ERRORS + 1))
fi

if grep -q "DO THIS FIRST" src/agents/system-prompt.ts 2>/dev/null; then
    echo "✅ Imperative 'DO THIS FIRST' instruction present"
else
    echo "⚠️  WARNING: Imperative instruction may be missing"
    WARNINGS=$((WARNINGS + 1))
fi

if grep -q "Before Answering Questions" src/agents/system-prompt.ts 2>/dev/null; then
    echo "✅ 'Before Answering Questions' section present"
else
    echo "❌ CRITICAL: Before Answering Questions section missing!"
    ERRORS=$((ERRORS + 1))
fi

if grep -q "you MUST run.*memory_search" src/agents/system-prompt.ts 2>/dev/null; then
    echo "✅ MUST run memory_search instruction present"
else
    echo "⚠️  WARNING: memory_search requirement may be weak"
    WARNINGS=$((WARNINGS + 1))
fi

# Check 11b: MEMORY.md auto-creation in workspace
if grep -q "memoryTemplate.*loadTemplate.*MEMORY" src/agents/workspace.ts 2>/dev/null; then
    echo "✅ MEMORY.md auto-created in ensureAgentWorkspace"
else
    echo "❌ CRITICAL: MEMORY.md not auto-created in workspace.ts!"
    echo "   New users won't have MEMORY.md file."
    ERRORS=$((ERRORS + 1))
fi

if [ -f "docs/reference/templates/MEMORY.md" ]; then
    echo "✅ MEMORY.md template exists"
else
    echo "❌ CRITICAL: MEMORY.md template missing from docs/reference/templates/"
    ERRORS=$((ERRORS + 1))
fi

# Check 12: DilloBot branding (not OpenClaw)
echo ""
echo "Checking DilloBot branding..."
if [ -f "src/dillobot-version.ts" ]; then
    echo "✅ src/dillobot-version.ts exists"
else
    echo "⚠️  WARNING: src/dillobot-version.ts missing"
    WARNINGS=$((WARNINGS + 1))
fi

if grep -q "DILLOBOT-BRANDING" src/cli/banner.ts 2>/dev/null; then
    echo "✅ DilloBot branding markers in banner.ts"
else
    echo "⚠️  WARNING: DilloBot branding missing from banner.ts"
    WARNINGS=$((WARNINGS + 1))
fi

if grep -q "DILLOBOT_PRODUCT_NAME" src/cli/banner.ts 2>/dev/null; then
    echo "✅ DilloBot product name imported in banner.ts"
else
    echo "⚠️  WARNING: DilloBot product name not imported in banner.ts"
    WARNINGS=$((WARNINGS + 1))
fi

if grep -q 'process.title = "dillobot"' src/entry.ts 2>/dev/null; then
    echo "✅ Process title is 'dillobot' in entry.ts"
else
    echo "⚠️  WARNING: Process title may be 'openclaw' instead of 'dillobot'"
    WARNINGS=$((WARNINGS + 1))
fi

if grep -q "control DilloBot" src/commands/dashboard.ts 2>/dev/null; then
    echo "✅ Dashboard says 'DilloBot' not 'OpenClaw'"
else
    echo "⚠️  WARNING: Dashboard may still say 'OpenClaw'"
    WARNINGS=$((WARNINGS + 1))
fi

# Check 12: Local-only device CLI commands
echo ""
echo "Checking local-only device CLI commands..."
if grep -q "local-list" src/cli/devices-cli.ts 2>/dev/null; then
    echo "✅ local-list command present in devices-cli.ts"
else
    echo "❌ CRITICAL: local-list command missing from devices-cli.ts"
    echo "   This is required for bootstrap/recovery when not paired!"
    ERRORS=$((ERRORS + 1))
fi

if grep -q "local-approve" src/cli/devices-cli.ts 2>/dev/null; then
    echo "✅ local-approve command present in devices-cli.ts"
else
    echo "❌ CRITICAL: local-approve command missing from devices-cli.ts"
    ERRORS=$((ERRORS + 1))
fi

if grep -q "local-reject" src/cli/devices-cli.ts 2>/dev/null; then
    echo "✅ local-reject command present in devices-cli.ts"
else
    echo "⚠️  WARNING: local-reject command missing from devices-cli.ts"
    WARNINGS=$((WARNINGS + 1))
fi

if grep -q "listDevicePairing" src/cli/devices-cli.ts 2>/dev/null; then
    echo "✅ listDevicePairing import present"
else
    echo "❌ CRITICAL: listDevicePairing import missing"
    ERRORS=$((ERRORS + 1))
fi

# Check 13: Dashboard pairing hint
echo ""
echo "Checking dashboard pairing instructions..."
if grep -q "pairingHint" ui/src/ui/views/overview.ts 2>/dev/null; then
    echo "✅ pairingHint present in dashboard overview.ts"
else
    echo "⚠️  WARNING: pairingHint missing from dashboard overview.ts"
    echo "   Users won't see pairing instructions on dashboard error"
    WARNINGS=$((WARNINGS + 1))
fi

if grep -q "pairing required" ui/src/ui/views/overview.ts 2>/dev/null; then
    echo "✅ Pairing required detection in overview.ts"
else
    echo "⚠️  WARNING: Pairing required detection missing"
    WARNINGS=$((WARNINGS + 1))
fi

if grep -q "dillobot devices local-list" ui/src/ui/views/overview.ts 2>/dev/null; then
    echo "✅ Local CLI instructions shown in pairing hint"
else
    echo "⚠️  WARNING: Local CLI instructions not shown to user"
    WARNINGS=$((WARNINGS + 1))
fi

# Check 14: Dashboard UI branding
echo ""
echo "Checking dashboard UI branding..."

if grep -q "DilloBot Control" ui/index.html 2>/dev/null; then
    echo "✅ Dashboard title is 'DilloBot Control'"
else
    echo "⚠️  WARNING: Dashboard title may still say 'OpenClaw'"
    WARNINGS=$((WARNINGS + 1))
fi

if grep -q "dillobot-app" ui/index.html 2>/dev/null; then
    echo "✅ Custom element 'dillobot-app' in index.html"
else
    echo "⚠️  WARNING: Custom element may still be 'openclaw-app'"
    WARNINGS=$((WARNINGS + 1))
fi

if grep -q '@customElement("dillobot-app")' ui/src/ui/app.ts 2>/dev/null; then
    echo "✅ Custom element registration is 'dillobot-app'"
else
    echo "⚠️  WARNING: Custom element registration may still be 'openclaw-app'"
    WARNINGS=$((WARNINGS + 1))
fi

if grep -q "DILLOBOT" ui/src/ui/app-render.ts 2>/dev/null; then
    echo "✅ Brand title 'DILLOBOT' in app-render.ts"
else
    echo "⚠️  WARNING: Brand title may still say 'OPENCLAW'"
    WARNINGS=$((WARNINGS + 1))
fi

if grep -q "/dillobot-logo.svg" ui/src/ui/app-render.ts 2>/dev/null; then
    echo "✅ DilloBot logo referenced in app-render.ts"
else
    echo "⚠️  WARNING: Logo may still reference OpenClaw lobster"
    WARNINGS=$((WARNINGS + 1))
fi

if [ -f "ui/public/dillobot-logo.svg" ]; then
    echo "✅ ui/public/dillobot-logo.svg exists"
else
    echo "⚠️  WARNING: ui/public/dillobot-logo.svg missing"
    WARNINGS=$((WARNINGS + 1))
fi

if grep -q "#4ade80" ui/src/styles/base.css 2>/dev/null; then
    echo "✅ DilloBot green accent color (#4ade80) in base.css"
else
    echo "⚠️  WARNING: DilloBot colors may be missing from base.css"
    WARNINGS=$((WARNINGS + 1))
fi

if grep -q "dillobot-app" ui/src/styles/base.css 2>/dev/null; then
    echo "✅ Custom element style for 'dillobot-app' in base.css"
else
    echo "⚠️  WARNING: Custom element style may still use 'openclaw-app'"
    WARNINGS=$((WARNINGS + 1))
fi

# Check 15: Encrypted Vault Integration
echo ""
echo "Checking encrypted vault integration..."

# Check vault-manager.ts exists
if [ -f "src/security-hardening/vault/vault-manager.ts" ]; then
    echo "✅ vault-manager.ts exists"
else
    echo "❌ CRITICAL: vault-manager.ts missing!"
    echo "   Credentials will be stored in plaintext!"
    ERRORS=$((ERRORS + 1))
fi

# Check AES fallback vault exists
if [ -f "src/security-hardening/vault/aes-fallback.ts" ]; then
    echo "✅ aes-fallback.ts exists"
else
    echo "❌ CRITICAL: aes-fallback.ts missing!"
    ERRORS=$((ERRORS + 1))
fi

# Check passwordless machine-derived key
if grep -q "getMachineId" src/security-hardening/vault/aes-fallback.ts 2>/dev/null; then
    echo "✅ Machine-derived key (passwordless) implemented"
else
    echo "❌ CRITICAL: getMachineId function missing - vault requires password!"
    ERRORS=$((ERRORS + 1))
fi

# Check vault key prefixes
if grep -q "VAULT_KEY_PREFIXES" src/security-hardening/vault/vault.ts 2>/dev/null; then
    echo "✅ VAULT_KEY_PREFIXES defined in vault.ts"
else
    echo "⚠️  WARNING: VAULT_KEY_PREFIXES missing from vault.ts"
    WARNINGS=$((WARNINGS + 1))
fi

# Check auth-profiles uses vault
if grep -q "storeAuthProfiles\|loadAuthProfileStoreFromVault" src/agents/auth-profiles/store.ts 2>/dev/null; then
    echo "✅ Auth profiles store uses vault functions"
else
    echo "❌ CRITICAL: Auth profiles store not using vault!"
    echo "   API keys will be stored in plaintext JSON!"
    ERRORS=$((ERRORS + 1))
fi

# Check device-identity uses vault
if grep -q "storeDeviceIdentity\|loadOrCreateDeviceIdentityAsync" src/infra/device-identity.ts 2>/dev/null; then
    echo "✅ Device identity uses vault functions"
else
    echo "⚠️  WARNING: Device identity may not use vault for private keys"
    WARNINGS=$((WARNINGS + 1))
fi

# Check device-auth uses vault
if grep -q "storeDeviceAuth\|loadDeviceAuthTokenFromVault" src/infra/device-auth-store.ts 2>/dev/null; then
    echo "✅ Device auth store uses vault functions"
else
    echo "⚠️  WARNING: Device auth store may not use vault"
    WARNINGS=$((WARNINGS + 1))
fi

# Check env-file vault integration
if grep -q "loadEnvVarFromVault\|injectVaultEnvVars" src/infra/env-file.ts 2>/dev/null; then
    echo "✅ Env file integrates with vault"
else
    echo "⚠️  WARNING: Env file may not integrate with vault"
    WARNINGS=$((WARNINGS + 1))
fi

# Check migration on startup
if grep -q "triggerVaultMigration\|migrateToSecureVault" src/cli/run-main.ts 2>/dev/null; then
    echo "✅ Vault migration triggered on startup"
else
    echo "❌ CRITICAL: Vault migration not triggered on startup!"
    echo "   Existing plaintext credentials won't be migrated!"
    ERRORS=$((ERRORS + 1))
fi

# Check migration.ts exists
if [ -f "src/security-hardening/vault/migration.ts" ]; then
    echo "✅ vault/migration.ts exists"
else
    echo "❌ CRITICAL: vault/migration.ts missing!"
    ERRORS=$((ERRORS + 1))
fi

# Note: keytar removed - using AES-256-GCM vault only (simpler, no native deps)

# Check vault tests exist
if [ -f "src/security-hardening/vault/vault-manager.test.ts" ] && [ -f "src/security-hardening/vault/aes-fallback.test.ts" ]; then
    echo "✅ Vault test files exist"
else
    echo "⚠️  WARNING: Vault test files missing"
    WARNINGS=$((WARNINGS + 1))
fi

# Check channel credential vault integration
echo ""
echo "Checking channel credential vault integration..."

# Check Telegram vault integration
if grep -q "retrieveTelegramToken\|storeTelegramToken" src/telegram/token.ts 2>/dev/null; then
    echo "✅ Telegram token vault integration"
else
    echo "⚠️  WARNING: Telegram token vault integration missing"
    WARNINGS=$((WARNINGS + 1))
fi

# Check Discord vault integration
if grep -q "retrieveDiscordToken\|storeDiscordToken" src/discord/token.ts 2>/dev/null; then
    echo "✅ Discord token vault integration"
else
    echo "⚠️  WARNING: Discord token vault integration missing"
    WARNINGS=$((WARNINGS + 1))
fi

# Check Slack vault integration
if grep -q "retrieveSlackTokens\|storeSlackTokens" src/slack/token.ts 2>/dev/null; then
    echo "✅ Slack tokens vault integration"
else
    echo "⚠️  WARNING: Slack tokens vault integration missing"
    WARNINGS=$((WARNINGS + 1))
fi

# Check WhatsApp vault integration
if grep -q "storeWhatsAppCreds\|retrieveWhatsAppCreds" src/web/auth-store.ts 2>/dev/null; then
    echo "✅ WhatsApp credentials vault integration"
else
    echo "⚠️  WARNING: WhatsApp credentials vault integration missing"
    WARNINGS=$((WARNINGS + 1))
fi

# Check channel credentials test file
if [ -f "src/security-hardening/vault/channel-credentials.test.ts" ]; then
    echo "✅ Channel credentials test file exists"
else
    echo "⚠️  WARNING: Channel credentials test file missing"
    WARNINGS=$((WARNINGS + 1))
fi

# Check 16: Skill Installation Security Integration
echo ""
echo "Checking skill installation security integration..."

# Check verifySkillForInstallation import in skills-install.ts
if grep -q "verifySkillForInstallation" src/agents/skills-install.ts 2>/dev/null; then
    echo "✅ verifySkillForInstallation imported in skills-install.ts"
else
    echo "❌ CRITICAL: verifySkillForInstallation missing from skills-install.ts!"
    echo "   Skill security verification will NOT run during installation!"
    ERRORS=$((ERRORS + 1))
fi

# Check DEFAULT_VERIFICATION_CONFIG import
if grep -q "DEFAULT_VERIFICATION_CONFIG" src/agents/skills-install.ts 2>/dev/null; then
    echo "✅ DEFAULT_VERIFICATION_CONFIG imported in skills-install.ts"
else
    echo "⚠️  WARNING: DEFAULT_VERIFICATION_CONFIG may be missing from skills-install.ts"
    WARNINGS=$((WARNINGS + 1))
fi

# Check skipVerification option exists
if grep -q "skipVerification" src/agents/skills-install.ts 2>/dev/null; then
    echo "✅ skipVerification option present in skills-install.ts"
else
    echo "⚠️  WARNING: skipVerification option missing - no bypass mechanism"
    WARNINGS=$((WARNINGS + 1))
fi

# Check security verification call
if grep -q "await verifySkillForInstallation" src/agents/skills-install.ts 2>/dev/null; then
    echo "✅ verifySkillForInstallation called in skills-install.ts"
else
    echo "❌ CRITICAL: verifySkillForInstallation not called in skills-install.ts!"
    echo "   Skill verification exists but is not used!"
    ERRORS=$((ERRORS + 1))
fi

# Check security result in return value
if grep -q "security: {" src/agents/skills-install.ts 2>/dev/null; then
    echo "✅ Security details included in install result"
else
    echo "⚠️  WARNING: Security details may not be in install result"
    WARNINGS=$((WARNINGS + 1))
fi

# Check skills-install.security.test.ts exists
if [ -f "src/agents/skills-install.security.test.ts" ]; then
    echo "✅ skills-install.security.test.ts test file exists"
else
    echo "⚠️  WARNING: skills-install.security.test.ts test file missing"
    WARNINGS=$((WARNINGS + 1))
fi

# Check vault key prefixes for channels
if grep -q "telegramToken\|discordToken\|slackToken" src/security-hardening/vault/vault.ts 2>/dev/null; then
    echo "✅ Channel token prefixes defined in vault.ts"
else
    echo "⚠️  WARNING: Channel token prefixes missing from vault.ts"
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
