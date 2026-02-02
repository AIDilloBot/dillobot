#!/bin/bash
# DilloBot NPM Publish Script
#
# Usage:
#   ./scripts/publish-npm.sh [OPTIONS]
#
# Options:
#   --dry-run       Run without actually publishing (default)
#   --publish       Actually publish to npm
#   --tag TAG       Publish with specific tag (default: latest)
#   --skip-build    Skip the build step
#   --skip-verify   Skip security verification
#   --help          Show this help

set -euo pipefail

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m'

# Configuration
NPM_PACKAGE_NAME="dillobot"
ORIGINAL_PACKAGE_NAME="openclaw"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

# Defaults
DRY_RUN=true
TAG="latest"
SKIP_BUILD=false
SKIP_VERIFY=false

# Parse arguments
while [[ $# -gt 0 ]]; do
    case $1 in
        --dry-run)
            DRY_RUN=true
            shift
            ;;
        --publish)
            DRY_RUN=false
            shift
            ;;
        --tag)
            TAG="$2"
            shift 2
            ;;
        --skip-build)
            SKIP_BUILD=true
            shift
            ;;
        --skip-verify)
            SKIP_VERIFY=true
            shift
            ;;
        --help)
            head -17 "$0" | tail -14
            exit 0
            ;;
        *)
            echo -e "${RED}Unknown option: $1${NC}"
            exit 1
            ;;
    esac
done

echo -e "${BLUE}📦 DilloBot NPM Publish Script${NC}"
echo "================================"
echo ""

cd "$REPO_DIR"

# Step 1: Pre-flight checks
echo -e "${CYAN}Step 1: Pre-flight checks${NC}"

# Check if npm is logged in
echo -n "  Checking npm login... "
if ! npm whoami &>/dev/null; then
    echo -e "${RED}NOT LOGGED IN${NC}"
    echo ""
    echo "Please login to npm first:"
    echo "  npm login"
    exit 1
fi
NPM_USER=$(npm whoami)
echo -e "${GREEN}$NPM_USER${NC}"

# Check if package name is available (or owned by us)
echo -n "  Checking package name availability... "
if npm view "$NPM_PACKAGE_NAME" &>/dev/null; then
    # Package exists, check if we own it
    PACKAGE_OWNER=$(npm view "$NPM_PACKAGE_NAME" maintainers --json 2>/dev/null | grep -o '"[^"]*"' | head -1 | tr -d '"' || echo "unknown")
    if [[ "$PACKAGE_OWNER" == "$NPM_USER" ]] || npm access ls-packages 2>/dev/null | grep -q "\"$NPM_PACKAGE_NAME\""; then
        echo -e "${GREEN}owned by us${NC}"
    else
        echo -e "${YELLOW}exists (owner: $PACKAGE_OWNER)${NC}"
        echo ""
        echo -e "${RED}Warning: Package '$NPM_PACKAGE_NAME' exists and may not be owned by you.${NC}"
        echo "This publish may fail. Check your npm permissions."
        echo ""
        read -p "Continue anyway? (y/N) " -n 1 -r
        echo
        if [[ ! $REPLY =~ ^[Yy]$ ]]; then
            exit 1
        fi
    fi
else
    echo -e "${GREEN}available${NC}"
fi

# Check git status
echo -n "  Checking git status... "
if [[ -n "$(git status --porcelain)" ]]; then
    echo -e "${YELLOW}uncommitted changes${NC}"
    echo ""
    echo -e "${YELLOW}Warning: You have uncommitted changes.${NC}"
    git status --short
    echo ""
    read -p "Continue anyway? (y/N) " -n 1 -r
    echo
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        exit 1
    fi
else
    echo -e "${GREEN}clean${NC}"
fi

