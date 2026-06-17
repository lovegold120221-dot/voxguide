#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# Beatrice — One-paste installer for macOS and Debian/Ubuntu
# Works on freshly formatted machines with no dev tools installed.
# Usage: bash install.sh
# ─────────────────────────────────────────────────────────────────────────────

set -e

REPO_URL="${BEATRICE_REPO_URL:-https://github.com/lovegold120221-dot/turbo-dollop.git}"
REPO_BRANCH="${BEATRICE_BRANCH:-main}"
INSTALL_DIR="${BEATRICE_INSTALL_DIR:-$HOME/beatrice}"
NODE_VERSION="22"
PYTHON_VERSION_MIN="3.11"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

step()   { echo -e "\n${BLUE}▶ $1${NC}"; }
ok()     { echo -e "${GREEN}✓ $1${NC}"; }
warn()   { echo -e "${YELLOW}⚠ $1${NC}"; }
fail()   { echo -e "${RED}✗ $1${NC}"; exit 1; }

# ─── Detect OS ────────────────────────────────────────────────────────────────
detect_os() {
  if [ -f /etc/os-release ]; then
    . /etc/os-release
    OS_ID="$ID"
  elif [ "$(uname)" = "Darwin" ]; then
    OS_ID="macos"
  else
    fail "Unsupported operating system. Use install.ps1 for Windows."
  fi

  case "$OS_ID" in
    ubuntu|debian|pop|linuxmint|elementary) OS_FAMILY="debian" ;;
    macos|darwin) OS_FAMILY="macos" ;;
    *) fail "Detected OS '$OS_ID' is not supported. Use macOS, Ubuntu, or Debian." ;;
  esac

  echo -e "${BLUE}Detected OS:${NC} $OS_ID (${OS_FAMILY})"
}

# ─── Install system dependencies ──────────────────────────────────────────────
install_deps_debian() {
  step "Installing Debian/Ubuntu system dependencies"
  if [ "$(id -u)" -ne 0 ]; then SUDO="sudo"; else SUDO=""; fi
  $SUDO apt-get update
  $SUDO apt-get install -y --no-install-recommends \
    ca-certificates curl wget git gnupg lsb-release \
    build-essential python3 python3-pip python3-venv \
    libnss3 libatk1.0-0 libatk-bridge2.0-0 libcups2 libdrm2 \
    libxkbcommon0 libxcomposite1 libxdamage1 libxfixes3 libxrandr2 \
    libgbm1 libpango-1.0-0 libcairo2 libasound2t64 \
    chromium chromium-driver fonts-liberation \
    dumb-init unzip
  ok "System packages installed"
}

install_deps_macos() {
  step "Installing macOS dependencies via Homebrew"
  if ! command -v brew >/dev/null 2>&1; then
    step "Installing Homebrew first"
    /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
    [ -f /opt/homebrew/bin/brew ] && eval "$(/opt/homebrew/bin/brew shellenv)"
    [ -f /usr/local/bin/brew ] && eval "$(/usr/local/bin/brew shellenv)"
  fi
  brew update
  brew install git python@3.11 chromium || true
  ok "System packages installed"
}

# ─── Install Node.js 22 ───────────────────────────────────────────────────────
install_node() {
  if command -v node >/dev/null 2>&1; then
    INSTALLED_NODE_VERSION="$(node -v | sed 's/v//' | cut -d. -f1)"
    if [ "$INSTALLED_NODE_VERSION" -ge "$NODE_VERSION" ]; then
      ok "Node.js $(node -v) already installed"
      return
    fi
    warn "Node.js $(node -v) is older than required v${NODE_VERSION}.x — upgrading"
  fi

  step "Installing Node.js ${NODE_VERSION}.x"

  if [ "$OS_FAMILY" = "debian" ]; then
    if [ "$(id -u)" -ne 0 ]; then SUDO="sudo"; else SUDO=""; fi
    $SUDO mkdir -p /etc/apt/keyrings
    curl -fsSL https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key | $SUDO gpg --dearmor -o /etc/apt/keyrings/nodesource.gpg
    echo "deb [signed-by=/etc/apt/keyrings/nodesource.gpg] https://deb.nodesource.com/node_${NODE_VERSION}.x nodistro main" \
      | $SUDO tee /etc/apt/sources.list.d/nodesource.list >/dev/null
    $SUDO apt-get update
    $SUDO apt-get install -y nodejs
  elif [ "$OS_FAMILY" = "macos" ]; then
    brew install node@22 || brew upgrade node@22 || true
    brew link --overwrite --force node@22 || true
  fi

  command -v node >/dev/null 2>&1 || fail "Node.js installation failed"
  ok "Node.js $(node -v) installed"
}

# ─── Clone or update repo ────────────────────────────────────────────────────
clone_repo() {
  if [ -d "$INSTALL_DIR/.git" ]; then
    step "Repository already exists at $INSTALL_DIR — pulling latest"
    git -C "$INSTALL_DIR" fetch --all
    git -C "$INSTALL_DIR" reset --hard "origin/${REPO_BRANCH}"
    git -C "$INSTALL_DIR" clean -fdx
  else
    step "Cloning Beatrice repository to $INSTALL_DIR"
    git clone --branch "$REPO_BRANCH" --depth 1 "$REPO_URL" "$INSTALL_DIR"
  fi
  ok "Repository ready at $INSTALL_DIR"
}

