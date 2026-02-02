#!/bin/bash
set -euo pipefail

# DilloBot Local Installer
# Usage: ./install.sh
# Or: curl -fsSL https://dillo.bot/install.sh | bash

BOLD='\033[1m'
ACCENT='\033[38;2;100;180;100m'
INFO='\033[38;2;100;200;150m'
SUCCESS='\033[38;2;47;191;113m'
WARN='\033[38;2;255;176;32m'
ERROR='\033[38;2;226;61;45m'
MUTED='\033[38;2;139;127;119m'
NC='\033[0m'

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Check if running from repo or via curl
INSTALL_FROM_LOCAL=0
if [[ -f "${SCRIPT_DIR}/package.json" ]] && grep -q '"dillobot"' "${SCRIPT_DIR}/package.json" 2>/dev/null; then
    INSTALL_FROM_LOCAL=1
    REPO_DIR="${SCRIPT_DIR}"
fi

print_banner() {
    echo -e "${ACCENT}${BOLD}"
    cat << 'EOF'
    ____  _ ____      ____        __
   / __ \(_) / /___  / __ )____  / /_
  / / / / / / / __ \/ __  / __ \/ __/
 / /_/ / / / / /_/ / /_/ / /_/ / /_
/_____/_/_/_/\____/_____/\____/\__/

EOF
    echo -e "${NC}"
    echo -e "${MUTED}Armored AI. No compromises.${NC}"
    echo ""
}

check_command() {
    command -v "$1" &> /dev/null
}

ensure_node() {
    if ! check_command node; then
        echo -e "${ERROR}Error: Node.js is required but not installed.${NC}"
        echo -e "Install Node.js 22+ from: ${INFO}https://nodejs.org${NC}"
        if [[ "$(uname)" == "Darwin" ]]; then
            echo -e "Or run: ${INFO}brew install node${NC}"
        fi
        exit 1
    fi

    local node_version
    node_version=$(node -v | sed 's/v//' | cut -d. -f1)
    if [[ "$node_version" -lt 20 ]]; then
        echo -e "${ERROR}Error: Node.js 20+ required (found v${node_version}).${NC}"
        exit 1
    fi
    echo -e "${SUCCESS}✓${NC} Node.js $(node -v)"
}

ensure_pnpm() {
    if ! check_command pnpm; then
        echo -e "${WARN}→${NC} Installing pnpm..."
        npm install -g pnpm
    fi
    echo -e "${SUCCESS}✓${NC} pnpm $(pnpm -v)"
}

check_claude_code_sdk() {
    # Check for Claude Code CLI
    if check_command claude; then
        echo -e "${SUCCESS}✓${NC} Claude Code CLI detected"
        return 0
    fi

    # Check for credential files
    local cred_paths=(
        "$HOME/.claude/credentials.json"
        "$HOME/.claude/auth.json"
        "$HOME/.config/claude/credentials.json"
    )

    for cred_path in "${cred_paths[@]}"; do
        if [[ -f "$cred_path" ]]; then
            echo -e "${SUCCESS}✓${NC} Claude Code credentials found at ${INFO}${cred_path}${NC}"
            return 0
        fi
    done

    # Check environment variables
    if [[ -n "${CLAUDE_CODE_SUBSCRIPTION_TOKEN:-}" ]] || \
       [[ -n "${CLAUDE_CODE_TOKEN:-}" ]] || \
       [[ -n "${CLAUDE_SUBSCRIPTION_TOKEN:-}" ]]; then
        echo -e "${SUCCESS}✓${NC} Claude Code token found in environment"
        return 0
    fi

    return 1
}

setup_claude_code_sdk() {
    echo ""
    echo -e "${WARN}→${NC} Checking Claude Code SDK..."

    if check_claude_code_sdk; then
        echo -e "${INFO}i${NC} Claude Code SDK will be used as the default AI provider"
        export DILLOBOT_AUTH_CHOICE="claude-code-sdk"
        return 0
    fi

    echo -e "${WARN}→${NC} Claude Code SDK not detected"
    echo ""
    echo -e "  DilloBot works best with Claude Code SDK authentication."
    echo -e "  This uses your Claude Code subscription - no API keys needed."
    echo ""
    echo -e "  To set up Claude Code SDK:"
    echo -e "    1. Install: ${INFO}npm install -g @anthropic-ai/claude-code${NC}"
    echo -e "    2. Login:   ${INFO}claude login${NC}"
    echo -e "    3. Re-run:  ${INFO}./install.sh${NC}"
    echo ""
    echo -e "  Or continue with alternative auth methods during onboarding."
    echo ""
    return 1
}