# Check we're on main branch
echo -n "  Checking branch... "
CURRENT_BRANCH=$(git branch --show-current)
if [[ "$CURRENT_BRANCH" != "main" ]]; then
    echo -e "${YELLOW}$CURRENT_BRANCH${NC}"
    echo ""
    echo -e "${YELLOW}Warning: Not on main branch.${NC}"
    read -p "Continue anyway? (y/N) " -n 1 -r
    echo
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        exit 1
    fi
else
    echo -e "${GREEN}main${NC}"
fi

echo ""

# Step 2: Security verification
if [[ "$SKIP_VERIFY" == "false" ]]; then
    echo -e "${CYAN}Step 2: Security verification${NC}"
    if [[ -f "$REPO_DIR/scripts/sync/verify-security.sh" ]]; then
        if ! bash "$REPO_DIR/scripts/sync/verify-security.sh"; then
            echo -e "${RED}Security verification failed!${NC}"
            echo "Fix the issues above before publishing."
            exit 1
        fi
    else
        echo -e "${YELLOW}  Skipped (verify script not found)${NC}"
    fi
    echo ""
else
    echo -e "${CYAN}Step 2: Security verification${NC} ${YELLOW}(skipped)${NC}"
    echo ""
fi

# Step 3: Build
if [[ "$SKIP_BUILD" == "false" ]]; then
    echo -e "${CYAN}Step 3: Building${NC}"
    npm run build
    echo ""
else
    echo -e "${CYAN}Step 3: Building${NC} ${YELLOW}(skipped)${NC}"
    echo ""
fi

# Step 4: Prepare package.json for publishing
echo -e "${CYAN}Step 4: Preparing package.json${NC}"

# Backup original package.json
cp package.json package.json.backup

# Update package name
echo "  Updating package name: $ORIGINAL_PACKAGE_NAME -> $NPM_PACKAGE_NAME"
sed -i.bak "s/\"name\": \"$ORIGINAL_PACKAGE_NAME\"/\"name\": \"$NPM_PACKAGE_NAME\"/" package.json
rm -f package.json.bak

# Get version
VERSION=$(node -p "require('./package.json').version")
echo "  Version: $VERSION"
echo "  Tag: $TAG"

echo ""

# Step 5: Publish
echo -e "${CYAN}Step 5: Publishing${NC}"

cleanup() {
    # Restore original package.json
    if [[ -f package.json.backup ]]; then
        mv package.json.backup package.json
        echo "  Restored original package.json"
    fi
}
trap cleanup EXIT

if [[ "$DRY_RUN" == "true" ]]; then
    echo -e "${YELLOW}  DRY RUN MODE - not actually publishing${NC}"
    echo ""
    echo "  Would publish:"
    echo "    Package: $NPM_PACKAGE_NAME@$VERSION"
    echo "    Tag: $TAG"
    echo "    Registry: https://registry.npmjs.org"
    echo ""
    echo "  Running: npm publish --dry-run --tag $TAG"
    echo ""
    npm publish --dry-run --tag "$TAG" 2>&1 | head -50
    echo ""
    echo -e "${GREEN}✓ Dry run complete${NC}"
    echo ""
    echo "To actually publish, run:"
    echo "  ./scripts/publish-npm.sh --publish"
else
    echo -e "${RED}  PUBLISHING TO NPM${NC}"
    echo ""
    echo "  Package: $NPM_PACKAGE_NAME@$VERSION"
    echo "  Tag: $TAG"
    echo ""
    read -p "Are you sure you want to publish? (y/N) " -n 1 -r
    echo
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        echo "Aborted."
        exit 1
    fi

    npm publish --tag "$TAG"

    echo ""
    echo -e "${GREEN}✓ Published successfully!${NC}"
    echo ""
    echo "Install with:"
    echo "  npm install -g $NPM_PACKAGE_NAME"
    echo ""
    echo "Or via install script:"
    echo "  curl -fsSL https://dillo.bot/install.sh | bash"
fi

echo ""
echo "================================"
echo -e "${GREEN}Done!${NC}"
