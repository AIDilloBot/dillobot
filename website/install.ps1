#Requires -Version 5.1
<#
.SYNOPSIS
    DilloBot Windows Installer
.DESCRIPTION
    Installs DilloBot - Security-hardened fork of OpenClaw
.EXAMPLE
    iwr -useb https://dillo.bot/install.ps1 | iex
.EXAMPLE
    .\install.ps1 -Git
.EXAMPLE
    .\install.ps1 -Uninstall
#>

[CmdletBinding()]
param(
    [switch]$Help,
    [switch]$Uninstall,
    [switch]$Verify,
    [switch]$Git,
    [switch]$Npm
)

$ErrorActionPreference = "Stop"

# Colors
$AccentColor = "Green"
$InfoColor = "Cyan"
$WarnColor = "Yellow"
$ErrorColor = "Red"
$MutedColor = "DarkGray"

$DilloBotRepo = if ($env:DILLOBOT_REPO) { $env:DILLOBOT_REPO } else { "https://github.com/AIDilloBot/dillobot.git" }
$DilloBotDir = if ($env:DILLOBOT_DIR) { $env:DILLOBOT_DIR } else { "$env:USERPROFILE\.dillobot-src" }

function Write-Banner {
    Write-Host ""
    Write-Host "    ____  _ ____      ____        __" -ForegroundColor $AccentColor
    Write-Host "   / __ \(_) / /___  / __ )____  / /_" -ForegroundColor $AccentColor
    Write-Host "  / / / / / / / __ \/ __  / __ \/ __/" -ForegroundColor $AccentColor
    Write-Host " / /_/ / / / / /_/ / /_/ / /_/ / /_" -ForegroundColor $AccentColor
    Write-Host "/_____/_/_/_/\____/_____/\____/\__/" -ForegroundColor $AccentColor
    Write-Host ""
    Write-Host "Armored AI. No compromises." -ForegroundColor $MutedColor
    Write-Host ""
}

function Write-Status {
    param(
        [string]$Message,
        [string]$Type = "info"
    )
    switch ($Type) {
        "success" { Write-Host "[OK] " -ForegroundColor $AccentColor -NoNewline; Write-Host $Message }
        "warn"    { Write-Host "[->] " -ForegroundColor $WarnColor -NoNewline; Write-Host $Message }
        "error"   { Write-Host "[!!] " -ForegroundColor $ErrorColor -NoNewline; Write-Host $Message }
        "info"    { Write-Host "[i] " -ForegroundColor $InfoColor -NoNewline; Write-Host $Message }
        default   { Write-Host $Message }
    }
}

function Test-Command {
    param([string]$Command)
    $null -ne (Get-Command $Command -ErrorAction SilentlyContinue)
}

function Get-NodeVersion {
    if (-not (Test-Command "node")) {
        return $null
    }
    $version = & node -v 2>$null
    if ($version -match "v(\d+)") {
        return [int]$Matches[1]
    }
    return $null
}

function Ensure-Node {
    $nodeVersion = Get-NodeVersion
    if (-not $nodeVersion) {
        Write-Status "Node.js is required but not installed." -Type "error"
        Write-Host "Install Node.js 20+ from: " -NoNewline
        Write-Host "https://nodejs.org" -ForegroundColor $InfoColor
        Write-Host ""
        Write-Host "Or using winget: " -NoNewline
        Write-Host "winget install OpenJS.NodeJS.LTS" -ForegroundColor $InfoColor
        throw "Node.js not found"
    }
    if ($nodeVersion -lt 20) {
        Write-Status "Node.js 20+ required (found v$nodeVersion)" -Type "error"
        throw "Node.js version too old"
    }
    Write-Status "Node.js v$nodeVersion" -Type "success"
}

function Ensure-Pnpm {
    if (-not (Test-Command "pnpm")) {
        Write-Status "Installing pnpm..." -Type "warn"
        & npm install -g pnpm
        if ($LASTEXITCODE -ne 0) {
            throw "Failed to install pnpm"
        }
    }
    $pnpmVersion = & pnpm -v 2>$null
    Write-Status "pnpm $pnpmVersion" -Type "success"
}

function Test-ClaudeCodeSDK {
    # Check for Claude Code CLI
    if (Test-Command "claude") {
        Write-Status "Claude Code CLI detected" -Type "success"
        return $true
    }

    # Check for credential files
    $credPaths = @(
        "$env:USERPROFILE\.claude\credentials.json",
        "$env:USERPROFILE\.claude\auth.json",
        "$env:APPDATA\claude\credentials.json"
    )

    foreach ($credPath in $credPaths) {
        if (Test-Path $credPath) {
            Write-Status "Claude Code credentials found at $credPath" -Type "success"
            return $true
        }
    }

    # Check environment variables
    if ($env:CLAUDE_CODE_SUBSCRIPTION_TOKEN -or $env:CLAUDE_CODE_TOKEN -or $env:CLAUDE_SUBSCRIPTION_TOKEN) {
        Write-Status "Claude Code token found in environment" -Type "success"
        return $true
    }

    return $false
}

