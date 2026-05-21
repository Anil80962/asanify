@echo off
title Asanify Auto Clock-In Setup
color 0A
echo.
echo  ==========================================
echo   Asanify Auto Clock-In - Employee Setup
echo  ==========================================
echo.

:: Check Node.js
where node >nul 2>&1
if %errorlevel% neq 0 (
    echo  [!] Node.js is not installed on your PC.
    echo.
    echo  Please do this:
    echo    1. Open https://nodejs.org in your browser
    echo    2. Download and install the LTS version
    echo    3. Double-click this file again after installing
    echo.
    pause
    exit /b 1
)

for /f "tokens=*" %%v in ('node -v 2^>^&1') do set NODE_VER=%%v
echo  [OK] Node.js found: %NODE_VER%
echo.

:: Install npm packages
echo  [1/3] Installing packages...
call npm install --silent
if %errorlevel% neq 0 (
    echo  [!] npm install failed. Check your internet connection.
    pause
    exit /b 1
)
echo  [OK] Packages ready.
echo.

:: Install Playwright browser
echo  [2/3] Setting up browser (one-time, may take 1-2 minutes)...
call npx playwright install chromium --with-deps >nul 2>&1
if %errorlevel% neq 0 (
    call npx playwright install chromium >nul 2>&1
)
echo  [OK] Browser ready.
echo.

:: Run onboarding
echo  [3/3] Starting onboarding...
echo.
call npm run onboard
echo.
pause