ensure_local_bin() {
    local bin_dir="$HOME/.local/bin"
    if [[ ! -d "$bin_dir" ]]; then
        mkdir -p "$bin_dir"
    fi

    # Check if ~/.local/bin is in PATH
    if [[ ":$PATH:" != *":$bin_dir:"* ]]; then
        echo -e "${WARN}→${NC} Adding ${INFO}~/.local/bin${NC} to PATH..."

        local shell_rc=""
        if [[ -n "${ZSH_VERSION:-}" ]] || [[ "$SHELL" == *"zsh"* ]]; then
            shell_rc="$HOME/.zshrc"
        elif [[ -n "${BASH_VERSION:-}" ]] || [[ "$SHELL" == *"bash"* ]]; then
            if [[ -f "$HOME/.bash_profile" ]]; then
                shell_rc="$HOME/.bash_profile"
            else
                shell_rc="$HOME/.bashrc"
            fi
        fi

        if [[ -n "$shell_rc" ]]; then
            if ! grep -q 'export PATH="$HOME/.local/bin:$PATH"' "$shell_rc" 2>/dev/null; then
                echo '' >> "$shell_rc"
                echo '# Added by DilloBot installer' >> "$shell_rc"
                echo 'export PATH="$HOME/.local/bin:$PATH"' >> "$shell_rc"
                echo -e "${SUCCESS}✓${NC} Added to ${INFO}${shell_rc}${NC}"
            fi
        fi

        export PATH="$bin_dir:$PATH"
    fi
}

install_from_local() {
    local repo_dir="$1"

    echo -e "${WARN}→${NC} Installing dependencies..."
    cd "$repo_dir"
    pnpm install --frozen-lockfile 2>/dev/null || pnpm install

    echo -e "${WARN}→${NC} Building DilloBot..."
    if ! pnpm build 2>/dev/null; then
        echo -e "${WARN}→${NC} Build encountered issues, trying without UI..."
        pnpm run build 2>/dev/null || true
    fi

    ensure_local_bin

    # Create dillobot wrapper
    cat > "$HOME/.local/bin/dillobot" << EOF
#!/usr/bin/env bash
set -euo pipefail
exec node "${repo_dir}/dist/entry.js" "\$@"
EOF
    chmod +x "$HOME/.local/bin/dillobot"

    # Create openclaw alias (for compatibility)
    cat > "$HOME/.local/bin/openclaw" << EOF
#!/usr/bin/env bash
set -euo pipefail
exec node "${repo_dir}/dist/entry.js" "\$@"
EOF
    chmod +x "$HOME/.local/bin/openclaw"

    echo -e "${SUCCESS}✓${NC} Installed to ${INFO}~/.local/bin/dillobot${NC}"
}

install_from_npm() {
    echo -e "${WARN}→${NC} Installing from npm registry..."

    # Check if already installed globally
    if npm list -g dillobot &>/dev/null; then
        echo -e "${INFO}i${NC} Updating existing installation..."
        npm update -g dillobot
    else
        npm install -g dillobot
    fi

    # Verify installation
    if check_command dillobot; then
        echo -e "${SUCCESS}✓${NC} Installed via npm"
        return 0
    else
        echo -e "${ERROR}npm install failed, falling back to git...${NC}"
        return 1
    fi
}

install_from_git() {
    local repo_url="${DILLOBOT_REPO:-https://github.com/AIDilloBot/dillobot.git}"
    local install_dir="${DILLOBOT_DIR:-$HOME/.dillobot-src}"

    if [[ -d "$install_dir" ]]; then
        echo -e "${WARN}→${NC} Updating existing checkout..."
        cd "$install_dir"
        git fetch origin
        git reset --hard origin/main
    else
        echo -e "${WARN}→${NC} Cloning DilloBot..."
        git clone "$repo_url" "$install_dir"
    fi

    install_from_local "$install_dir"
}

run_verify() {
    echo ""
    echo -e "${WARN}→${NC} Verifying security patches..."
    if [[ -f "${REPO_DIR:-}/scripts/sync/verify-security.sh" ]]; then
        bash "${REPO_DIR}/scripts/sync/verify-security.sh"
    elif check_command dillobot; then
        dillobot doctor --non-interactive 2>/dev/null || true
    fi
}