function Setup-ClaudeCodeSDK {
    Write-Host ""
    Write-Status "Checking Claude Code SDK..." -Type "warn"

    if (Test-ClaudeCodeSDK) {
        Write-Status "Claude Code SDK will be used as the default AI provider" -Type "info"
        $env:DILLOBOT_AUTH_CHOICE = "claude-code-sdk"
        return $true
    }

    Write-Status "Claude Code SDK not detected" -Type "warn"
    Write-Host ""
    Write-Host "  DilloBot works best with Claude Code SDK authentication."
    Write-Host "  This uses your Claude Code subscription - no API keys needed."
    Write-Host ""
    Write-Host "  To set up Claude Code SDK:"
    Write-Host "    1. Install: " -NoNewline
    Write-Host "npm install -g @anthropic-ai/claude-code" -ForegroundColor $InfoColor
    Write-Host "    2. Login:   " -NoNewline
    Write-Host "claude login" -ForegroundColor $InfoColor
    Write-Host "    3. Re-run:  " -NoNewline
    Write-Host ".\install.ps1" -ForegroundColor $InfoColor
    Write-Host ""
    Write-Host "  Or continue with alternative auth methods during onboarding."
    Write-Host ""
    return $false
}

function Get-DilloBotBinPath {
    # Use npm global bin directory
    $npmBin = & npm config get prefix 2>$null
    if ($npmBin) {
        return $npmBin
    }
    return "$env:APPDATA\npm"
}

function Install-FromNpm {
    Write-Status "Installing from npm registry..." -Type "warn"

    try {
        $installed = & npm list -g @dillobot/dillobot 2>$null
        if ($LASTEXITCODE -eq 0) {
            Write-Status "Updating existing installation..." -Type "info"
            & npm update -g @dillobot/dillobot
        } else {
            & npm install -g @dillobot/dillobot
        }

        if ($LASTEXITCODE -ne 0) {
            return $false
        }

        if (Test-Command "dillobot") {
            Write-Status "Installed via npm" -Type "success"
            return $true
        }
    } catch {
        # npm install failed
    }

    Write-Status "npm install failed, falling back to git..." -Type "error"
    return $false
}

function Install-FromGit {
    if (-not (Test-Command "git")) {
        Write-Status "git is required for source install" -Type "error"
        Write-Host "Install git from: " -NoNewline
        Write-Host "https://git-scm.com/download/win" -ForegroundColor $InfoColor
        throw "Git not found"
    }

    if (Test-Path $DilloBotDir) {
        Write-Status "Updating existing checkout..." -Type "warn"
        Push-Location $DilloBotDir
        try {
            & git fetch origin
            & git reset --hard origin/main
        } finally {
            Pop-Location
        }
    } else {
        Write-Status "Cloning DilloBot..." -Type "warn"
        & git clone $DilloBotRepo $DilloBotDir
        if ($LASTEXITCODE -ne 0) {
            throw "Failed to clone repository"
        }
    }

    Install-FromLocal $DilloBotDir
}

function Install-FromLocal {
    param([string]$RepoDir)

    Push-Location $RepoDir
    try {
        Write-Status "Installing dependencies..." -Type "warn"
        & pnpm install --frozen-lockfile 2>$null
        if ($LASTEXITCODE -ne 0) {
            & pnpm install
        }

        Write-Status "Building DilloBot..." -Type "warn"
        & pnpm build
        if ($LASTEXITCODE -ne 0) {
            Write-Status "Build encountered issues, trying without UI..." -Type "warn"
            & pnpm run build 2>$null
        }
    } finally {
        Pop-Location
    }

    # Create dillobot.cmd wrapper
    $binPath = Get-DilloBotBinPath
    $wrapperPath = Join-Path $binPath "dillobot.cmd"

    $wrapperContent = @"
@echo off
node "$RepoDir\dist\entry.js" %*
"@

    Set-Content -Path $wrapperPath -Value $wrapperContent -Encoding ASCII
    Write-Status "Installed to $wrapperPath" -Type "success"

    # Create openclaw.cmd alias for compatibility
    $aliasPath = Join-Path $binPath "openclaw.cmd"
    Set-Content -Path $aliasPath -Value $wrapperContent -Encoding ASCII
}

