#!/bin/bash
echo ""
echo " =========================================="
echo "  Asanify Auto Clock-In - Employee Setup"
echo " =========================================="
echo ""

# Check Node.js
if ! command -v node &>/dev/null; then
    echo " [!] Node.js is not installed."
    echo ""
    echo " Please install it:"
    echo "   Mac:   https://nodejs.org  (download LTS)"
    echo "   Linux: sudo apt install nodejs npm"
    echo ""
    echo " Then run this script again."
    exit 1
fi
echo " [OK] Node.js $(node -v) found."
echo ""

echo " [1/3] Installing packages..."
npm install --silent
echo " [OK] Packages ready."
echo ""

echo " [2/3] Setting up browser (one-time, may take 1-2 min)..."
npx playwright install chromium --with-deps &>/dev/null || npx playwright install chromium &>/dev/null
echo " [OK] Browser ready."
echo ""

echo " [3/3] Starting onboarding..."
echo ""
npm run onboard
