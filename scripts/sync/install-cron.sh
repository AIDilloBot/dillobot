#!/bin/bash
# DilloBot Upstream Sync Cron Installer
# This script installs a daily cron job to check for OpenClaw updates
#
# Usage:
#   ./scripts/sync/install-cron.sh [OPTIONS]
#
# Options:
#   --hour HOUR       Hour to run (0-23, default: 6)
#   --minute MINUTE   Minute to run (0-59, default: 0)
#   --uninstall       Remove the cron job
#   --status          Check if cron job is installed
#   --help            Show this help

set -e

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Defaults
HOUR=6
MINUTE=0
UNINSTALL=false
STATUS=false

# Parse arguments
while [[ $# -gt 0 ]]; do
    case $1 in
        --hour)
            HOUR="$2"
            shift 2
            ;;
        --minute)
            MINUTE="$2"
            shift 2
            ;;
        --uninstall)
            UNINSTALL=true
            shift
            ;;
        --status)
            STATUS=true
            shift
            ;;
        --help)
            head -20 "$0" | tail -15
            exit 0
            ;;
        *)
            echo -e "${RED}Unknown option: $1${NC}"
            exit 1
            ;;
    esac
done

# Get the directory where this script lives
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DILLO_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
LOG_FILE="$HOME/dillobot-sync.log"
CRON_MARKER="# DilloBot upstream sync"

echo -e "${BLUE}🦎 DilloBot Cron Installer${NC}"
echo "================================"
echo ""
echo "DilloBot directory: $DILLO_DIR"
echo "Log file: $LOG_FILE"
echo ""

# Check status
if $STATUS; then
    if crontab -l 2>/dev/null | grep -q "$CRON_MARKER"; then
        echo -e "${GREEN}✓ Cron job is installed${NC}"
        echo ""
        echo "Current schedule:"
        crontab -l | grep -A1 "$CRON_MARKER"
    else
        echo -e "${YELLOW}✗ Cron job is not installed${NC}"
    fi
    exit 0
fi

# Uninstall
if $UNINSTALL; then
    echo "Removing DilloBot cron job..."

    if crontab -l 2>/dev/null | grep -q "$CRON_MARKER"; then
        # Remove the cron job (marker line and the following command line)
        crontab -l | grep -v "$CRON_MARKER" | grep -v "dillobot:sync" | crontab -
        echo -e "${GREEN}✓ Cron job removed${NC}"
    else
        echo -e "${YELLOW}No cron job found${NC}"
    fi
    exit 0
fi

# Validate inputs
if ! [[ "$HOUR" =~ ^[0-9]+$ ]] || [ "$HOUR" -lt 0 ] || [ "$HOUR" -gt 23 ]; then
    echo -e "${RED}Invalid hour: $HOUR (must be 0-23)${NC}"
    exit 1
fi

if ! [[ "$MINUTE" =~ ^[0-9]+$ ]] || [ "$MINUTE" -lt 0 ] || [ "$MINUTE" -gt 59 ]; then
    echo -e "${RED}Invalid minute: $MINUTE (must be 0-59)${NC}"
    exit 1
fi

# Check prerequisites
echo "Checking prerequisites..."

# Check if npm is available
if ! command -v npm &> /dev/null; then
    echo -e "${RED}✗ npm not found${NC}"
    echo "  Please install Node.js and npm first"
    exit 1
fi
echo -e "${GREEN}✓${NC} npm found: $(which npm)"

# Check if claude CLI is available
if ! command -v claude &> /dev/null; then
    echo -e "${YELLOW}⚠ Claude Code CLI not found${NC}"
    echo "  The sync will fail without it. Install with:"
    echo "  npm install -g @anthropic-ai/claude-code"
    echo "  claude login"
    echo ""
    read -p "Continue anyway? (y/N) " -n 1 -r
    echo
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        exit 1
    fi
else
    echo -e "${GREEN}✓${NC} Claude Code CLI found: $(which claude)"
fi

# Check if DilloBot directory exists
if [ ! -f "$DILLO_DIR/package.json" ]; then
    echo -e "${RED}✗ package.json not found in $DILLO_DIR${NC}"
    exit 1
fi
echo -e "${GREEN}✓${NC} DilloBot directory valid"

# Check if sync script exists
if [ ! -f "$DILLO_DIR/scripts/sync/upstream-sync-agent.ts" ]; then
    echo -e "${RED}✗ upstream-sync-agent.ts not found${NC}"
    exit 1
fi
echo -e "${GREEN}✓${NC} Sync script found"

echo ""

# Format time for display
DISPLAY_TIME=$(printf "%02d:%02d" $HOUR $MINUTE)

# Build the cron command
# Use full paths to avoid PATH issues in cron
NPM_PATH=$(which npm)
CRON_CMD="$MINUTE $HOUR * * * cd \"$DILLO_DIR\" && $NPM_PATH run dillobot:sync >> \"$LOG_FILE\" 2>&1"

echo "Installing cron job..."
echo "Schedule: Daily at $DISPLAY_TIME"
echo ""

# Check if already installed
if crontab -l 2>/dev/null | grep -q "$CRON_MARKER"; then
    echo -e "${YELLOW}Existing cron job found. Replacing...${NC}"
    # Remove existing job
    crontab -l | grep -v "$CRON_MARKER" | grep -v "dillobot:sync" | crontab -
fi

# Add new cron job
(crontab -l 2>/dev/null || true; echo "$CRON_MARKER"; echo "$CRON_CMD") | crontab -

echo -e "${GREEN}✓ Cron job installed!${NC}"
echo ""

# Verify
echo "Verification:"
crontab -l | grep -A1 "$CRON_MARKER"
echo ""

# Create/initialize log file
touch "$LOG_FILE"
echo "[$(date)] DilloBot sync cron job installed" >> "$LOG_FILE"

echo "================================"
echo -e "${GREEN}Setup complete!${NC}"
echo ""
echo "The sync will run daily at $DISPLAY_TIME"
echo ""
echo "Useful commands:"
echo "  Check status:    $SCRIPT_DIR/install-cron.sh --status"
echo "  View logs:       tail -f $LOG_FILE"
echo "  Run manually:    cd $DILLO_DIR && npm run dillobot:sync"
echo "  Uninstall:       $SCRIPT_DIR/install-cron.sh --uninstall"
echo ""
echo -e "${YELLOW}Note:${NC} Your Mac must be awake at $DISPLAY_TIME for the job to run."
echo "Consider using 'pmset' or Amphetamine to prevent sleep."