function Invoke-Uninstall {
    Write-Status "Uninstalling DilloBot..." -Type "warn"

    $binPath = Get-DilloBotBinPath

    # Remove wrappers
    $wrappers = @("dillobot.cmd", "dillobot.ps1", "openclaw.cmd", "openclaw.ps1")
    foreach ($wrapper in $wrappers) {
        $path = Join-Path $binPath $wrapper
        if (Test-Path $path) {
            Remove-Item $path -Force
        }
    }

    # Try npm uninstall
    try {
        & npm uninstall -g @dillobot/dillobot 2>$null
        & npm uninstall -g openclaw 2>$null
    } catch {}

    Write-Status "DilloBot uninstalled" -Type "success"
    Write-Host "Note: Source directory and config preserved." -ForegroundColor $MutedColor
    Write-Host "Remove manually if desired: $DilloBotDir" -ForegroundColor $MutedColor
}

function Invoke-Verify {
    Write-Host ""
    Write-Status "Verifying security patches..." -Type "warn"

    if (Test-Path "$DilloBotDir\scripts\sync\verify-security.sh") {
        Write-Host "Run verification manually with bash or WSL:" -ForegroundColor $MutedColor
        Write-Host "  bash $DilloBotDir\scripts\sync\verify-security.sh" -ForegroundColor $InfoColor
    } elseif (Test-Command "dillobot") {
        & dillobot doctor --non-interactive 2>$null
    }
}

function Show-Help {
    Write-Host "DilloBot Windows Installer"
    Write-Host ""
    Write-Host "Usage: .\install.ps1 [options]"
    Write-Host ""
    Write-Host "Options:"
    Write-Host "  -Help        Show this help"
    Write-Host "  -Uninstall   Remove DilloBot"
    Write-Host "  -Verify      Verify security patches only"
    Write-Host "  -Npm         Install from npm registry (default)"
    Write-Host "  -Git         Clone from GitHub and build from source"
    Write-Host ""
    Write-Host "Environment variables:"
    Write-Host "  DILLOBOT_REPO   Git repository URL"
    Write-Host "  DILLOBOT_DIR    Installation directory for git clone"
    Write-Host ""
    Write-Host "Examples:"
    Write-Host "  iwr -useb https://dillo.bot/install.ps1 | iex"
    Write-Host "  .\install.ps1 -Git"
    Write-Host ""
}

function Main {
    if ($Help) {
        Show-Help
        return
    }

    if ($Uninstall) {
        Invoke-Uninstall
        return
    }

    Write-Banner

    if ($Verify) {
        Invoke-Verify
        return
    }

    Write-Status "Checking prerequisites..." -Type "warn"
    Ensure-Node

    Setup-ClaudeCodeSDK

    Write-Host ""

    $installed = $false

    if ($Git) {
        Ensure-Pnpm
        Write-Status "Installing from GitHub (source)..." -Type "info"
        Install-FromGit
        $installed = $true
    } elseif ($Npm -or (-not $Git)) {
        Write-Status "Installing from npm registry..." -Type "info"
        if (Install-FromNpm) {
            $installed = $true
        } else {
            # Fall back to git
            Write-Status "Falling back to git install..." -Type "warn"
            Ensure-Pnpm
            Install-FromGit
            $installed = $true
        }
    }

    if ($installed) {
        Invoke-Verify

        Write-Host ""
        Write-Host "[SHIELD] DilloBot installed successfully!" -ForegroundColor $AccentColor
        Write-Host ""
        Write-Host "Commands available:"
        Write-Host "  dillobot         " -ForegroundColor $InfoColor -NoNewline
        Write-Host "- Run DilloBot"
        Write-Host "  dillobot onboard " -ForegroundColor $InfoColor -NoNewline
        Write-Host "- Start setup wizard"
        Write-Host "  dillobot doctor  " -ForegroundColor $InfoColor -NoNewline
        Write-Host "- Check configuration"
        Write-Host "  dillobot help    " -ForegroundColor $InfoColor -NoNewline
        Write-Host "- Show all commands"
        Write-Host ""
        Write-Host "Armored AI. No compromises." -ForegroundColor $MutedColor
        Write-Host ""

        # Prompt for onboarding
        $response = Read-Host "Run onboarding now? [Y/n]"
        if ($response -ne "n" -and $response -ne "N") {
            $onboardArgs = @("onboard")
            if ($env:DILLOBOT_AUTH_CHOICE) {
                $onboardArgs += @("--auth-choice", $env:DILLOBOT_AUTH_CHOICE)
            }
            & dillobot @onboardArgs
        }
    }
}

# Run main
Main
