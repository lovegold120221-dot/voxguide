#!/bin/bash
# ── Setup Cerebras + Browser-Use for Beatrice ──
# Run: bash scripts/setup-cerebras.sh

set -e

echo "=== Installing Browser-Use and Cerebras dependencies ==="

# Install Python packages
pip install browser-use python-dotenv langchain-openai playwright

# Install Playwright browsers (Chromium for Browser-Use)
python3 -m playwright install chromium

echo ""
echo "=== Done ==="
echo ""
echo "Next steps:"
echo "1. Add your Cerebras API key to .env:"
echo "   CEREBRAS_API_KEY=your-key-here"
echo ""
echo "2. Restart the backend:"
echo "   npm run dev:api"
echo ""
echo "3. Test the integration:"
echo "   python3 scripts/cerebras_browser.py --task 'Go to example.com and return the page title'"
echo ""
