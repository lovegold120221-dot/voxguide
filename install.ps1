# ─────────────────────────────────────────────────────────────────────────────
# Beatrice — One-paste installer for Windows (PowerShell)
# Works on freshly formatted machines with no dev tools installed.
# Usage: powershell -ExecutionPolicy Bypass -File install.ps1
# ─────────────────────────────────────────────────────────────────────────────

$ErrorActionPreference = "Stop"

$REPO_URL        = if ($env:BEATRICE_REPO_URL) { $env:BEATRICE_REPO_URL } else { "https://github.com/lovegold120221-dot/turbo-dollop.git" }
$REPO_BRANCH     = if ($env:BEATRICE_BRANCH) { $env:BEATRICE_BRANCH } else { "main" }
$INSTALL_DIR     = if ($env:BEATRICE_INSTALL_DIR) { $env:BEATRICE_INSTALL_DIR } else { "$env:USERPROFILE\beatrice" }
$NODE_VERSION    = "22"
$PYTHON_VERSION  = "3.11"

function Write-Step($msg)  { Write-Host "`n▶ $msg" -ForegroundColor Cyan }
function Write-OK($msg)    { Write-Host "✓ $msg" -ForegroundColor Green }
function Write-Warn($msg)  { Write-Host "⚠ $msg" -ForegroundColor Yellow }
function Write-Fail($msg)  { Write-Host "✗ $msg" -ForegroundColor Red; exit 1 }

# ─── Check admin rights ───────────────────────────────────────────────────────
$isAdmin = ([Security.Principal.WindowsPrincipal] [Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)

# ─── Install Chocolatey if missing ────────────────────────────────────────────
if (-not (Get-Command choco -ErrorAction SilentlyContinue)) {
  Write-Step "Installing Chocolatey package manager"
  if (-not $isAdmin) { Write-Fail "Run PowerShell as Administrator to install Chocolatey and dependencies." }
  Set-ExecutionPolicy Bypass -Scope Process -Force
  [System.Net.ServicePointManager]::SecurityProtocol = [System.Net.ServicePointManager]::SecurityProtocol -bor 3072
  Invoke-Expression ((New-Object System.Net.WebClient).DownloadString('https://community.chocolatey.org/install.ps1'))
  $env:Path = [System.Environment]::GetEnvironmentVariable("Path", "Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path", "User")
}

# ─── Install Git, Python, Node.js, build tools ───────────────────────────────
Write-Step "Installing Git, Python, Node.js, and build tools via Chocolatey"
choco install -y git python311 nodejs-lts visualstudio2022buildtools 2>&1 | Out-Host

# Refresh PATH
$env:Path = [System.Environment]::GetEnvironmentVariable("Path", "Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path", "User")

# ─── Verify tools ─────────────────────────────────────────────────────────────
foreach ($cmd in @("git", "python", "node", "npm")) {
  if (-not (Get-Command $cmd -ErrorAction SilentlyContinue)) {
    Write-Fail "$cmd is not available. Please install it manually and rerun."
  }
}
Write-OK "Node.js $(node -v), Python $(python --version), Git $(git --version)"

# ─── Clone or update repository ───────────────────────────────────────────────
if (Test-Path "$INSTALL_DIR\.git") {
  Write-Step "Repository exists at $INSTALL_DIR — pulling latest"
  Push-Location $INSTALL_DIR
  git fetch --all
  git reset --hard "origin/$REPO_BRANCH"
  git clean -fdx
  Pop-Location
} else {
  Write-Step "Cloning Beatrice repository to $INSTALL_DIR"
  git clone --branch $REPO_BRANCH --depth 1 $REPO_URL $INSTALL_DIR
}
Write-OK "Repository ready at $INSTALL_DIR"

# ─── Install npm dependencies ────────────────────────────────────────────────
Write-Step "Installing npm dependencies (this can take a few minutes)"
Push-Location $INSTALL_DIR
npm ci --include=dev
Write-OK "npm dependencies installed"

# ─── Install Python dependencies ──────────────────────────────────────────────
Write-Step "Setting up Python venv and installing browser-use dependencies"
if (-not (Test-Path ".venv")) { python -m venv .venv }
& .\.venv\Scripts\python.exe -m pip install --upgrade pip
& .\.venv\Scripts\python.exe -m pip install -r requirements.txt
Write-OK "Python dependencies installed"

# ─── Configure .env ──────────────────────────────────────────────────────────
if (-not (Test-Path ".env")) {
  if (Test-Path ".env.whatsapp") {
    Copy-Item .env.whatsapp .env
    Write-OK "Copied .env.whatsapp to .env"
  } elseif (Test-Path ".env.example") {
    Copy-Item .env.example .env
    Write-Warn "Created .env from .env.example — fill in your API keys before running"
  } else {
    Write-Fail "No .env template found"
  }
} else {
  Write-OK ".env already exists"
}

if (-not (Test-Path ".env.local") -and (Test-Path ".env.local.example")) {
  Copy-Item .env.local.example .env.local
}

# ─── Build frontend ──────────────────────────────────────────────────────────
Write-Step "Building frontend (Vite production build)"
npm run build
Write-OK "Frontend built to dist/"

# ─── Create start script ────────────────────────────────────────────────────
$startScript = @"
@echo off
cd /d "%~dp0"
set NODE_ENV=production
set PORT=4200
set PUPPETEER_SKIP_DOWNLOAD=true
set PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
set PLAYWRIGHT_BROWSERS_PATH=%~dp0.venv\ms-playwright
node_modules\.bin\tsx server\index.ts
"@
Set-Content -Path "start.bat" -Value $startScript
Write-OK "Created start.bat launcher"

Pop-Location

# ─── Done ────────────────────────────────────────────────────────────────────
Write-Host "`n`n"
Write-Host "╔════════════════════════════════════════════╗" -ForegroundColor Green
Write-Host "║   Beatrice is live at http://localhost:4200  ║" -ForegroundColor Green
Write-Host "╚════════════════════════════════════════════╝" -ForegroundColor Green
Write-Host ""
Write-Host "  • Open http://localhost:4200 in your browser" -ForegroundColor White
Write-Host "  • Edit $INSTALL_DIR\.env to add API keys (Supabase, Firebase, Eburon, Google OAuth)" -ForegroundColor White
Write-Host "  • Restart after editing env:  cd $INSTALL_DIR && start.bat" -ForegroundColor White
Write-Host ""
