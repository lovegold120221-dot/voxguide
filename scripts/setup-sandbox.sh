#!/bin/bash
set -euo pipefail

cat << 'BANNER'
╔══════════════════════════════════════════╗
║   Beatrice Sandbox VPS Setup            ║
║   Eburon AI — Ollama + Hermes Deploy    ║
╚══════════════════════════════════════════╝
BANNER

SANDBOX_ROOT="${SANDBOX_ROOT:-/var/eburon-ai/sandbox}"
SANDBOX_PORT="${SANDBOX_PORT:-4300}"
OLLAMA_MODEL="${OLLAMA_MODEL:-hermes3:latest}"

echo ""
echo "==> Updating system packages..."
sudo apt-get update -qq && sudo apt-get install -y -qq curl wget git nginx certbot python3-certbot-nginx ufw 2>/dev/null || true

echo ""
echo "==> Checking Node.js..."
if ! command -v node &>/dev/null; then
    echo "    Installing Node.js 22..."
    curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
    sudo apt-get install -y nodejs
fi
echo "    Node.js: $(node --version)"

echo ""
echo "==> Installing Ollama..."
if ! command -v ollama &>/dev/null; then
    curl -fsSL https://ollama.com/install.sh | sh
fi
echo "    Ollama: $(ollama --version 2>/dev/null || echo 'installed')"

echo ""
echo "==> Pulling Hermes model (${OLLAMA_MODEL})..."
ollama pull "${OLLAMA_MODEL}" || {
    echo "    WARNING: Could not pull ${OLLAMA_MODEL}. Trying hermes3 as fallback..."
    ollama pull hermes3
}

echo ""
echo "==> Creating sandbox directory structure..."
sudo mkdir -p "${SANDBOX_ROOT}/tasks" "${SANDBOX_ROOT}/_archive"
sudo chmod -R 755 "${SANDBOX_ROOT}"
sudo chown -R "$(whoami)" "${SANDBOX_ROOT}" 2>/dev/null || true

echo ""
echo "==> Installing sandbox server dependencies..."
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "${SCRIPT_DIR}/.." || exit 1

npm install --production 2>/dev/null || npm install

echo ""
echo "==> Installing PM2 process manager..."
if ! command -v pm2 &>/dev/null; then
    sudo npm install -g pm2
fi

echo ""
echo "==> Configuring firewall..."
sudo ufw allow "${SANDBOX_PORT}/tcp" 2>/dev/null || true
sudo ufw allow 443/tcp 2>/dev/null || true
sudo ufw allow 80/tcp 2>/dev/null || true

echo ""
echo "==> Starting sandbox server with PM2..."
pm2 delete beatrice-sandbox 2>/dev/null || true

cat > /tmp/beatrice-ecosystem.config.cjs << ECONF
module.exports = {
  apps: [{
    name: 'beatrice-sandbox',
    script: 'npx',
    args: 'tsx server/index.ts',
    cwd: '${SCRIPT_DIR}/..',
    env: {
      NODE_ENV: 'production',
      SANDBOX_ROOT: '${SANDBOX_ROOT}',
      SANDBOX_PORT: '${SANDBOX_PORT}',
      OLLAMA_URL: 'http://localhost:11434',
      OLLAMA_MODEL: '${OLLAMA_MODEL}',
    },
    autorestart: true,
    max_memory_restart: '1G',
    log_date_format: 'YYYY-MM-DD HH:mm:ss',
  }]
};
ECONF

pm2 start /tmp/beatrice-ecosystem.config.cjs
pm2 save
pm2 startup systemd 2>/dev/null || pm2 startup launchd 2>/dev/null || true

echo ""
echo "==> Setting up nginx reverse proxy..."
NGINX_CONFIG="/etc/nginx/sites-available/beatrice-sandbox"
if [ ! -f "${NGINX_CONFIG}" ]; then
    VPS_DOMAIN="${VPS_DOMAIN:-}"
    if [ -n "${VPS_DOMAIN}" ]; then
        sudo tee "${NGINX_CONFIG}" > /dev/null << NGINXCONF
server {
    listen 80;
    server_name ${VPS_DOMAIN};

    client_max_body_size 50M;

    location /sandbox/ {
        proxy_pass http://127.0.0.1:${SANDBOX_PORT}/sandbox/;
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
    }

    location /api/ {
        proxy_pass http://127.0.0.1:${SANDBOX_PORT}/api/;
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
    }
}
NGINXCONF

        sudo rm -f /etc/nginx/sites-enabled/default
        sudo ln -sf "${NGINX_CONFIG}" /etc/nginx/sites-enabled/beatrice-sandbox
        sudo nginx -t && sudo systemctl reload nginx

        echo "    Nginx configured for ${VPS_DOMAIN}"
        echo "    To enable HTTPS, run: sudo certbot --nginx -d ${VPS_DOMAIN}"
    else
        echo "    No VPS_DOMAIN set. Skipping nginx config."
        echo "    Sandbox available at http://localhost:${SANDBOX_PORT}"
    fi
fi

echo ""
echo "==> Testing sandbox server..."
sleep 2
HEALTH=$(curl -s http://localhost:${SANDBOX_PORT}/api/health 2>/dev/null || echo '{}')
echo "    Health check: ${HEALTH}"

OLLAMA_STATUS=$(curl -s http://localhost:${SANDBOX_PORT}/api/ollama/status 2>/dev/null || echo '{}')
echo "    Ollama status: ${OLLAMA_STATUS}"

echo ""
echo "╔══════════════════════════════════════════╗"
echo "║   Setup Complete                        ║"
echo "╠══════════════════════════════════════════╣"
echo "║   Sandbox: http://localhost:${SANDBOX_PORT}   ║"
echo "║   Logs:    pm2 logs beatrice-sandbox     ║"
echo "║   Restart: pm2 restart beatrice-sandbox  ║"
echo "║   Status:  pm2 status                    ║"
echo "╚══════════════════════════════════════════╝"
