#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# Beatrice — Universal bootstrap (detects OS, downloads and runs installer)
# This is the script invoked by the one-paste curl command.
# ─────────────────────────────────────────────────────────────────────────────

REPO_RAW_URL="${BEATRICE_RAW_URL:-https://raw.githubusercontent.com/lovegold120221-dot/turbo-dollop/main}"

if [ "$(uname)" = "Darwin" ] || [ -f /etc/os-release ]; then
  echo "▶ Detected: macOS or Linux"
  curl -fsSL "${REPO_RAW_URL}/install.sh" -o /tmp/beatrice-install.sh
  bash /tmp/beatrice-install.sh
else
  echo "▶ Detected: Non-POSIX. Use the Windows PowerShell command."
  exit 1
fi
