@echo off
setlocal enabledelayedexpansion

cd /d "%~dp0"

echo ==========================================
echo   TakingNotes Ink - Starting up...
echo ==========================================
echo.

where node >nul 2>nul
if errorlevel 1 (
  echo [ERROR] Node.js is not installed or not on PATH.
  echo Please install Node.js 20+ from https://nodejs.org/
  pause
  exit /b 1
)

for /f "tokens=1,2,3 delims=." %%a in ('node -v') do (
  set NODE_MAJOR=%%a
)
set NODE_MAJOR=!NODE_MAJOR:~1!

if !NODE_MAJOR! LSS 20 (
  echo [WARNING] Node.js version is older than 20. This project requires Node.js 20+.
  echo Current version: 
  node -v
  echo.
)

if not exist "node_modules" (
  echo [INFO] First run detected. Installing dependencies...
  echo This may take a few minutes...
  echo.
  call npm install
  if errorlevel 1 (
    echo [ERROR] npm install failed.
    pause
    exit /b 1
  )
  echo.
  echo [INFO] Dependencies installed successfully!
  echo.
)

echo [INFO] Starting development server...
echo [INFO] The browser will open automatically when ready.
echo.

start "" http://localhost:3000

node scripts\run.mjs dev

if errorlevel 1 (
  echo.
  echo [ERROR] Dev server failed to start.
  pause
)