uninstall() {
    echo -e "${WARN}→${NC} Uninstalling DilloBot..."

    # Remove wrappers
    rm -f "$HOME/.local/bin/dillobot" 2>/dev/null || true
    rm -f "$HOME/.local/bin/openclaw" 2>/dev/null || true

    # Try npm uninstall if globally installed
    npm uninstall -g dillobot 2>/dev/null || true
    npm uninstall -g openclaw 2>/dev/null || true

    echo -e "${SUCCESS}✓${NC} DilloBot uninstalled"
    echo -e "${MUTED}Note: Source directory and config (~/.openclaw, ~/.dillobot-src) preserved.${NC}"
    echo -e "${MUTED}Remove manually if desired.${NC}"
}

print_usage() {
    echo "DilloBot Installer"
    echo ""
    echo "Usage: ./install.sh [options]"
    echo ""
    echo "Options:"
    echo "  --help        Show this help"
    echo "  --uninstall   Remove DilloBot"
    echo "  --verify      Verify security patches only"
    echo "  --npm         Install from npm registry (default for remote install)"
    echo "  --git         Clone from GitHub and build from source"
    echo ""
    echo "Environment variables:"
    echo "  DILLOBOT_REPO   Git repository URL (default: github.com/AIDilloBot/dillobot)"
    echo "  DILLOBOT_DIR    Installation directory for git clone"
    echo ""
    echo "Install methods (in order of preference):"
    echo "  1. Local source - if running from repo directory"
    echo "  2. npm         - fast, pre-built binaries"
    echo "  3. git         - clone and build from source"
    echo ""
}

main() {
    local use_git=0
    local use_npm=0
    local verify_only=0

    while [[ $# -gt 0 ]]; do
        case "$1" in
            --help|-h)
                print_usage
                exit 0
                ;;
            --uninstall)
                uninstall
                exit 0
                ;;
            --verify)
                verify_only=1
                shift
                ;;
            --git)
                use_git=1
                shift
                ;;
            --npm)
                use_npm=1
                shift
                ;;
            *)
                echo -e "${ERROR}Unknown option: $1${NC}"
                print_usage
                exit 1
                ;;
        esac
    done

    print_banner

    if [[ "$verify_only" == "1" ]]; then
        run_verify
        exit 0
    fi

    echo -e "${WARN}→${NC} Checking prerequisites..."
    ensure_node

    # Check for Claude Code SDK (DilloBot's preferred auth method)
    setup_claude_code_sdk

    echo ""
    if [[ "$INSTALL_FROM_LOCAL" == "1" && "$use_git" == "0" && "$use_npm" == "0" ]]; then
        # Installing from local source requires pnpm
        ensure_pnpm
        echo -e "${INFO}i${NC} Installing from local source: ${INFO}${REPO_DIR}${NC}"
        install_from_local "$REPO_DIR"
    elif [[ "$use_git" == "1" ]]; then
        # Explicit git install requested
        ensure_pnpm
        echo -e "${INFO}i${NC} Installing from GitHub (source)..."
        if ! check_command git; then
            echo -e "${ERROR}Error: git is required for source install.${NC}"
            exit 1
        fi
        install_from_git
    else
        # Default: try npm first (faster), fall back to git
        echo -e "${INFO}i${NC} Installing from npm registry..."
        if install_from_npm; then
            : # npm install succeeded
        else
            # Fall back to git if npm fails
            echo -e "${WARN}→${NC} Falling back to git install..."
            ensure_pnpm
            if ! check_command git; then
                echo -e "${ERROR}Error: git is required for source install.${NC}"
                exit 1
            fi
            install_from_git
        fi
    fi

    run_verify

    echo ""
    echo -e "${SUCCESS}${BOLD}🛡️  DilloBot installed successfully!${NC}"
    echo ""
    echo -e "Commands available:"
    echo -e "  ${INFO}dillobot${NC}         - Run DilloBot"
    echo -e "  ${INFO}dillobot onboard${NC} - Start setup wizard"
    echo -e "  ${INFO}dillobot doctor${NC}  - Check configuration"
    echo -e "  ${INFO}dillobot help${NC}    - Show all commands"
    echo ""
    echo -e "${MUTED}Armored AI. No compromises.${NC}"

    # Prompt for onboarding if TTY available
    if [[ -t 0 && -t 1 ]]; then
        echo ""
        read -p "Run onboarding now? [Y/n] " -n 1 -r
        echo
        if [[ ! $REPLY =~ ^[Nn]$ ]]; then
            local onboard_args=()
            # If Claude Code SDK was detected, pass it as the default auth choice
            if [[ -n "${DILLOBOT_AUTH_CHOICE:-}" ]]; then
                onboard_args+=("--auth-choice" "$DILLOBOT_AUTH_CHOICE")
            fi
            exec "$HOME/.local/bin/dillobot" onboard "${onboard_args[@]}"
        fi
    fi
}

main "$@"