# ─── Install npm + Python dependencies ───────────────────────────────────────
install_npm_deps() {
  step "Installing npm dependencies (this can take a few minutes)"
  cd "$INSTALL_DIR"
  npm ci --include=dev
  ok "npm dependencies installed"
}

install_python_deps() {
  step "Setting up Python venv and installing browser-use dependencies"
  cd "$INSTALL_DIR"
  if [ ! -d ".venv" ]; then
    python3 -m venv .venv
  fi
  .venv/bin/pip install --upgrade pip
  .venv/bin/pip install -r requirements.txt
  ok "Python dependencies installed"
}

# ─── Configure .env ──────────────────────────────────────────────────────────
setup_env() {
  cd "$INSTALL_DIR"
  if [ ! -f .env ]; then
    if [ -f .env.whatsapp ]; then
      cp .env.whatsapp .env
      ok "Copied .env.whatsapp to .env"
    elif [ -f .env.example ]; then
      cp .env.example .env
      warn "Created .env from .env.example — fill in your API keys before running"
    else
      fail "No .env template found"
    fi
  else
    ok ".env already exists"
  fi

  if [ ! -f .env.local ] && [ -f .env.local.example ]; then
    cp .env.local.example .env.local
  fi
}

# ─── Build frontend ──────────────────────────────────────────────────────────
build_frontend() {
  step "Building frontend (Vite production build)"
  cd "$INSTALL_DIR"
  npm run build
  ok "Frontend built to dist/"
}

# ─── Start the server ────────────────────────────────────────────────────────
start_server() {
  cd "$INSTALL_DIR"
  step "Starting Beatrice on port 4200"
  if [ "$OS_FAMILY" = "debian" ] && [ "$(id -u)" -ne 0 ]; then
    SUDO="sudo"
  else
    SUDO=""
  fi

  cat > start.sh <<'EOF'
#!/usr/bin/env bash
cd "$(dirname "$0")"
export NODE_ENV=production
export PORT="${PORT:-4200}"
export PUPPETEER_SKIP_DOWNLOAD=true
export PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
export PLAYWRIGHT_BROWSERS_PATH="$(pwd)/.venv/ms-playwright"
exec node_modules/.bin/tsx server/index.ts
EOF
  chmod +x start.sh
  ok "Created start.sh launcher"

  if command -v systemctl >/dev/null 2>&1 && [ "$OS_FAMILY" = "debian" ] && [ "$(id -u)" -eq 0 ]; then
    step "Installing systemd service for autostart"
    SERVICE_FILE="/etc/systemd/system/beatrice.service"
    cat > "$SERVICE_FILE" <<EOF
[Unit]
Description=Beatrice AI Server
After=network.target

[Service]
Type=simple
User=${SUDO_USER:-$(whoami)}
WorkingDirectory=$INSTALL_DIR
ExecStart=$INSTALL_DIR/start.sh
Restart=on-failure
RestartSec=5
Environment=NODE_ENV=production
Environment=PORT=4200
Environment=PUPPETEER_SKIP_DOWNLOAD=true
Environment=PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
Environment=PLAYWRIGHT_BROWSERS_PATH=$INSTALL_DIR/.venv/ms-playwright

[Install]
WantedBy=multi-user.target
EOF
    systemctl daemon-reload
    systemctl enable beatrice.service
    systemctl start beatrice.service
    ok "Beatrice running as systemd service — http://localhost:4200"
  else
    warn "Starting in foreground (Ctrl+C to stop). For autostart run:  cd $INSTALL_DIR && ./start.sh &"
    bash start.sh
  fi
}

# ─── Main ────────────────────────────────────────────────────────────────────
main() {
  echo -e "${BLUE}"
  echo "╔════════════════════════════════════════════╗"
  echo "║   Beatrice — One-paste Installer          ║"
  echo "║   macOS · Debian · Ubuntu                  ║"
  echo "╚════════════════════════════════════════════╝"
  echo -e "${NC}"

  detect_os

  if [ "$OS_FAMILY" = "debian" ]; then install_deps_debian; fi
  if [ "$OS_FAMILY" = "macos" ]; then install_deps_macos; fi

  install_node
  clone_repo
  install_npm_deps
  install_python_deps
  setup_env
  build_frontend
  start_server

  echo -e "\n${GREEN}"
  echo "╔════════════════════════════════════════════╗"
  echo "║   Beatrice is live at http://localhost:4200  ║"
  echo "╚════════════════════════════════════════════╝"
  echo -e "${NC}"
  echo "  • Open http://localhost:4200 in your browser"
  echo "  • Edit $INSTALL_DIR/.env to add API keys (Supabase, Firebase, Eburon, Google OAuth)"
  echo "  • Restart after editing env:  cd $INSTALL_DIR && ./start.sh"
  echo "  • Logs (systemd):            journalctl -u beatrice -f"
  echo ""
}

main "$@"
